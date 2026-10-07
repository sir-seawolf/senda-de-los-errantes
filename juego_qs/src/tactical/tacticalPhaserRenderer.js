// Tactical Renderer Gateway -- Fase 1 (docs/TACTICAL_PRODUCTION_PHASE1.md),
// extendido en Fase 4 (resolución de la definición real,
// docs/TACTICAL_PRODUCTION_PHASE4.md) y en Fase 5 (Phaser real,
// docs/TACTICAL_PRODUCTION_PHASE5.md). Registrado en RENDERERS_POR_TIPO
// bajo "tactical-phaser" (src/engine/renderers/index.js) -- NO es un
// segundo registry, es UN renderer más, con la misma firma que
// cualquier otro (`render(container, escenaId)`).
//
// Phaser NUNCA se importa aquí de forma estática -- solo mediante
// `import()` dinámico dentro de crearTacticalRuntime().start(), y SOLO
// cuando hay una definición táctica real que renderizar (flag ON +
// escena.tactical.definitionId resuelto). Boot normal, navegación
// narrativa previa al combate, y el caso genérico sin definición
// (crearTacticalStub(), heredado de Fase 1) nunca tocan Phaser.
//
// Responsabilidad de este archivo, y SOLO esta: comprobar el feature
// flag, resolver la definición real si la escena la declara, invocar el
// motor (stub genérico o runtime Phaser real), capturar errores, limpiar
// estado parcial, invocar fallback si procede, y entregar el
// TacticalResult final al resolver de outcome. NUNCA reglas de combate
// -- ni aquí, ni en el stub, ni en el runtime.
import { config } from "../config.js";
import { montarCombate as montarCombateLegacyReal, cargarEncuentroSiProcede } from "../engine/renderers/combat.js";
import { cargarEscena } from "../engine/sceneEngine.js";
import { moduloIdActivo } from "../engine/moduleLoader.js";
import { validateEncounterDefinition } from "./contracts/TacticalEncounterDefinition.js";
import { resolverTacticalDefinition, TacticalDefinitionNotFoundError } from "./tacticalDefinitionResolver.js";
import { resolverOutcomeTactico } from "./tacticalOutcomeResolver.js";
import { actualizarRecursosEquipo, cambiarEscena, cargar as cargarUltimoPuntoGuardado, hayPartidaGuardada, obtenerJugador } from "../gameState.js";
import { cargarCadencia } from "../combat/combat.js";
import { cargarCatalogoEquipoActivo, hidratarPartyDesdeEquipo } from "./bridge/equipmentLoadoutAdapter.js";
import { integrarJugadorEnDefinicion } from "./bridge/playerCharacterAdapter.js";

const TACTICAL_DEBUG = false; // punto 20 -- discreto, nunca ruidoso en producción normal
function log(evento, ...datos) {
  if (TACTICAL_DEBUG) console.log(`[${evento}]`, ...datos); // eslint-disable-line no-console
}

export class TacticalRendererUnavailableError extends Error {
  constructor(escenaId, renderer, reason) {
    super(`TACTICAL_RENDERER_UNAVAILABLE: escenaId="${escenaId}" renderer="${renderer}" reason="${reason}"`);
    this.name = "TacticalRendererUnavailableError";
    this.escenaId = escenaId;
    this.renderer = renderer;
    this.reason = reason;
  }
}

