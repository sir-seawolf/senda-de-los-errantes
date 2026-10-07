// Renderer genérico de combate por turnos d100. Lee la escena (tipo "combat"),
// el catálogo de enemigos y la cadencia del módulo activo, y — si la escena
// lo declara — un encuentro data-driven (composición de enemigos, cobertura,
// condiciones de victoria/retirada) en vez de tenerlo cableado en la propia
// escena. No conoce ningún módulo, enemigo ni escena concreta por nombre —
// todo sale de datos. Ver docs/MODULE_ARCHITECTURE.md, sección "Encuentros",
// y docs/COMBAT_UX.md para munición/cobertura/modos automáticos (0.2).
import {
  state, obtenerMiembro, esJugador, miembrosDisponibles, aplicarDanio,
  nivelHeridaDe, gastarPuntoEpico, registrarDecision, cambiarEscena, establecerDisponibilidad,
  consumirMunicion, recargarArma, establecerCobertura, tieneFlag
} from "../../gameState.js";
import { ordenDeActuacion, modificadorCadencia, cargarCadencia, modificadorMovimientoEvasivo } from "../../combat/combat.js";
import {
  resolveIntent, createActivation, movementRemaining, actuacionAgotada,
  applyResourceCost, MOVIMIENTO_BASE_METROS,
  costeAccionesPorTamano, avanzarProgreso, effectiveBaseDamage,
  isFlanking, FLANQUEO_BONUS, penalizadorMultiplesAdversarios, limitarModificadorSituacional,
  aplicarSorpresaSiDisponible
} from "../../combat/rulesEngine.js";
import { valorCobertura, etiquetaCoberturaVisible, NIVELES_COBERTURA } from "../../rules/cover.js";
import { mostrarTirada } from "../../ui/rollDisplay.js";
import { cargarEscena, aplicarConsecuencias } from "../sceneEngine.js";
import { rutaDeManifiesto, rutaAsset } from "../moduleLoader.js";
import { config } from "../../config.js";

let enemiesCache = null;
async function cargarEnemigos() {
  if (enemiesCache) return enemiesCache;
  const res = await fetch(rutaDeManifiesto("enemies"));
  enemiesCache = await res.json();
  return enemiesCache;
}

const cacheEncuentros = new Map();
// Un encuentro es opcional (`escena.encounter`, el id de un archivo en
// paths.encounters): si existe, sus campos (ajusteEjecutores, coberturaDisponible,
// onVictory/onFlee/onDeathWithEpicPoint/onDeath...) se combinan con los de la
// escena — así una escena de combate puede seguir siendo autosuficiente
// (como antes de esta iteración) o delegar la composición táctica a un
// encuentro reutilizable/nombrado. La escena SIEMPRE gana si declara el
// mismo campo que el encuentro, para poder sobreescribir puntualmente.
// Exportado (Production Integration Phase 4,
// docs/TACTICAL_PRODUCTION_PHASE4.md) -- el gateway táctico
// (src/tactical/tacticalPhaserRenderer.js) reutiliza esta MISMA función
// para leer escena.tactical.definitionId del encounter payload real, en
// vez de reimplementar su propio fetch+merge (punto 2 del encargo P4:
// "no crear una ruta paralela"). Comportamiento sin cambios.
export async function cargarEncuentroSiProcede(escena) {
  if (!escena.encounter) return escena;
  if (!cacheEncuentros.has(escena.encounter)) {
    const res = await fetch(`${rutaDeManifiesto("encounters")}${escena.encounter}.json`);
    if (!res.ok) throw new Error(`Encuentro no encontrado: ${escena.encounter}`);
    cacheEncuentros.set(escena.encounter, await res.json());
  }
  return { ...cacheEncuentros.get(escena.encounter), ...escena };
}

// Efecto visual barato y corto (muzzle flash / impacto / daño). Desactivable
// por completo en config.js sin tocar la lógica de combate.
function flashEfecto(wrap, clase) {
  if (clase === "fx-muzzle" && !config.visualEffects.muzzleFlash) return;
  if ((clase === "fx-impact" || clase === "fx-danio") && !config.visualEffects.impactFlash) return;
  const el = wrap.querySelector(`.${clase}`);
  if (!el) return;
  el.classList.remove("activo");
  void el.offsetWidth; // reinicia la animación si se dispara dos veces seguidas
  el.classList.add("activo");
}

function claveCoberturaDeValor(valor) {
  return Object.keys(NIVELES_COBERTURA).find(k => NIVELES_COBERTURA[k].valor === valor) || "ninguna";
}

function habilidadArmaDe(base) {
  if (!base.arma) return { nombre: "Sin Armas", valor: base.habilidades["Sin Armas"] ?? 30 };
  if (base.arma.nombre === "Subfusil") return { nombre: "Distancia Media", valor: base.habilidades["Distancia Media"] };
  return { nombre: "Distancia Corta", valor: base.habilidades["Distancia Corta"] };
}

// Estado visible del enemigo SIN revelar sus PV exactos (punto 20 del encargo:
// "no mostrar números ocultos del enemigo salvo que el sistema lo justifique").
function estadoVisibleEnemigo(enemigo) {
  const frac = enemigo.pv / enemigo.pvBase;
  if (frac >= 0.7) return "ileso";
  if (frac >= 0.35) return "herido";
  return "muy dañado";
}

export function construirEnemigos(escena, catalogo, numPresentes) {
  const tabla = escena.ajusteEjecutores?.tabla || [];
  const fila = tabla.find(f => f.personajes === numPresentes)
    || [...tabla].sort((a, b) => a.personajes - b.personajes).find(f => f.personajes >= numPresentes)
    || tabla[tabla.length - 1];
  const plantilla = catalogo[fila.enemyId];
  // Identidad oculta genérica (Iteración 0.3.1, docs/PREMATURE_INFORMATION_AUDIT.md):
  // si la plantilla declara "nombreOculto"/"revelarConFlag", el nombre real
  // (plantilla.nombre) solo se muestra cuando ese flag está activo en la
  // partida; si no hay "nombreOculto" declarado, el comportamiento es
  // idéntico al de antes (se usa siempre plantilla.nombre) para no afectar
  // a ningún otro enemigo del juego.
  const nombreBase = plantilla.nombreOculto && !tieneFlag(plantilla.revelarConFlag)
    ? plantilla.nombreOculto
    : plantilla.nombre;
  return Array.from({ length: fila.cantidad }, (_, i) => {
    const copia = JSON.parse(JSON.stringify(plantilla));
    return {
      id: `${fila.enemyId}-${i}`,
      ...copia,
      nombre: `${nombreBase} ${i + 1}`,
      pv: plantilla.pvBase,
      cobertura: 0,
      // Munición propia del enemigo si su arma la declara (punto 27 del
      // encargo Combat UX): mismo sistema que el jugador, reserva generosa
      // documentada en enemies.json — nunca Infinity (complica el guardado
      // y ni siquiera hace falta: los enemigos no persisten entre partidas).
      municion: copia.arma?.magazineSize !== undefined
        ? { cargador: copia.arma.magazineSize, reserva: copia.arma.ammoReserve ?? 0 }
        : null
    };
  });
}

// Velocidad de presentación (punto 16 del encargo): 1×/2×/4× solo escala
// pausas de puesta en escena entre acciones — nunca probabilidades, tiradas
// ni reglas (esas siguen exactamente el mismo resolvedor a cualquier
// velocidad). La animación del dado en sí (rollDisplay.js) no se toca —
// tiene su propio ritmo ya probado desde la Iteración 6 — pero en modos
// automáticos el "Continuar" se pulsa solo (ver autoContinuarSiProcede),
// así que la velocidad sí nota en el tiempo total entre turnos.
function ms(base, velocidad) {
  return Math.max(60, Math.round(base / velocidad));
}