// ===== Lifecycle contract stub (punto 29 P1, extendido punto 17 P4) =====
// La Fase 5 sustituirá el CONTENIDO de estas cuatro funciones por
// llamadas reales a TacticalEncounterLoader/TacticalScene -- la FORMA
// del contrato (prepare -> start -> finish -> destroy, destroy
// idempotente) es la que ya usará el motor real, para no tener que
// romperla después. Fase 4 solo enseña a prepare() a aceptar el payload
// REAL (moduleId/definitionId/definition/escena) cuando la escena lo
// resolvió -- sigue sin jugar nada de verdad.
export function crearTacticalStub() {
  let destruido = false;
  return {
    async prepare(escenaId, payload = null) {
      log("TACTICAL_GATEWAY_REQUEST", escenaId, payload?.definitionId);
      return { escenaId, ...payload };
    },
    async start(ctx) {
      // Stub: no hay Tactical Engine todavía -- no juega nada de verdad,
      // solo produce un TacticalResult con la forma que sí devolverá el
      // motor real (punto 31 P1), para que cualquier código que lo
      // consuma en el futuro no tenga que cambiar de forma. Si se
      // resolvió una definición real (Fase 4), su `id` es el
      // encounterId real; si no (p.ej. la escena no declara
      // tactical.definitionId, caso genérico de Fase 1), se mantiene el
      // comportamiento original.
      return { encounterId: ctx.definition?.id ?? ctx.escenaId, outcome: "stub", transition: null, renderer: "tactical-phaser" };
    },
    finish(resultado) {
      return resultado;
    },
    // Idempotente a propósito (punto 30): seguro llamarlo tras éxito, tras
    // fallo, o más de una vez.
    destroy() {
      if (destruido) return;
      destruido = true;
      log("TACTICAL_DESTROY");
    }
  };
}

// ===== Runtime Phaser real (Fase 5) =====
// Mismo contrato de lifecycle que crearTacticalStub() (prepare -> start
// -> finish -> destroy, destroy idempotente) -- pero start() SÍ arranca
// Phaser de verdad y espera el TacticalResult real de TacticalScene.
// Solo se usa cuando hay una `definition` real resuelta (payload !== null,
// Fase 4) -- el caso genérico sin definición sigue usando
// crearTacticalStub(), sin tocar Phaser en absoluto.
export function crearTacticalRuntime() {
  let destruido = false;
  let game = null;
  let rootEl = null;

  return {
    async prepare(escenaId, payload) {
      log("TACTICAL_GATEWAY_REQUEST", escenaId, payload?.definitionId);
      return { escenaId, ...payload };
    },

    async start(ctx, container) {
      if (!ctx.definition) {
        throw new Error("crearTacticalRuntime().start(): se requiere una definition real (payload resuelto)");
      }
      // import() dinámico -- ÚNICO punto de todo el módulo donde Phaser
      // se carga (punto 8/9 del encargo: carga diferida, nunca en boot).
      // TacticalScene.js importa Phaser internamente también; el caché de
      // módulos ES garantiza una sola instancia real (mismo criterio que
      // audioManager.js, ya auditado en P2/P3).
      //
      // Selección de Scene por `definition.renderer` (Production
      // Integration Phase 6C, extensión mínima/opcional/retrocompatible
      // ya prevista en docs/TACTICAL_PRODUCTION_PHASE6_AUDIT.md §6): el
      // campo YA existe en el contrato desde P2 (conDefaults() lo rellena
      // con "phaser-tactical") pero hasta ahora nunca se leía. Cualquier
      // valor no reconocido -- incluido el default de siempre -- cae en
      // TacticalScene (cenital), comportamiento idéntico al de antes de
      // esta fase. Solo "phaser-tactical-isometric" activa el spike.
      const usarOblicua = ctx.definition.renderer === "phaser-tactical-isometric";
      const cadenciaData = await cargarCadencia();
      const [{ default: Phaser }, sceneModule] = await Promise.all([
        import("../vendor/phaser/phaser.esm.min.js"),
        usarOblicua ? import("./render/TacticalSceneOblicua.js") : import("./render/TacticalScene.js")
      ]);
      const TacticalScene = usarOblicua ? sceneModule.TacticalSceneOblicua : sceneModule.TacticalScene;
      const sceneKey = usarOblicua ? "TacticalSceneOblicua" : "TacticalScene";

      // Contenedor productivo dedicado (punto 13 del encargo): existe
      // solo mientras dura el combate, dentro del MISMO `container` que
      // ya usa cualquier otro renderer (nunca un nodo global nuevo del
      // index.html de producción) -- desaparece por completo en destroy().
      container.innerHTML = "";
      rootEl = document.createElement("div");
      rootEl.id = "tactical-root";
      rootEl.style.width = "100%";
      rootEl.style.height = "100%";
      container.appendChild(rootEl);

      const anchoInicial = rootEl.clientWidth || container.clientWidth || 800;
      const altoInicial = rootEl.clientHeight || container.clientHeight || 600;

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: rootEl,
        backgroundColor: "#0a0a0c",
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: anchoInicial,
          height: altoInicial
        },
        physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
        scene: [] // se añade sin auto-start -- necesitamos pasarle `definition` vía init data
      });

      // `game.isBooted` ya es `true` inmediatamente tras `new Phaser.Game()`
      // (verificado empíricamente), pero el SceneManager todavía no ha
      // procesado su cola de arranque en ese instante -- game.scene.add()
      // + getScene() devuelven null si se llaman antes del primer STEP del
      // bucle de Phaser. Se espera un STEP real (no isBooted/READY, que
      // no lo garantizan) antes de tocar el SceneManager.
      await new Promise((resolve) => game.events.once(Phaser.Core.Events.STEP, resolve));

      // scene.add(key, SceneClass, autoStart=false) + scene.start(key, data)
      // es el patrón estándar de Phaser para pasar datos de inicialización
      // -- el objeto Scene ya existe (y su `events` ya es escuchable) desde
      // el momento de add(), antes de que start() dispare init()/create()
      // en el siguiente tick del loop de Phaser.
      game.scene.add(sceneKey, TacticalScene, false);
      const scene = game.scene.getScene(sceneKey);

      // TacticalScene emite este evento cada vez que session.resultado
      // queda fijado (ver _mostrarResultado() en TacticalScene.js) -- el
      // runtime nunca sondea/consulta el estado interno de la escena por
      // otra vía. TacticalSceneOblicua hereda _mostrarResultado() sin
      // cambios -- misma señal, mismo evento.
      //
      // CORRECCIÓN (encargo de sesión, 2026-08-21): antes se esperaba UNA
      // sola vez y se devolvía lo que llegara, incluido outcome===null
      // (límite de rondas) -- eso no es un final, es una pausa de la
      // simulación. Ahora, si el resultado llega sin outcome, se muestra
      // un aviso NO definitivo (mostrarPausaCombateSinResolver) y se
      // reanuda el MISMO combate (reanudarTrasLimiteRondas(), sin
      // recrear nada) -- el runtime solo se destruye cuando el llamador
      // recibe un resultado con outcome real, o el jugador elige volver
      // al último punto guardado (señal __volverCheckpoint).
      const esperarResultado = (disparar) => new Promise((resolve) => {
        scene.events.once("tactical-encounter-result", resolve);
        disparar();
      });

      let resultado = await esperarResultado(() => game.scene.start(sceneKey, { definition: ctx.definition, cadenciaData }));
      while (!resultado.outcome) {
        const decision = await mostrarPausaCombateSinResolver(container);
        if (decision === "checkpoint") return { ...resultado, __volverCheckpoint: true };
        const modo = decision === "continuar_manual" ? "manual" : "mas_rondas";
        resultado = await esperarResultado(() => scene.reanudarTrasLimiteRondas({ modo }));
      }
      return resultado;
    },

    finish(resultado) {
      return resultado;
    },

    // Idempotente a propósito (punto 41 del encargo): seguro llamarlo
    // tras éxito, tras fallo, o más de una vez. game.destroy(true) ya
    // limpia por sí solo -- canvas, input (teclado/puntero), tweens,
    // timers, sonidos, listeners de resize del Scale Manager (punto 40) --
    // no se duplica manualmente lo que Phaser ya garantiza.
    destroy() {
      if (destruido) return;
      destruido = true;
      if (game) {
        game.destroy(true);
        game = null;
      }
      if (rootEl) {
        rootEl.remove();
        rootEl = null;
      }
      log("TACTICAL_DESTROY_REAL");
    }
  };
}