export async function montarCombate(container, escenaId) {
  const escenaBase = await cargarEscena(escenaId);
  const escena = await cargarEncuentroSiProcede(escenaBase);
  const catalogo = await cargarEnemigos();
  const cadenciaData = await cargarCadencia();

  const party = miembrosDisponibles(escena.availableParty);
  const enemigos = construirEnemigos(escena, catalogo, party.length);

  // Fase 4A/4B (docs/COMBAT_PHASE4_RESULT.md): estado runtime por
  // combatiente que debe sobrevivir ENTRE actuaciones (no vive en
  // activationState, que se resetea cada actuación -- punto 5 del
  // encargo). armaActiva empieza en "distancia" si el actor lleva arma a
  // distancia (equipado desde el inicio del encuentro -- punto 39: no se
  // fuerza READY_WEAPON al empezar un combate ya en curso). recarga:
  // progreso de RELOAD (null = sin recarga en curso).
  // sorpresaDisponible (Fase 4C, AUTHOR_RULE_CURRENT, +20 al primer ataque
  // si hay sorpresa narrativamente justificada): dato OPCIONAL de encuentro
  // (`escena.sorpresa.lado`: "party" | "enemigos"), nunca asumido. Ningún
  // encuentro existente lo declara todavía -- añadirlo cambiaría la
  // dificultad de un combate ya balanceado, y el encargo pide explícitamente
  // no balancear ningún encuentro existente en esta fase (punto 43) -- ver
  // docs/COMBAT_PHASE4_RESULT.md, bloque 4C.
  party.forEach(m => {
    m.armaActiva = m.base.arma ? "distancia" : "cc";
    m.recarga = null;
    m.sorpresaDisponible = escena.sorpresa?.lado === "party";
  });
  enemigos.forEach(e => {
    e.recarga = null;
    e.sorpresaDisponible = escena.sorpresa?.lado === "enemigos";
  });

  // modo: "manual" (todo el mundo se controla a mano, comportamiento previo
  // a esta iteración, DEFAULT — punto 34: conservador para partidas ya en
  // curso) | "pj_manual_auto" (el jugador controla solo su PJ, el motor
  // resuelve compañeros con la misma regla que "Automático" ya tenía) |
  // "automatico" (el motor resuelve TODO el grupo, incluido el PJ, con el
  // mismo resolvedor real — nunca un simulador aparte, punto 14).
  // resolviendo: guarda de doble-clic (punto 41) — mientras una acción está
  // en curso (tirada abierta, turno automático resolviéndose) no se acepta
  // otra hasta que termine.
  // Fase 3 (docs/COMBAT_PHASE3_RESULT.md): round/activation/activationCounter
  // formalizan la economía de actuaciones (asalto -> actuación -> acción
  // principal/menor/movimiento). `activation` es la actuación EN CURSO del
  // combatiente activo -- se crea de cero (createActivation) cada vez que
  // siguienteTurno() asigna un nuevo evento de la cola de Iniciativa, así
  // que una actuación nueva nunca hereda gasto de una anterior del mismo
  // actor (punto 16 del encargo), aunque tenga varias en el mismo asalto.
  // Fase 4B: contextoCC (atacantesCC/facingTargetId por defensor -- múltiples
  // adversarios y flanqueo, docs/COMBAT_PHASE4_RESULT.md bloque 4B) y
  // efectosDefensivos (defensa dividida/Esquiva total/movimiento evasivo,
  // "hasta la siguiente actuación" del propio actor, punto 14 del encargo)
  // viven en combateState -- sobreviven a lo largo del asalto, no de una
  // sola actuación, y se limpian según su propia semántica (contextoCC en
  // cada generarOrden(), efectosDefensivos cuando ese actor arranca su
  // siguiente actuación) en vez de con un sistema de buffs genérico.
  const combateState = {
    orden: [], log: [], modo: "manual", velocidad: 1, resolviendo: false, round: 0, activationCounter: 0, activation: null,
    contextoCC: { atacantesCC: {}, facingTargetId: {} },
    efectosDefensivos: {}
  };

  // CORRECCIÓN (encargo de auditoría de brechas, 2026-08-22): sin fondo
  // declarado -- caso real ahora que existen combates de tipo "combat"
  // sin arte propio (drake_street_combate.json, satelite_aterrizaje.json)
  // -- rutaAsset(null) devuelve null y el string quedaba literalmente
  // como url('null'), una petición de red real a "/null" (404). Mismo
  // criterio de guard que ya usa narrative.js para su fondo opcional.
  const fondoStyle = escena.background ? `background-image:url('${rutaAsset(escena.background)}')` : "";
  const wrap = document.createElement("div");
  wrap.className = "combate-wrap";
  wrap.innerHTML = `
    <div class="combate-escena" style="${fondoStyle}">
      <div class="fx-overlay fx-muzzle"></div>
      <div class="fx-overlay fx-impact"></div>
      <div class="fx-overlay fx-danio"></div>
      <div class="combate-turno-indicador" id="turno-indicador">Iniciativa...</div>
      <div class="combate-orden" id="combate-orden"></div>
      <div class="combate-tactico" id="combate-tactico"></div>
      <div class="combate-log" id="combate-log"></div>
    </div>
    <div class="combate-modo" id="combate-modo"></div>
    <div class="combate-acciones" id="combate-acciones"></div>
  `;
  container.appendChild(wrap);

  const logEl = wrap.querySelector("#combate-log");
  const accionesEl = wrap.querySelector("#combate-acciones");
  const turnoEl = wrap.querySelector("#turno-indicador");
  const ordenEl = wrap.querySelector("#combate-orden");
  const tacticoEl = wrap.querySelector("#combate-tactico");
  const modoEl = wrap.querySelector("#combate-modo");

  function log(msg) {
    combateState.log.push(msg);
    logEl.innerHTML = combateState.log.slice(-6).map(m => `<div>${m}</div>`).join("");
    logEl.scrollTop = logEl.scrollHeight;
  }

  function nombreDe(id) {
    const m = party.find(p => p.baseId === id);
    if (m) return m.base.nombre;
    const e = enemigos.find(en => en.id === id);
    return e ? e.nombre : id;
  }

  // "KOVA → EJECUTOR 1 → BISHOP → EJECUTOR 2 → SALIM" — vista compacta del
  // orden de turnos que queda por resolver en esta ronda.
  function renderOrden() {
    const proximos = combateState.orden.slice(0, 5).map(e => nombreDe(e.id));
    ordenEl.textContent = proximos.length ? proximos.join(" → ") : "";
  }

  // Estado táctico compacto (puntos 9-11, 23): vida/cobertura/munición de
  // cada miembro del grupo, visible SIEMPRE, no solo cuando le toca actuar
  // — así nunca hay que recordar qué se hizo dos turnos antes. Cobertura
  // vive en el propio runtime del combatiente (m.cobertura, gameState.js),
  // no en un booleano suelto del combate: por eso puede leerse aquí igual
  // que desde la ficha lateral (src/ui/sheet.js).
  function renderTactico() {
    const filas = party.map(m => {
      const cob = m.cobertura > 0
        ? `<span class="tactico-cobertura activa">${etiquetaCoberturaVisible(claveCoberturaDeValor(m.cobertura))}</span>`
        : `<span class="tactico-cobertura">sin cobertura</span>`;
      const mun = m.municion ? `<span class="tactico-municion">${m.municion.cargador}/${m.municion.reserva}</span>` : "";
      const vivo = (m.vidaActual.sano + m.vidaActual.herido + m.vidaActual.tullido) > 0;
      return `<div class="tactico-fila ${vivo ? "" : "caido"}">
        <span class="tactico-nombre">${m.base.nombre}${esJugador(m.baseId) ? "" : ` <em>(${combateState.modo === "manual" ? "manual" : "auto"})</em>`}</span>
        ${cob}${mun}
      </div>`;
    }).join("");
    tacticoEl.innerHTML = filas;
  }

  log(escena.introText);

  // Cada llamada representa un asalto (round) nuevo -- la primera, al
  // montar el combate, ya cuenta como el asalto 1. No se rediseña la
  // Iniciativa en sí (punto 18 del encargo): sigue siendo exactamente
  // ordenDeActuacion(), solo se numera el asalto que genera.
  function generarOrden() {
    combateState.round += 1;
    // Fase 4B: el encaramiento/flanqueo de un asalto no se traslada al
    // siguiente (DIGITAL_ADAPTATION explícita, docs/COMBAT_PHASE4_RESULT.md
    // -- CAP03 no define cuánto dura la orientación relativa; un asalto
    // nuevo es un límite razonable y consistente con cómo ya se trata la
    // cobertura, que tampoco persiste indefinidamente sin volver a declararse).
    combateState.contextoCC = { atacantesCC: {}, facingTargetId: {} };
    const combatientes = [
      ...party.map(m => ({ id: m.baseId, iniciativa: m.habilidades["Iniciativa"] ?? 30 })),
      ...enemigos.map(e => ({ id: e.id, iniciativa: e.iniciativa }))
    ];
    combateState.orden = ordenDeActuacion(combatientes);
  }
  generarOrden();

  function enemigosVivos() { return enemigos.filter(e => e.pv > 0); }
  function partyVivo() { return party.filter(m => m.vidaActual.sano + m.vidaActual.herido + m.vidaActual.tullido > 0); }

  // Selector de modo (punto 33: dentro del combate, no en Configuración
  // global) + velocidad + DETENER AUTO. DETENER AUTO no interrumpe nada a
  // media tirada (punto 15): solo cambia combateState.modo a "manual", y el
  // próximo punto de decisión real (siguienteTurno(), que se llama tras
  // CADA acción resuelta) ya lo respeta — nunca corta una resolución en curso.
  function renderControlModo() {
    const enAuto = combateState.modo !== "manual";
    modoEl.innerHTML = `
      <div class="modo-fila">
        <button type="button" class="modo-btn ${combateState.modo === "manual" ? "activo" : ""}" data-modo="manual">MANUAL</button>
        <button type="button" class="modo-btn ${combateState.modo === "pj_manual_auto" ? "activo" : ""}" data-modo="pj_manual_auto">PJ MANUAL · COMPAÑEROS AUTO</button>
        <button type="button" class="modo-btn ${combateState.modo === "automatico" ? "activo" : ""}" data-modo="automatico">AUTOMÁTICO</button>
      </div>
      ${enAuto ? `
      <div class="modo-fila modo-fila-velocidad">
        ${[1, 2, 4].map(v => `<button type="button" class="modo-vel ${combateState.velocidad === v ? "activo" : ""}" data-vel="${v}">${v}×</button>`).join("")}
        <button type="button" class="modo-detener" id="btn-detener-auto">DETENER AUTO</button>
      </div>` : ""}
    `;
    modoEl.querySelectorAll(".modo-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (combateState.resolviendo) return; // guarda de doble-clic: no cambiar de modo a media resolución
        combateState.modo = btn.dataset.modo;
        renderControlModo();
        renderTactico();
      });
    });
    modoEl.querySelectorAll(".modo-vel").forEach(btn => {
      btn.addEventListener("click", () => {
        combateState.velocidad = Number(btn.dataset.vel);
        renderControlModo();
      });
    });
    modoEl.querySelector("#btn-detener-auto")?.addEventListener("click", () => {
      combateState.modo = "manual";
      renderControlModo();
      renderTactico();
    });
  }
  renderControlModo();

  // Pulsa "Continuar" en cuanto el resultado de la tirada está pintado —
  // solo se usa para acciones resueltas automáticamente (compañeros/auto
  // completo): un jugador manual sigue pulsando "Continuar" él mismo,
  // porque ahí es donde decide si gasta un Punto Épico (Iteración 6, no se
  // toca). No interrumpe la animación del dado, solo evita la espera de un
  // clic AL FINAL, cuando ya no hay ninguna decisión real que tomar.
  function autoContinuarSiProcede() {
    const intervalo = setInterval(() => {
      const btn = document.querySelector(".roll-overlay #rl-continuar");
      if (btn && !btn.hidden) {
        clearInterval(intervalo);
        setTimeout(() => btn.click(), ms(300, combateState.velocidad));
      }
    }, 80);
  }

  function siguienteTurno() {
    combateState.resolviendo = false;
    renderTactico();
    if (enemigosVivos().length === 0) {
      accionesEl.innerHTML = "";
      turnoEl.textContent = "Victoria";
      aplicarConsecuencias(escena.onVictory, party[0].baseId, { onTexto: () => {} });
      return;
    }
    if (partyVivo().length === 0) return; // gestionado en el momento de la muerte

    if (combateState.orden.length === 0) generarOrden();
    const evento = combateState.orden.shift();
    renderOrden();

    // Actuación nueva, recursos completos (punto 5/16 del encargo) --
    // ver comentario de combateState más arriba.
    combateState.activationCounter += 1;
    combateState.activation = createActivation({
      actorId: evento.id, round: combateState.round, activationIndex: combateState.activationCounter
    });
    // Fase 4A (punto 14 del encargo): un efecto "hasta la siguiente
    // actuación" (defensa dividida/Esquiva total/movimiento evasivo) expira
    // exactamente aquí -- cuando a ESE actor le vuelve a tocar actuar, nunca
    // por round+1 (semántica "tu turno" ya cerrada, COMBAT_CANON_MATRIX.md
    // punto 3).
    delete combateState.efectosDefensivos[evento.id];

    const miembroActor = party.find(m => m.baseId === evento.id);
    if (miembroActor) {
      if (!partyVivo().includes(miembroActor)) return siguienteTurno();
      turnoEl.textContent = `Turno de ${miembroActor.base.nombre}`;
      const esPJ = esJugador(miembroActor.baseId);
      const modoAutoParaEste = combateState.modo === "automatico" || (combateState.modo === "pj_manual_auto" && !esPJ);
      if (modoAutoParaEste) {
        combateState.resolviendo = true;
        accionesEl.innerHTML = "";
        const armaInfo = habilidadArmaDe(miembroActor.base);
        setTimeout(() => ejecutarAccionAutomatica(miembroActor, armaInfo), ms(500, combateState.velocidad));
      } else if (esPJ) {
        renderAccionesJugador(miembroActor);
      } else {
        renderAccionesCompanero(miembroActor);
      }
    } else {
      const enemigo = enemigos.find(e => e.id === evento.id);
      if (!enemigo || enemigo.pv <= 0) return siguienteTurno();
      turnoEl.textContent = `Turno de ${enemigo.nombre}`;
      accionesEl.innerHTML = "";
      combateState.resolviendo = true;
      setTimeout(() => turnoEnemigo(enemigo), ms(700, combateState.velocidad));
    }
  }

  // Elige objetivo cuando hay más de un enemigo vivo. Con uno solo, se ataca
  // directamente sin preguntar (no añadir fricción cuando no hay elección real).
  function elegirObjetivo(onElegido) {
    const vivos = enemigosVivos();
    if (vivos.length <= 1) return onElegido(vivos[0]);

    const overlay = document.createElement("div");
    overlay.className = "roll-overlay";
    overlay.innerHTML = `
      <div class="roll-card">
        <div class="roll-header">Elegir objetivo</div>
        <div class="delegar-lista">
          ${vivos.map(e => `
            <button class="delegar-opcion" data-id="${e.id}">
              <span>${e.nombre}</span>
              <span class="deleg-hab">${estadoVisibleEnemigo(e)}</span>
            </button>`).join("")}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll(".delegar-opcion").forEach(btn => {
      btn.addEventListener("click", () => {
        overlay.remove();
        onElegido(vivos.find(e => e.id === btn.dataset.id));
      });
    });
  }

  // Cobertura variable (docs/DESIGN.md, "próxima iteración" #2): la escena
  // declara qué objetos sirven de cobertura y qué nivel dan (src/rules/cover.js),
  // en vez de un único valor fijo cableado en el motor. Sin objetos declarados,
  // se mantiene un nivel genérico para no romper escenas de combate antiguas.
  function opcionesCobertura() {
    return escena.coberturaDisponible?.length
      ? escena.coberturaDisponible
      : [{ id: "cobertura_generica", etiqueta: "la cobertura disponible", nivel: "solida" }];
  }

  function elegirCobertura(onElegida) {
    const opciones = opcionesCobertura();
    if (opciones.length <= 1) return onElegida(opciones[0]);

    const overlay = document.createElement("div");
    overlay.className = "roll-overlay";
    overlay.innerHTML = `
      <div class="roll-card">
        <div class="roll-header">Elegir cobertura</div>
        <div class="delegar-lista">
          ${opciones.map(o => `
            <button class="delegar-opcion" data-id="${o.id}">
              <span>${o.etiqueta}</span>
              <span class="deleg-hab">${etiquetaCoberturaVisible(o.nivel)}</span>
            </button>`).join("")}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll(".delegar-opcion").forEach(btn => {
      btn.addEventListener("click", () => {
        overlay.remove();
        onElegida(opciones.find(o => o.id === btn.dataset.id));
      });
    });
  }

  // Cuánta munición consume cada acción — regla fija QS L.166-168 (punto 5
  // del encargo): Disparo 1, Ráfaga 3. Nunca se confunde con el bonus de
  // éxitos de cadencia (modificadorCadencia), que es un efecto de la
  // tirada, no de cuánta munición se gasta.
  const COSTO_MUNICION = { disparar: 1, rafaga: 3 };

  // Recurso de movimiento por click de "Mover" (punto 8/10 del encargo):
  // sin sistema espacial real en este renderer (no hay mapa/grid), un
  // click abstracto consume un tramo fijo -- suficiente para demostrar
  // movimiento DIVIDIDO de verdad en la UI (varios clicks, con una acción
  // en medio) sin inventar coordenadas tácticas. Ver docs/COMBAT_PHASE3_RESULT.md,
  // "RENDERER_MOVEMENT_LIMITED".
  const TRAMO_MOVIMIENTO_METROS = 5;

  // Fase 4A: etiqueta de "Recargar" que muestra el progreso 1/2, 2/3, etc.
  // cuando el arma necesita más de una acción (AUTHOR_CLARIFICATION,
  // COMBAT_CANON_MATRIX.md punto 4) -- sin progreso en curso, etiqueta normal.
  function reglaMuestraRecarga(miembro) {
    if (!miembro.recarga) return "Recargar";
    return `Recargar (${miembro.recarga.progress}/${miembro.recarga.required})`;
  }

  // Fase 4A: avanza (o inicia) el progreso de recarga del arma activa de un
  // combatiente -- vive en el runtime del combatiente (miembro.recarga /
  // enemigo.recarga), NUNCA en activationState (punto 5 del encargo: debe
  // sobrevivir entre actuaciones). Solo transfiere reserva->cargador
  // (recargarArma real, gameState.js) cuando el progreso se completa.
  function avanzarRecargaDe(combatiente, armaData) {
    const required = costeAccionesPorTamano(armaData?.tamano);
    return avanzarProgreso(combatiente.recarga, required);
  }

  // HUD compacto de la actuación en curso (punto 22: nada de card soup).
  // "Menor ✓" se muestra siempre disponible porque ningún intent la
  // consume todavía (punto 20 del encargo) -- documentado, no inventado.
  function renderRecursosActuacion() {
    const activation = combateState.activation;
    if (!activation) return "";
    const principal = activation.mainActionAvailable ? "✓" : "✗";
    const menor = activation.minorActionAvailable ? "✓" : "✗";
    return `<div class="combate-recursos-actuacion">
      <span>Principal ${principal}</span>
      <span>Menor ${menor}</span>
      <span>Movimiento ${movementRemaining(activation)}/${activation.movementTotal} m</span>
    </div>`;
  }

  function renderAccionesJugador(miembro) {
    const base = miembro.base;
    const armaInfo = habilidadArmaDe(base);
    accionesEl.innerHTML = renderRecursosActuacion();

    const tieneArmaDistancia = !!(base.arma && miembro.municion);
    const cargador = miembro.municion?.cargador ?? 0;
    const reserva = miembro.municion?.reserva ?? 0;
    const magSize = base.arma?.magazineSize ?? cargador;
    const activation = combateState.activation;
    const principalDisponible = activation ? activation.mainActionAvailable : true;
    const movRestante = activation ? movementRemaining(activation) : 0;

    if (tieneArmaDistancia) {
      const armaEl = document.createElement("div");
      armaEl.className = "combate-hud-arma";
      armaEl.innerHTML = `<span class="hud-arma-nombre">${base.arma.nombre}</span><span class="hud-arma-municion">${cargador} / ${reserva}</span>`;
      accionesEl.appendChild(armaEl);
    }

    // Fase 4A (punto 10 del encargo): CHANGE_WEAPON es la acción menor real
    // de CAP03:555 ("cambiar de arma") -- cuando el actor lleva las dos
    // clases de arma, Disparo/Ráfaga y Cuerpo a cuerpo ya NO están
    // disponibles simultáneamente (CANON_PHASE4_BEHAVIOR: antes de Fase 4
    // ambas convivían siempre, DIGITAL_ADAPTATION de Fase 1/2 sin base
    // canónica -- ver docs/COMBAT_PHASE4_RESULT.md). Cambiar de arma solo
    // tiene sentido si hay dos armas reales entre las que elegir.
    const tieneArmaCC = !!base.armaCC && base.armaCC.danio > 0;
    const puedeCambiarArma = tieneArmaDistancia && tieneArmaCC;
    const armaActivaEsDistancia = miembro.armaActiva === "distancia";
    const menorDisponible = activation ? activation.minorActionAvailable : true;

    const acciones = [
      // "principal" es la primera acción ofensiva disponible (disparar si
      // el actor lleva arma a distancia, si no cuerpo a cuerpo) — nunca
      // hardcodeada por id, se decide por lo que el propio actor lleva
      // encima (dato, no una lista de casos especiales). Gateadas también
      // por si la acción principal de la actuación ya se gastó (Fase 3), y
      // por armaActiva (Fase 4: no se puede disparar con el arma CC en
      // mano, ni golpear con el arma a distancia en mano).
      { id: "disparar", etiqueta: "Disparo", tag: "[1]", visible: tieneArmaDistancia && armaActivaEsDistancia && principalDisponible, disabled: cargador < COSTO_MUNICION.disparar, rol: "principal" },
      { id: "rafaga", etiqueta: "Ráfaga", tag: "[3]", visible: tieneArmaDistancia && armaActivaEsDistancia && principalDisponible && base.arma?.cadenciaMax && base.arma.cadenciaMax !== "Tiro a tiro", disabled: cargador < COSTO_MUNICION.rafaga, rol: "secundaria" },
      { id: "recargar", etiqueta: reglaMuestraRecarga(miembro), visible: tieneArmaDistancia && armaActivaEsDistancia && (cargador < magSize || miembro.recarga), disabled: reserva <= 0 && !miembro.recarga, rol: "secundaria" },
      { id: "cc", etiqueta: "Cuerpo a cuerpo", visible: tieneArmaCC && (!tieneArmaDistancia || !armaActivaEsDistancia) && principalDisponible, rol: tieneArmaDistancia ? "secundaria" : "principal" },
      { id: "cambiar_arma", etiqueta: armaActivaEsDistancia ? `Cambiar a ${base.armaCC.nombre}` : `Cambiar a ${base.arma.nombre}`, visible: puedeCambiarArma && menorDisponible, rol: "secundaria" },
      { id: "defensa_dividida", etiqueta: "División defensiva (CC)", visible: tieneArmaCC && !armaActivaEsDistancia && principalDisponible, rol: "secundaria" },
      { id: "esquiva_total", etiqueta: "Esquiva total (CC)", visible: tieneArmaCC && !armaActivaEsDistancia && principalDisponible, rol: "secundaria" },
      { id: "movimiento_evasivo", etiqueta: "Movimiento evasivo", visible: principalDisponible, rol: "secundaria" },
      { id: "cubrirse", etiqueta: "Cubrirse", visible: true, rol: "secundaria" },
      { id: "mover", etiqueta: `Mover (${Math.min(TRAMO_MOVIMIENTO_METROS, movRestante)}m)`, visible: movRestante > 0, rol: "secundaria" },
      { id: "finalizar", etiqueta: "Finalizar actuación", visible: true, rol: "secundaria" },
      { id: "huir", etiqueta: "Huir", visible: true, rol: "salida" }
    ];

    acciones.filter(a => a.visible).forEach(a => {
      const btn = document.createElement("button");
      btn.className = `btn-accion btn-accion-${a.rol}`;
      btn.disabled = !!a.disabled;
      if (a.id === "disparar" || a.id === "rafaga") {
        const prob = Math.min(100, armaInfo.valor);
        btn.innerHTML = `${a.etiqueta} <span class="combate-tag">${a.tag}</span> <span class="combate-prob">(${prob}%${a.id === "rafaga" ? " +cadencia" : ""})</span>`;
        if (a.disabled) btn.title = "Sin munición suficiente en el cargador";
      } else if (a.id === "recargar") {
        btn.textContent = a.etiqueta;
        if (a.disabled) btn.title = "Sin munición de reserva";
      } else {
        btn.textContent = a.etiqueta;
      }
      btn.addEventListener("click", () => {
        if (combateState.resolviendo) return; // guarda de doble-clic (punto 41)
        ejecutarAccionJugador(miembro, a.id, armaInfo);
      });
      accionesEl.appendChild(btn);
    });
  }

  // Turno de un compañero de grupo (no el jugador): menú reducido, más
  // "Automático" para no obligar a microgestionar a todo el grupo. Sin IA
  // compleja — Automático es una regla fija y previsible (ver elegirAccionAutomatica).
  function renderAccionesCompanero(miembro) {
    const base = miembro.base;
    const armaInfo = habilidadArmaDe(base);
    accionesEl.innerHTML = renderRecursosActuacion();

    const aviso = document.createElement("div");
    aviso.className = "combate-companero-aviso";
    aviso.textContent = `${base.nombre} puede actuar`;
    accionesEl.appendChild(aviso);

    const cargador = miembro.municion?.cargador ?? 0;
    const magSize = base.arma?.magazineSize ?? cargador;
    const activation = combateState.activation;
    const principalDisponible = activation ? activation.mainActionAvailable : true;
    const menorDisponible = activation ? activation.minorActionAvailable : true;
    const movRestante = activation ? movementRemaining(activation) : 0;
    const tieneArmaCC = !!base.armaCC && base.armaCC.danio > 0;
    const puedeCambiarArma = !!(base.arma && miembro.municion) && tieneArmaCC;
    const armaActivaEsDistancia = miembro.armaActiva === "distancia";

    // Menú reducido (punto 36 del encargo: "adaptar únicamente lo
    // necesario", sin card soup) -- un compañero controlado a mano recibe
    // recarga progresiva/cambio de arma/movimiento evasivo (las piezas más
    // frecuentes), pero no el menú completo de defensa activa CC que sí
    // tiene el jugador; en modo Automático ninguna de estas dos se usa.
    const acciones = [
      { id: "disparar", etiqueta: "Disparar", visible: !!(base.arma && miembro.municion) && armaActivaEsDistancia && principalDisponible, disabled: cargador < COSTO_MUNICION.disparar },
      { id: "cc", etiqueta: "Cuerpo a cuerpo", visible: tieneArmaCC && !armaActivaEsDistancia && principalDisponible },
      { id: "cambiar_arma", etiqueta: armaActivaEsDistancia ? `Cambiar a ${base.armaCC?.nombre}` : `Cambiar a ${base.arma?.nombre}`, visible: puedeCambiarArma && menorDisponible },
      { id: "recargar", etiqueta: reglaMuestraRecarga(miembro), visible: !!(base.arma && miembro.municion) && armaActivaEsDistancia && (cargador < magSize || miembro.recarga), disabled: (miembro.municion?.reserva ?? 0) <= 0 && !miembro.recarga },
      { id: "movimiento_evasivo", etiqueta: "Movimiento evasivo", visible: principalDisponible },
      { id: "cubrirse", etiqueta: "Cubrirse", visible: true },
      { id: "mover", etiqueta: `Mover (${Math.min(TRAMO_MOVIMIENTO_METROS, movRestante)}m)`, visible: movRestante > 0 },
      { id: "finalizar", etiqueta: "Finalizar actuación", visible: true },
      { id: "automatico", etiqueta: "Automático", visible: true }
    ];

    acciones.filter(a => a.visible).forEach(a => {
      const btn = document.createElement("button");
      btn.className = "btn-accion";
      btn.disabled = !!a.disabled;
      btn.textContent = a.etiqueta;
      btn.addEventListener("click", () => {
        if (combateState.resolviendo) return;
        if (a.id === "automatico") return ejecutarAccionAutomatica(miembro, armaInfo);
        ejecutarAccionJugador(miembro, a.id, armaInfo);
      });
      accionesEl.appendChild(btn);
    });
  }

  // Regla fija y transparente, no una IA compleja (punto 13 del encargo):
  //   1. si necesita recargar y puede -> recarga;
  //   2. si tiene arma a distancia con munición -> dispara al objetivo con
  //      menos vida visible;
  //   3. si no puede disparar (sin munición o sin arma) -> se cubre.
  // Nunca usa información que el personaje no tendría (solo estado visible:
  // estadoVisibleEnemigo(), nunca los PV exactos). Reutiliza exactamente
  // dispararA()/mostrarTirada() — el mismo resolvedor que el modo manual,
  // nunca un simulador aparte (punto 14).
  function ejecutarAccionAutomatica(miembro, armaInfo) {
    const base = miembro.base;
    const cargador = miembro.municion?.cargador ?? 0;
    const magSize = base.arma?.magazineSize ?? cargador;

    if (miembro.municion && cargador < COSTO_MUNICION.disparar && miembro.municion.reserva > 0) {
      // Fase 4A: mismo progreso 1/2/3 que el modo manual -- ver
      // avanzarRecargaDe(). Sin IA de movimiento (punto 21 del encargo, ya
      // establecido en Fase 3): termina la actuación igual que antes,
      // complete o no la recarga en esta pasada.
      const progreso = avanzarRecargaDe(miembro, base.arma);
      const { activation: nuevaActivation } = applyResourceCost(combateState.activation, { type: "RELOAD" });
      combateState.activation = nuevaActivation;
      if (progreso.completo) {
        miembro.recarga = null;
        const transferido = recargarArma(miembro.baseId);
        log(`${base.nombre} (automático) completa la recarga — ${transferido} proyectiles al cargador.`);
      } else {
        miembro.recarga = progreso;
        log(`${base.nombre} (automático) recarga (${progreso.progress}/${progreso.required}).`);
      }
      return siguienteTurno();
    }
    if (base.arma && miembro.municion && cargador >= COSTO_MUNICION.disparar) {
      const vivos = enemigosVivos();
      const objetivoDebil = [...vivos].sort((a, b) => a.pv - b.pv)[0];
      log(`${base.nombre} (automático) dispara al objetivo más débil visible.`);
      // automatico:true (punto 23 del encargo Fase 3) -- sin IA táctica de
      // movimiento, termina la actuación en cuanto actúa, tenga o no
      // movimiento sobrante disponible.
      dispararA(miembro, "disparar", armaInfo, objetivoDebil, { automatico: true });
      autoContinuarSiProcede();
    } else {
      const opcion = opcionesCobertura()[0];
      const nivel = valorCobertura(opcion.nivel);
      miembro.cobertura = nivel;
      establecerCobertura(miembro.baseId, nivel);
      log(`${base.nombre} (automático) se cubre tras ${opcion.etiqueta.toLowerCase()} (${etiquetaCoberturaVisible(opcion.nivel)}).`);
      siguienteTurno();
    }
  }

  // Ayudar no disponible para ataques directos por fidelidad a reglas: ni el
  // QS ni el manual (CAP03 líneas 213-223) describen tiradas colaborativas
  // para un ataque — solo para tareas compartidas (forzar, cargar, examinar,
  // puentear...). Un ataque en combate ya tiene sus propios mecanismos de
  // apoyo real (cadencia, cobertura, iniciativa); sumar Ayudar al daño sería
  // una regla no publicada. Por eso "Disparar"/"Ráfaga"/"Cuerpo a cuerpo" van
  // directos a `elegirObjetivo` sin pasar por `ejecutarInteraccion`/Ayudar,
  // a diferencia de "Cubrirse" (que si es data-driven, ver cover.js) y de las
  // interacciones de la persecución (ver docs/QS_RULE_MAP.md, fila "Ayudar").
  function ejecutarAccionJugador(miembro, id, armaInfo) {
    const base = miembro.base;

    if (id === "cubrirse") {
      return elegirCobertura(opcion => {
        const nivel = valorCobertura(opcion.nivel);
        miembro.cobertura = nivel;
        establecerCobertura(miembro.baseId, nivel);
        log(`${base.nombre} se agazapa tras ${opcion.etiqueta.toLowerCase()} (${etiquetaCoberturaVisible(opcion.nivel)}) hasta su próxima acción ofensiva.`);
        siguienteTurno();
      });
    }
    if (id === "mover") {
      const activation = combateState.activation;
      const distancia = Math.min(TRAMO_MOVIMIENTO_METROS, movementRemaining(activation));
      const { activation: nuevaActivation, events } = applyResourceCost(activation, { type: "MOVE", distance: distancia });
      combateState.activation = nuevaActivation;
      log(`${base.nombre} se reposiciona (${distancia}m — quedan ${movementRemaining(nuevaActivation)}m).`);
      return continuarOFinalizarActuacion(miembro);
    }
    if (id === "finalizar") {
      const { activation: nuevaActivation } = applyResourceCost(combateState.activation, { type: "END_ACTIVATION" });
      combateState.activation = nuevaActivation;
      log(`${base.nombre} da por terminada su actuación.`);
      return siguienteTurno();
    }
    if (id === "recargar") {
      // CANON_PHASE4_BEHAVIOR (docs/COMBAT_PHASE4_RESULT.md, bloque 4A):
      // sustituye el LEGACY_BEHAVIOR_PENDING_PHASE4 de Fase 3 -- recargar
      // consume UNA acción principal por ejecución, con progreso 1/2/3
      // según el tamaño del arma (AUTHOR_CLARIFICATION). Solo transfiere
      // reserva->cargador cuando el progreso se completa.
      const progreso = avanzarRecargaDe(miembro, base.arma);
      const { activation: nuevaActivation } = applyResourceCost(combateState.activation, { type: "RELOAD" });
      combateState.activation = nuevaActivation;
      if (!progreso.completo) {
        miembro.recarga = progreso;
        log(`${base.nombre} recarga (${progreso.progress}/${progreso.required}) -- necesita seguir en su próxima actuación.`);
        return continuarOFinalizarActuacion(miembro);
      }
      miembro.recarga = null;
      const transferido = recargarArma(miembro.baseId);
      log(`${base.nombre} completa la recarga — ${transferido} ${transferido === 1 ? "proyectil pasa" : "proyectiles pasan"} al cargador (${miembro.municion.cargador}/${miembro.municion.reserva}).`);
      return continuarOFinalizarActuacion(miembro);
    }
    if (id === "cambiar_arma") {
      // CAP03:555 -- acción menor real (punto 10 del encargo Fase 4).
      const { activation: nuevaActivation } = applyResourceCost(combateState.activation, { type: "CHANGE_WEAPON" });
      combateState.activation = nuevaActivation;
      miembro.armaActiva = miembro.armaActiva === "distancia" ? "cc" : "distancia";
      const nombreNueva = miembro.armaActiva === "distancia" ? base.arma.nombre : base.armaCC.nombre;
      log(`${base.nombre} cambia a ${nombreNueva}.`);
      return continuarOFinalizarActuacion(miembro);
    }
    if (id === "defensa_dividida") return declararDefensaDividida(miembro);
    if (id === "esquiva_total") return declararEsquivaTotal(miembro);
    if (id === "movimiento_evasivo") return declararMovimientoEvasivo(miembro);
    if (id === "huir") return intentarHuir(miembro);

    elegirObjetivo(objetivo => dispararA(miembro, id, armaInfo, objetivo));
  }

  // ===== Defensa activa CC + movimiento evasivo (Fase 4A, CAP03:1003-1036)
  // ===== Producen un efecto que dura "hasta la siguiente actuación" del
  // propio actor (combateState.efectosDefensivos, limpiado en
  // siguienteTurno() -- ver comentario junto a esa función). División
  // defensiva usa un reparto 50/50 redondeado a múltiplos de 5: CAP03:1007
  // no cuantifica "los mínimos existentes" del reparto (a diferencia de la
  // división de ataques múltiples, que sí exige 50/25) -- BLOCKED_CANON_QUESTION
  // documentada en docs/COMBAT_PHASE4_RESULT.md; 50/50 es una simplificación
  // de UI declarada, no una regla nueva, para no exigir un selector
  // numérico (punto 36: "no crear card soup").
  function declararDefensaDividida(miembro) {
    const base = miembro.base;
    const habilidadTotal = miembro.habilidades["Arma CC Corta"] ?? miembro.habilidades["Sin Armas"] ?? 30;
    const mitad = Math.round(habilidadTotal / 2 / 5) * 5;
    const ataque = mitad;
    const defensa = habilidadTotal - mitad;
    const { activation: nuevaActivation } = applyResourceCost(combateState.activation, { type: "DEFEND_SPLIT" });
    combateState.activation = nuevaActivation;
    combateState.resolviendo = true;
    mostrarTirada({
      actorId: miembro.baseId,
      etiquetaHabilidad: `División defensiva (${ataque} ataque / ${defensa} defensa)`,
      skillId: "Arma CC Corta",
      habilidadBase: defensa,
      dificultad: 0,
      dificultadTexto: "Normal",
      escenaId,
      onResuelto: (resultado) => {
        const exitosDefensa = resultado.exito ? resultado.exitos : 0;
        combateState.efectosDefensivos[miembro.baseId] = { tipo: "DEFEND_SPLIT", exitosDefensa };
        log(`${base.nombre} divide su habilidad CC (${ataque}/${defensa}) — ${exitosDefensa > 0 ? `defensa activa hasta su próxima actuación (${exitosDefensa} éxitos)` : "sin éxito en la tirada de defensa"}.`);
        return continuarOFinalizarActuacion(miembro);
      }
    });
  }

  function declararEsquivaTotal(miembro) {
    const base = miembro.base;
    const { activation: nuevaActivation } = applyResourceCost(combateState.activation, { type: "DODGE_TOTAL" });
    combateState.activation = nuevaActivation;
    combateState.resolviendo = true;
    mostrarTirada({
      actorId: miembro.baseId,
      etiquetaHabilidad: "Esquiva total (cuerpo a cuerpo)",
      skillId: "Esquivar",
      habilidadBase: miembro.habilidades["Esquivar"] ?? 30,
      dificultad: 0,
      dificultadTexto: "Normal",
      escenaId,
      onResuelto: (resultado) => {
        combateState.efectosDefensivos[miembro.baseId] = { tipo: "DODGE_TOTAL", cancelaDanioCC: resultado.exito };
        log(`${base.nombre} se dedica a esquivar en cuerpo a cuerpo${resultado.exito ? " — cancela el daño del próximo golpe CC hasta su próxima actuación" : ", sin éxito"}.`);
        return continuarOFinalizarActuacion(miembro);
      }
    });
  }

  function declararMovimientoEvasivo(miembro) {
    const base = miembro.base;
    const { activation: nuevaActivation } = applyResourceCost(combateState.activation, { type: "EVASIVE_MOVEMENT" });
    combateState.activation = nuevaActivation;
    combateState.resolviendo = true;
    mostrarTirada({
      actorId: miembro.baseId,
      etiquetaHabilidad: "Movimiento evasivo",
      skillId: "Esquivar",
      habilidadBase: miembro.habilidades["Esquivar"] ?? 30,
      dificultad: 0,
      dificultadTexto: "Normal",
      escenaId,
      onResuelto: (resultado) => {
        const penalizador = modificadorMovimientoEvasivo(resultado.exito ? resultado.exitos : 0);
        combateState.efectosDefensivos[miembro.baseId] = { tipo: "EVASIVE_MOVEMENT", penalizadorAtacantes: penalizador };
        log(`${base.nombre} se mueve de forma imprevisible${penalizador ? ` (${penalizador} a quien le dispare hasta su próxima actuación)` : ", sin éxito"}.`);
        // CAP03:1021 -- consume la actuación COMPLETA, no continuarOFinalizarActuacion().
        return siguienteTurno();
      }
    });
  }

  // Punto 15 del encargo Fase 3 ("NO AUTO-END PREMATURO"): tras resolver
  // una acción, si a la actuación le queda algún recurso canónico
  // (movimiento -- la acción principal ya se comprueba en
  // actuacionAgotada()), NO se pasa de turno automáticamente. Se vuelve a
  // pintar el menú del propio actor para que decida mover, o finalizar.
  function continuarOFinalizarActuacion(miembro) {
    if (actuacionAgotada(combateState.activation)) return siguienteTurno();
    combateState.resolviendo = false;
    if (esJugador(miembro.baseId)) renderAccionesJugador(miembro);
    else renderAccionesCompanero(miembro);
  }

  function dispararA(miembro, id, armaInfo, objetivo, opts = {}) {
    const base = miembro.base;
    if (!objetivo) return siguienteTurno();

    let habilidadBase, skillId, danioBase, cadenciaBonus = 0, etiqueta, dificultadSituacional = 0;
    if (id === "cc") {
      skillId = "Arma CC Corta";
      habilidadBase = miembro.habilidades[skillId] ?? miembro.habilidades["Sin Armas"];
      // Fase 4B: Fuerza->Daño CaC (CANON_SOURCE, CAP03:887-919) -- no muta
      // base.armaCC.danio (punto 25 del encargo), se calcula por ataque.
      danioBase = effectiveBaseDamage(base.armaCC.danio, base.atributos?.FUE ?? 0, base.armaCC.fuerzaMinima ?? 0);
      etiqueta = `${base.armaCC.nombre} cuerpo a cuerpo`;

      // Fase 4B: contexto CC del objetivo (múltiples adversarios/flanqueo,
      // docs/COMBAT_PHASE4_RESULT.md bloque 4B). El objetivo sin agencia
      // propia para "declarar" hacia quién está encarado (un enemigo con IA
      // simple) queda encarado por defecto hacia el PRIMER atacante CC que
      // lo trabó este asalto -- DIGITAL_ADAPTATION explícita, ver comentario
      // de contextoCC más arriba.
      const ctx = combateState.contextoCC;
      if (!ctx.atacantesCC[objetivo.id]) ctx.atacantesCC[objetivo.id] = [];
      if (!ctx.atacantesCC[objetivo.id].includes(miembro.baseId)) ctx.atacantesCC[objetivo.id].push(miembro.baseId);
      if (!ctx.facingTargetId[objetivo.id]) ctx.facingTargetId[objetivo.id] = miembro.baseId;
      if (isFlanking(miembro.baseId, objetivo.id, ctx)) {
        dificultadSituacional += FLANQUEO_BONUS;
        etiqueta += " (flanqueo +10)";
      }
      // Múltiples adversarios CC (CAP03:872-883): penaliza al ATACANTE si
      // ÉL MISMO está siendo trabado por varios adversarios en CC
      // simultáneamente -- se consulta ctx.atacantesCC[miembro.baseId]
      // (quién está atacando EN CC a miembro, no a objetivo). Con los datos
      // actuales de este encuentro ningún enemigo lleva arma CC, así que
      // esta lista siempre está vacía en vivo (RULES_READY, no exercisable
      // con este encuentro concreto -- ver docs/COMBAT_PHASE4_RESULT.md).
      const numAdversariosDelAtacante = ctx.atacantesCC[miembro.baseId]?.length ?? 0;
      dificultadSituacional += penalizadorMultiplesAdversarios(numAdversariosDelAtacante);
    } else {
      const costo = COSTO_MUNICION[id] ?? 1;
      if (!consumirMunicion(miembro.baseId, costo)) { log(`${base.nombre} no tiene munición suficiente.`); return siguienteTurno(); }
      skillId = armaInfo.nombre;
      habilidadBase = miembro.habilidades[skillId] ?? armaInfo.valor;
      danioBase = base.arma.danio;
      etiqueta = `${base.arma.nombre} — ${armaInfo.nombre}`;
      if (id === "rafaga") {
        cadenciaBonus = modificadorCadencia("rafaga", cadenciaData);
        etiqueta += " (Ráfaga)";
      }
    }

    miembro.cobertura = 0; // atacar rompe la cobertura activa
    establecerCobertura(miembro.baseId, 0);

    // Fase 4C: sorpresa (+20, AUTHOR_RULE_CURRENT) sobre el primer ataque
    // si el encuentro la declara -- se combina con flanqueo/múltiples
    // adversarios (Fase 4B) bajo el mismo límite situacional ±20
    // (COMBAT_CANON_MATRIX.md punto 9: nunca se aplica a Pen/Blindaje).
    const conSorpresa = aplicarSorpresaSiDisponible(dificultadSituacional, miembro.sorpresaDisponible);
    const dificultadFinal = limitarModificadorSituacional(conSorpresa);
    if (miembro.sorpresaDisponible) etiqueta += " (sorpresa +20)";

    combateState.resolviendo = true;
    mostrarTirada({
      actorId: miembro.baseId,
      etiquetaHabilidad: etiqueta,
      skillId,
      habilidadBase,
      dificultad: dificultadFinal,
      dificultadTexto: dificultadFinal === 0 ? "Normal" : (dificultadFinal > 0 ? `+${dificultadFinal}` : String(dificultadFinal)),
      escenaId,
      onResuelto: (tiradaResultado) => {
        if (id === "disparar" || id === "rafaga") flashEfecto(wrap, "fx-muzzle");
        // Sorpresa se consume tras aplicarse UNA vez, independientemente del
        // resultado (AUTHOR_RULE_CURRENT, COMBAT_CANON_MATRIX.md punto 6).
        miembro.sorpresaDisponible = false;
        aplicarResultadoAtaqueJugador(miembro, objetivo, tiradaResultado, danioBase, cadenciaBonus, base.nombre, opts.automatico, id === "cc");
      }
    });
  }

  // Antes (0.3.1 y anteriores) esta función reimplementaba a mano la fórmula
  // de Blindaje/Penetración/cadencia/daño que ya existía en combat/combat.js
  // (usada por los enemigos) -- misma matemática, escrita dos veces, sin
  // Penetración en esta copia (inofensivo hoy porque las armas del jugador
  // declaran penetracion:0, pero un riesgo real si eso cambiara). Fase 2
  // (docs/COMBAT_PHASE12_CODE_MAP.md): ahora pasa por resolveIntent(), la
  // misma función que usa turnoEnemigo() -- una sola fuente de verdad.
  //
  // Fase 3: ATTACK/BURST son canónicamente la acción principal (CAP03:555)
  // -- se consume aquí con applyResourceCost() en TODOS los desenlaces
  // (fallo, blindaje absorbe, impacto: apuntar y fallar sigue gastando tu
  // acción). `automatico` (modo auto/compañeros auto, punto 23 del
  // encargo): sin IA de movimiento, termina la actuación de inmediato en
  // vez de ofrecer mover/finalizar. Un jugador manual, si le queda
  // movimiento, sigue teniendo el control (continuarOFinalizarActuacion).
  function aplicarResultadoAtaqueJugador(actorRuntime, objetivo, tirada, danioBase, cadenciaBonus, nombreAtacante, automatico, esCC) {
    // Fase 4A: si el objetivo (un enemigo) declaró defensa activa CC, se
    // aplica aquí -- Esquiva total cancela el daño por completo, defensa
    // dividida resta sus éxitos ANTES del blindaje (resolverImpacto,
    // exitosDefensa). Ninguna IA de enemigo declara esto todavía (punto 38
    // del encargo: "no crear IA táctica sofisticada"), así que en vivo esta
    // rama nunca se activa con los enemigos actuales -- pero funciona igual
    // para cualquier objetivo que sí la tenga.
    const efectoObjetivo = esCC ? combateState.efectosDefensivos[objetivo.id ?? objetivo.baseId] : null;
    if (esCC && efectoObjetivo?.tipo === "DODGE_TOTAL" && efectoObjetivo.cancelaDanioCC) {
      log(`${objetivo.nombre} esquiva por completo el ataque de ${nombreAtacante}.`);
      const { activation: nuevaActivation } = applyResourceCost(combateState.activation, { type: cadenciaBonus > 0 ? "BURST" : "ATTACK" });
      combateState.activation = nuevaActivation;
      return automatico ? siguienteTurno() : continuarOFinalizarActuacion(actorRuntime);
    }
    const exitosDefensa = esCC && efectoObjetivo?.tipo === "DEFEND_SPLIT" ? efectoObjetivo.exitosDefensa : 0;

    const { result } = resolveIntent(
      { id: actorRuntime.baseId },
      { id: objetivo.id },
      { type: cadenciaBonus > 0 ? "BURST" : "ATTACK", tiradaYaResuelta: tirada, penetracion: 0, blindajeObjetivo: objetivo.blindaje, coberturaObjetivo: objetivo.cobertura || 0, cadenciaBonus, danioBase, exitosDefensa }
    );
    const { activation: nuevaActivation } = applyResourceCost(combateState.activation, { type: cadenciaBonus > 0 ? "BURST" : "ATTACK" });
    combateState.activation = nuevaActivation;

    function continuar() {
      if (automatico) return siguienteTurno();
      return continuarOFinalizarActuacion(actorRuntime);
    }

    if (!tirada.exito) {
      log(`${nombreAtacante} falla contra ${objetivo.nombre}.`);
      return continuar();
    }
    if (!result.impacto) {
      log(exitosDefensa > 0 ? `${objetivo.nombre} defiende el golpe de ${nombreAtacante}.` : `El blindaje de ${objetivo.nombre} absorbe el impacto.`);
      return continuar();
    }
    objetivo.pv -= result.danioFinal;
    flashEfecto(wrap, "fx-impact");
    log(`${tirada.esCritico ? "¡CRÍTICO! " : ""}${nombreAtacante} impacta a ${objetivo.nombre} por ${result.danioFinal} de daño (${result.exitosNetos} éxitos netos).`);
    if (objetivo.pv <= 0) log(`${objetivo.nombre} cae.`);
    continuar();
  }

  function intentarHuir(miembro) {
    combateState.resolviendo = true;
    mostrarTirada({
      actorId: miembro.baseId,
      etiquetaHabilidad: "Movimiento evasivo para huir",
      skillId: "Esquivar",
      habilidadBase: miembro.habilidades["Esquivar"] ?? 30,
      dificultad: -10,
      dificultadTexto: "Difícil",
      escenaId,
      onResuelto: (resultado) => {
        if (resultado.exito) {
          aplicarConsecuencias(escena.onFlee, miembro.baseId, {
            onTexto: () => log(`${miembro.base.nombre} rompe el contacto y corre calle abajo.`)
          });
        } else {
          log(`${miembro.base.nombre} no consigue zafarse. Sigue en combate.`);
          siguienteTurno();
        }
      }
    });
  }

  function turnoEnemigo(enemigo) {
    const objetivos = partyVivo();
    if (objetivos.length === 0) return;
    const objetivo = objetivos[Math.floor(Math.random() * objetivos.length)];

    // Munición del enemigo (si su arma la declara): sin cargador suficiente
    // para ráfaga, cae a tiro simple; sin nada de cargador, no dispara ese
    // turno (misma regla que el jugador — punto 6 del encargo).
    const tieneMunicionEnemigo = !enemigo.municion || enemigo.municion.cargador >= 1;
    if (!tieneMunicionEnemigo) {
      log(`${enemigo.nombre} se queda sin munición y se cubre.`);
      enemigo.cobertura = valorCobertura("parcial");
      return siguienteTurno();
    }
    const puedeRafaga = !enemigo.municion || enemigo.municion.cargador >= 3;
    const usaRafaga = puedeRafaga && Math.random() > 0.5;
    if (enemigo.municion) enemigo.municion.cargador -= (usaRafaga ? 3 : 1);
    const cadenciaBonus = usaRafaga ? modificadorCadencia("rafaga", cadenciaData) : 0;
    const cobertura = objetivo.cobertura || 0;
    enemigo.cobertura = 0; // atacar rompe su propia cobertura, igual que al jugador

    // Punto 25 del encargo Fase 3: los enemigos también reciben recursos de
    // actuación (creados en siguienteTurno()), pero su IA no sabe usar
    // movimiento -- consumen la acción principal y terminan, sin ofrecer
    // "mover"/"finalizar" (no hay UI para enemigos). El recurso está
    // disponible según canon aunque no se aproveche.
    ({ activation: combateState.activation } = applyResourceCost(combateState.activation, { type: usaRafaga ? "BURST" : "ATTACK" }));

    // Verbo genérico según el tipo de arma del enemigo (dato, no lógica
    // específica de ningún módulo) — evita que una criatura cuerpo a cuerpo
    // (arma.tipo:"cc") "dispare" en el registro de combate.
    const esCC = enemigo.arma?.tipo === "cc";
    const verboAccion = esCC ? "ataca a" : "dispara a";
    const verboImpacto = esCC ? "el golpe" : "el disparo";

    // Fase 4A: efecto defensivo declarado por el objetivo "hasta su
    // próxima actuación" (docs/COMBAT_PHASE4_RESULT.md). Movimiento
    // evasivo penaliza la Habilidad efectiva de CUALQUIER atacante a
    // distancia (CAP03:1017-1036) -- esto SÍ es exercisable en vivo con
    // enemigos que disparan. Esquiva total/defensa dividida solo protegen
    // contra CC (CAP03:1015/1040) -- con los enemigos actuales (todos a
    // distancia) esas dos ramas son RULES_READY pero no exercisables en
    // vivo con los encuentros existentes.
    const efectoObjetivo = combateState.efectosDefensivos[objetivo.baseId];
    // DODGE_TOTAL no protege contra disparos (CAP03:1015) -- solo se
    // consulta cuando esCC es true, a propósito.
    if (esCC && efectoObjetivo?.tipo === "DODGE_TOTAL" && efectoObjetivo.cancelaDanioCC) {
      log(`${objetivo.base.nombre} esquiva por completo el golpe de ${enemigo.nombre}.`);
      return siguienteTurno();
    }
    const exitosDefensa = esCC && efectoObjetivo?.tipo === "DEFEND_SPLIT" ? efectoObjetivo.exitosDefensa : 0;
    const penalizadorEvasivo = !esCC && efectoObjetivo?.tipo === "EVASIVE_MOVEMENT" ? efectoObjetivo.penalizadorAtacantes : 0;

    // Fase 4B: FUE->Daño CaC del enemigo (CANON_SOURCE, CAP03:887-919) --
    // los enemigos de los encuentros existentes son todos "distancia"
    // (esCC=false), así que danioBase coincide siempre con
    // enemigo.arma.danio en vivo; wireado igual para cualquier enemigo CC
    // futuro.
    const danioBaseEnemigo = esCC
      ? effectiveBaseDamage(enemigo.arma.danio, enemigo.fuerza ?? 0, enemigo.arma.fuerzaMinima ?? 0)
      : enemigo.arma.danio;

    // Fase 4C: sorpresa del enemigo (si el encuentro la declara para
    // "enemigos" -- ningún encuentro existente lo hace, ver inicialización
    // de sorpresaDisponible más arriba) + límite situacional ±20.
    const dificultadSituacional = limitarModificadorSituacional(
      aplicarSorpresaSiDisponible(penalizadorEvasivo, enemigo.sorpresaDisponible)
    );
    enemigo.sorpresaDisponible = false;

    // Fase 2: mismo resolveIntent() que usa el jugador (aplicarResultadoAtaqueJugador)
    // -- una sola ruta de resolución para ambos lados del combate.
    const { result: resultado } = resolveIntent(
      { id: enemigo.id }, { id: objetivo.baseId },
      {
        type: usaRafaga ? "BURST" : "ATTACK",
        habilidadBase: enemigo.distancia,
        dificultad: dificultadSituacional,
        penetracion: 0,
        blindajeObjetivo: objetivo.base.armadura?.blindaje ?? 0,
        coberturaObjetivo: cobertura,
        cadenciaBonus,
        danioBase: danioBaseEnemigo,
        exitosDefensa
      }
    );

    if (!resultado.exito) {
      log(`${enemigo.nombre} ${verboAccion} ${objetivo.base.nombre} (tirada ${resultado.tiradaTexto} vs ${enemigo.distancia}) y falla.`);
      return siguienteTurno();
    }
    if (resultado.exitosNetos <= 0) {
      log(`${enemigo.nombre} impacta a ${objetivo.base.nombre} (tirada ${resultado.tiradaTexto}) pero su protección absorbe ${verboImpacto}.`);
      return siguienteTurno();
    }

    log(`${resultado.esCritico ? "¡CRÍTICO! " : ""}${enemigo.nombre} alcanza a ${objetivo.base.nombre} en ${resultado.localizacion} por ${resultado.danioFinal} de daño.`);
    flashEfecto(wrap, "fx-danio");
    if (config.visualEffects.screenShake) {
      wrap.classList.remove("screen-shake");
      void wrap.offsetWidth;
      wrap.classList.add("screen-shake");
    }
    const muerte = aplicarDanio(objetivo.baseId, resultado.localizacion, resultado.danioFinal);

    if (muerte) {
      if (objetivo.puntosEpicosActuales > 0) {
        // Bajo control automático (compañero en modo auto, o CUALQUIERA en
        // AUTOMÁTICO) nadie va a pulsar este diálogo — dejarlo esperando
        // congelaría el combate para siempre (punto 15/36 del encargo: el
        // motor nunca debe quedarse colgado en un modo automático). La
        // decisión por defecto de un piloto automático es sobrevivir:
        // gastar el Punto Épico, igual que casi cualquier jugador real
        // elegiría en su lugar. En modo manual (o PJ manual con este
        // miembro bajo control humano) se sigue preguntando de verdad.
        const bajoControlAutomatico = combateState.modo === "automatico"
          || (combateState.modo === "pj_manual_auto" && !esJugador(objetivo.baseId));
        if (bajoControlAutomatico) {
          log(`${objetivo.base.nombre} (automático) gasta un Punto Épico para sobrevivir al golpe.`);
          gastarPuntoEpico(objetivo.baseId);
          establecerDisponibilidad(objetivo.baseId, "inconsciente");
          aplicarConsecuencias(escena.onDeathWithEpicPoint, objetivo.baseId, { onTexto: () => {} });
          return;
        }
        mostrarConfirmPE(objetivo, () => {
          gastarPuntoEpico(objetivo.baseId);
          establecerDisponibilidad(objetivo.baseId, "inconsciente");
          aplicarConsecuencias(escena.onDeathWithEpicPoint, objetivo.baseId, { onTexto: () => {} });
        }, () => {
          aplicarConsecuencias(escena.onDeath, objetivo.baseId, { onTexto: () => {} });
        });
        return;
      }
      aplicarConsecuencias(escena.onDeath, objetivo.baseId, { onTexto: () => {} });
      return;
    }

    siguienteTurno();
  }

  function mostrarConfirmPE(objetivo, onSi, onNo) {
    const overlay = document.createElement("div");
    overlay.className = "roll-overlay";
    overlay.innerHTML = `
      <div class="roll-card">
        <div class="roll-header">Golpe mortal — ${objetivo.base.nombre}</div>
        <p style="font-size:.85em;line-height:1.5">El impacto debería haber matado a ${objetivo.base.nombre}.
        Puedes gastar 1 de sus Puntos Épicos para activar <em>"Parecía que había muerto"</em>: queda
        inconsciente y estabilizado en vez de morir.</p>
        <button class="btn-epico" id="pe-si">Gastar Punto Épico</button>
        <button class="btn-continuar" id="pe-no" style="margin-top:8px">No — asumir las consecuencias</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#pe-si").addEventListener("click", () => { overlay.remove(); onSi(); });
    overlay.querySelector("#pe-no").addEventListener("click", () => { overlay.remove(); onNo(); });
  }

  renderTactico();
  siguienteTurno();
}