// ===== Resolución del payload real (Fase 4, punto 3/17/23/25) =====
// Localiza escena.tactical.definitionId (declarado en el encounter
// payload real, ver cargarEncuentroSiProcede()) y resuelve la
// TacticalEncounterDefinition correspondiente. Devuelve null (no
// lanza) si la escena simplemente no declara ninguna definición táctica
// -- eso NO es un error, es el caso genérico de Fase 1 (stub sin datos
// reales, sigue soportado para el fixture de pruebas de esa fase).
async function resolverPayloadTactico(escenaId, opts) {
  const moduleId = opts.moduleId ?? moduloIdActivo();
  const escena = opts.escena ?? await cargarEncuentroSiProcede(await cargarEscena(escenaId));
  const definitionId = escena?.tactical?.definitionId;
  if (!definitionId) return null;

  let definition;
  try {
    definition = await resolverTacticalDefinition(moduleId, definitionId, opts.importarRegistro);
  } catch (e) {
    if (e instanceof TacticalDefinitionNotFoundError) {
      throw new TacticalRendererUnavailableError(escenaId, "tactical-phaser", e.message);
    }
    throw e;
  }

  const { valid, errors } = validateEncounterDefinition(definition);
  if (!valid) {
    throw new TacticalRendererUnavailableError(escenaId, "tactical-phaser", `TACTICAL_ENCOUNTER_INVALID (${definitionId}): ${errors.join("; ")}`);
  }

  // La definición del módulo es dato estático y no sabe qué personaje eligió
  // la persona. La capa de integración marca el PJ y, cuando el id elegido no
  // figura en el reparto del encuentro, ocupa la plaza declarada por el módulo
  // (`playerActorSlotId`). El adaptador clona siempre: el registro devuelve la
  // misma referencia entre partidas y no debe contaminar la siguiente sesión.
  const definicionConPJ = integrarJugadorEnDefinicion(definition, obtenerJugador());

  let definicionConEquipo = definicionConPJ;
  try {
    const candidata = hidratarPartyDesdeEquipo(definicionConPJ, await cargarCatalogoEquipoActivo());
    const validacionEquipo = validateEncounterDefinition(candidata);
    if (!validacionEquipo.valid) throw new Error(`loadout táctico inválido: ${validacionEquipo.errors.join("; ")}`);
    definicionConEquipo = candidata;
  } catch (error) {
    log("TACTICAL_EQUIPMENT_FALLBACK", error);
  }

  return { moduleId, definitionId, definition: definicionConEquipo, escena };
}

let fallbackEnCurso = false; // punto 18 -- evita tactical->legacy->tactical->...

// `legacyRenderer` es inyectable SOLO para tests (punto 23-28: probar
// éxito/fallo del fallback sin depender de datos de combate reales de
// ningún módulo) -- en producción siempre es montarCombate real.
async function fallbackARendererLegacy(container, escenaId, legacyRenderer) {
  if (fallbackEnCurso) {
    throw new TacticalRendererUnavailableError(escenaId, "tactical-phaser", "fallback ya en curso (bucle evitado)");
  }
  fallbackEnCurso = true;
  try {
    log("TACTICAL_FALLBACK", escenaId);
    // "Comprobar compatibilidad real, no asumir" (punto 16-17): se intenta
    // de verdad el renderer legacy contra la MISMA escena -- si falla
    // (p.ej. la escena no tiene la forma que combat.js espera), ESO es la
    // prueba real de incompatibilidad, no una heurística sobre el JSON.
    return await legacyRenderer(container, escenaId);
  } catch (e) {
    throw new TacticalRendererUnavailableError(escenaId, "tactical-phaser", `renderer legacy incompatible o falló: ${e.message}`);
  } finally {
    fallbackEnCurso = false;
  }
}

// Pantalla de "Continuará" -- RESERVADA para límites narrativos REALES
// de contenido todavía no desarrollado (encargo de sesión, 2026-08-21:
// "Mantén la pantalla 'Continuará' exclusivamente para límites
// narrativos reales de contenido todavía no desarrollado"). El límite
// de rondas del combate automático NO es uno de esos casos -- ver
// mostrarPausaCombateSinResolver() más abajo, que es lo que se usa
// ahora para outcome===null. Esta función se deja preparada, sin
// ningún punto de la integración actual que la invoque todavía, para
// cuando exista un caso narrativo real que la necesite -- no se borra
// para no perder el trabajo de diseño ya hecho (clases CSS reutilizadas
// de la pantalla de final real, comportamiento no destructivo).
function mostrarContinuaraPendiente(container) {
  if (typeof document === "undefined" || typeof container?.appendChild !== "function") return;
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "final-screen";
  wrap.innerHTML = `
    <div class="final-expediente">
      <div class="final-eyebrow">Continuará</div>
      <div class="final-titulo">Este encuentro sigue abierto</div>
      <div class="final-texto"><em>El enfrentamiento se ha alargado más allá de lo que esta demo puede resolver todavía. Tu partida sigue guardada tal y como estaba.</em></div>
      <button type="button" class="btn-cerrar-expediente tactical-sin-resolver-menu">Volver al menú</button>
    </div>
  `;
  container.appendChild(wrap);
  wrap.querySelector(".tactical-sin-resolver-menu").addEventListener("click", () => cambiarEscena("menu"));
}

// Aviso NO definitivo para un combate automático que llegó al límite de
// rondas sin que ningún bando lo resolviera (encargo de sesión,
// 2026-08-21). A diferencia de mostrarContinuaraPendiente(), esto NUNCA
// se presenta como un final ni oculta el tablero -- se monta como
// overlay ADITIVO (nunca `container.innerHTML=""`: el runtime táctico
// sigue vivo debajo, con canvas y sesión intactos) reutilizando el
// patrón visual ya existente de "modal sobre la partida"
// (.roll-overlay/.roll-card, el mismo que usan las tiradas) en vez de
// diseñar algo nuevo.
//
// @returns {Promise<"continuar_manual"|"mas_rondas"|"checkpoint">}
function mostrarPausaCombateSinResolver(container) {
  if (typeof document === "undefined" || typeof container?.appendChild !== "function") {
    // Sin DOM real (Node/tests): no hay forma de preguntar -- la opción
    // más segura y menos destructiva es seguir intentándolo en
    // automático, nunca perder progreso silenciosamente.
    return Promise.resolve("mas_rondas");
  }
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "roll-overlay";
    const hayCheckpoint = hayPartidaGuardada();
    overlay.innerHTML = `
      <div class="roll-card" role="dialog" aria-label="El combate sigue">
        <div class="res-titulo">El combate sigue</div>
        <div class="res-sub" style="margin-top:8px">Tras 30 rondas automáticas, ninguno de los bandos ha resuelto el enfrentamiento.</div>
        <button type="button" class="btn-continuar" data-decision="continuar_manual">Continuar manualmente</button>
        <button type="button" class="btn-continuar" data-decision="mas_rondas" style="background:var(--panel-2,#1a1a1a);color:var(--ink,#e8e8e8)">Resolver 30 rondas más</button>
        ${hayCheckpoint ? '<button type="button" class="btn-continuar" data-decision="checkpoint" style="background:transparent;border:1px solid var(--color-borde,#333);color:var(--muted,#8a94a3)">Volver al último punto guardado</button>' : ""}
      </div>
    `;
    container.appendChild(overlay);
    overlay.querySelectorAll("[data-decision]").forEach(btn => {
      btn.addEventListener("click", () => {
        overlay.remove();
        resolve(btn.dataset.decision);
      });
    });
  });
}

/**
 * Renderer registrado para `escena.type === "tactical-phaser"`.
 * Firma idéntica a cualquier otro renderer de RENDERERS_POR_TIPO
 * (`(container, escenaId) -> Promise`) -- el gateway no introduce ningún
 * contrato nuevo a nivel de despacho.
 *
 * @param {HTMLElement} container
 * @param {string} escenaId
 * @param {object} [opts] - solo para tests: legacyRenderer/forceStubError
 *   (Fase 1), moduleId/escena/importarRegistro/onPayloadResolved (Fase 4),
 *   crearRuntime/actorId/onTexto/importarResolverModulo/onOutcomeResuelto
 *   (Fase 5 -- inyección del runtime Phaser real y del resolver de
 *   outcome, para no depender de un navegador real en Node)
 */
export async function montarCombateTactico(container, escenaId, opts = {}) {
  const legacyRenderer = opts.legacyRenderer ?? montarCombateLegacyReal;

  if (!config.tactical.phaserEnabled) {
    log("TACTICAL_DISABLED", escenaId);
    return fallbackARendererLegacy(container, escenaId, legacyRenderer);
  }

  // Resolución del payload real (Fase 4) ANTES de elegir motor -- si la
  // escena no pide una definición táctica (payload === null) se usa el
  // stub genérico de Fase 1 (nunca toca Phaser). Si la pide y falla
  // (definición ausente o inválida), el error se captura más abajo y cae
  // al mismo fallback ya probado desde Fase 1 -- ningún camino nuevo de
  // recuperación (punto 43 del encargo P5).
  let payload;
  try {
    payload = await resolverPayloadTactico(escenaId, opts);
  } catch (e) {
    log("TACTICAL_RENDERER_ERROR", escenaId, e);
    return fallbackARendererLegacy(container, escenaId, legacyRenderer);
  }
  opts.onPayloadResolved?.(payload); // solo para tests -- introspección, nunca en producción

  const motor = payload ? (opts.crearRuntime?.() ?? crearTacticalRuntime()) : crearTacticalStub();
  try {
    const ctx = await motor.prepare(escenaId, payload);
    // opts.forceStubError: SOLO para tests -- simula un fallo del motor
    // (stub o runtime real) sin depender de una condición de carrera de
    // verdad.
    if (opts.forceStubError) throw opts.forceStubError;

    const resultado = payload ? await motor.start(ctx, container) : await motor.start(ctx);

    // CORRECCIÓN (encargo de sesión, 2026-08-21): `start()` del runtime
    // real ahora pausa y pregunta internamente cuando el combate
    // automático llega al límite de rondas sin resolverse (ver
    // mostrarPausaCombateSinResolver()/reanudarTrasLimiteRondas()) --
    // solo devuelve con `__volverCheckpoint:true` si el jugador elige
    // explícitamente esa salida. En ese caso el combate se abandona de
    // verdad: se destruye el runtime y se recupera el último guardado
    // real (mismo cargar() que usa "Continuar partida" en el menú) --
    // nunca una pantalla "Continuará" para esto.
    if (resultado?.__volverCheckpoint) {
      motor.destroy();
      cargarUltimoPuntoGuardado();
      return resultado;
    }

    const final = motor.finish(resultado);
    motor.destroy(); // Fase 5, punto 44: cleanup COMPLETO antes de cualquier otra cosa

    if (!payload) return final; // caso genérico de Fase 1, sin definición real -- comportamiento sin cambios
    for (const recurso of final.actorResources ?? []) {
      if (recurso.primaryInstanceId && recurso.municionPrimaria) actualizarRecursosEquipo(recurso.actorId, recurso.primaryInstanceId, { municion: recurso.municionPrimaria });
    }

    // Fase 5, punto 36/37: TacticalResult -> module resolver ->
    // aplicarConsecuencias. Solo se intenta si el combate terminó de
    // verdad (outcome !== null) -- comprobarFinDeCombate()/declararHuida()
    // son las únicas fuentes de un outcome no nulo. Con el bucle de
    // pausa/reanudación de arriba, `final.outcome` ya llega siempre
    // relleno para el runtime real (el límite de rondas nunca devuelve
    // aquí sin resolver) -- la rama `else` queda como red de seguridad
    // defensiva, no como camino alcanzable hoy.
    if (final.outcome) {
      const resuelto = await resolverOutcomeTactico(payload.moduleId, final, {
        actorId: opts.actorId, onTexto: opts.onTexto, importarResolverModulo: opts.importarResolverModulo
      });
      opts.onOutcomeResuelto?.(resuelto); // solo para tests
    } else {
      mostrarContinuaraPendiente(container, opts);
    }
    return final;
  } catch (e) {
    log("TACTICAL_RENDERER_ERROR", escenaId, e);
    motor.destroy(); // limpieza COMPLETA antes del fallback (punto 10/19/44) -- nunca legacy encima de Phaser sin limpiar
    return fallbackARendererLegacy(container, escenaId, legacyRenderer);
  }
}
