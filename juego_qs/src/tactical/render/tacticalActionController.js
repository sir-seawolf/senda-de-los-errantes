// Controlador de acciones tácticas -- extraído de TacticalScene.js
// (Production Integration Phase 6, docs/TACTICAL_PRODUCTION_PHASE6_AUDIT.md
// §5) para que la interfaz DOM responsive (6B) y el futuro renderer
// oblicuo (6C) puedan invocar EXACTAMENTE la misma lógica de acciones
// que hoy vive dentro de TacticalScene, sin duplicar ni una línea de
// reglas. Cero cambios de comportamiento respecto al código que
// sustituye -- misma secuencia de validateIntent()/applyResourceCost()/
// resolveIntent(), mismos mensajes de log, mismas condiciones de
// rechazo. Puramente JS, sin Phaser, sin DOM -- testeable en Node.
//
// PRINCIPIO (Phase 6, "Autoridad y alcance"): este archivo NO decide
// presentación (FX, sprites, HUD) -- solo ejecuta el intent contra el
// Rules Engine real y notifica el resultado vía callbacks. El caller
// (TacticalScene hoy, la UI DOM y el futuro renderer oblicuo mañana)
// decide qué pintar.
import {
  createActivation, movementRemaining, applyResourceCost,
  validateIntent, resolveIntent, avanzarProgreso, costeAccionesPorTamano, cambiarArma,
  resolverEsquivaTotal, resolverMovimientoEvasivo, penalizadorPorNivel, nivelHeridaDe,
  COSTO_MUNICION, modificadorCadencia
} from "../bridge/qsRulesBridge.js";
import { toQsActor, toQsAttackIntent, armaActivaDe, municionArmaActivaDe } from "../bridge/qsDataAdapter.js";
import { puntoAlcanzable } from "../spatial/terrainZones.js";

/**
 * @param {object} opts
 * @param {object} opts.session - TacticalSession real
 * @param {object} opts.adapter - SpatialCombatAdapter real
 * @param {() => number} [opts.rng] - inyectable para tests/Playwright
 * @param {{log?:Function, onAtaqueResuelto?:Function, onRechazo?:Function, onEstadoCambiado?:Function}} [opts.callbacks]
 */
// Separación mínima entre dos actores vivos (encargo de cierre
// vertical, 2026-08-22 -- Hallazgo 6 del playtest real: cruzarse o
// disputar la posición del perseguidor dejaba a dos actores exactamente
// en la misma casilla, y el actor dibujado encima ocultaba por completo
// al otro -- reproducido: mover al PJ sobre un enemigo lo deja
// invisible, tapado bajo el sprite enemigo, sin forma de saber dónde
// está). No existía ningún concepto de ocupación en el core -- se
// añade aquí, en el controlador compartido (mismo código para el
// renderer cenital y el oblicuo, cero duplicación). No es una física
// real: es la garantía mínima "dos actores no pueden ocupar la misma
// posición" que pide el encargo, expresada como el mismo tipo de
// recorte que ya aplica `movementRemaining` -- moverse HACIA un actor
// ocupado se detiene justo antes de tocarlo, nunca lo atraviesa ni lo
// pisa. 0.6m ~ hombro con hombro, coherente con humanos adultos en el
// mismo espacio de combate (menor que coverRadiusMeters=2.2, que es
// cobertura, no ocupación física).
const SEPARACION_MINIMA_METROS = 0.6;

// Recorta `distanciaMax` (a lo largo del rayo origen->destino) para que
// el punto de llegada nunca quede a menos de SEPARACION_MINIMA_METROS
// de otro actor vivo. Geometría estándar rayo-círculo: para cada actor
// bloqueante se calcula el punto de entrada a su círculo de exclusión
// (si el rayo llega a cruzarlo) y se conserva el más restrictivo.
function distanciaClampeadaPorOcupacion(origenX, origenY, dx, dy, distanciaMax, actoresOcupando) {
  if (distanciaMax <= 0) return distanciaMax;
  let limite = distanciaMax;
  for (const c of actoresOcupando) {
    const ocX = c.x - origenX, ocY = c.y - origenY;
    const tc = ocX * dx + ocY * dy; // proyección sobre el rayo (dx,dy ya unitario)
    if (tc <= 0) continue; // el actor queda detrás del movimiento, no bloquea
    const distPerpCuadrado = (ocX * ocX + ocY * ocY) - tc * tc;
    const rCuadrado = SEPARACION_MINIMA_METROS * SEPARACION_MINIMA_METROS;
    if (distPerpCuadrado >= rCuadrado) continue; // el rayo pasa lejos, no entra en la zona de exclusión
    const medioAcorde = Math.sqrt(Math.max(0, rCuadrado - distPerpCuadrado));
    const tEntrada = tc - medioAcorde;
    if (tEntrada < limite) limite = Math.max(0, tEntrada);
  }
  return limite;
}

export function crearControladorAcciones({ session, adapter, rng = Math.random, callbacks = {}, cadenciaData = {}, terrainZones = [], terrainConfig = {} }) {
  const s = session;
  const log = callbacks.log ?? (() => {});
  const onAtaqueResuelto = callbacks.onAtaqueResuelto ?? (() => {});
  const onRechazo = callbacks.onRechazo ?? (() => {});
  const onEstadoCambiado = callbacks.onEstadoCambiado ?? (() => {});

  function moverA(xMetros, yMetros) {
    const actorId = s.currentActorId;
    let activation = s.activations.get(actorId);
    const validacion = validateIntent(toQsActor(s.configDe(actorId)), { type: "MOVE" }, activation);
    if (!validacion.valid) { log(`MOVE rechazado: ${validacion.reasons.join(", ")}`); return { ok: false, reasons: validacion.reasons }; }

    const pos = adapter.posicionDe(actorId);
    const distanciaSolicitada = Math.hypot(xMetros - pos.x, yMetros - pos.y);
    const restante = movementRemaining(activation);
    const alcance = puntoAlcanzable(pos, { x: xMetros, y: yMetros }, restante, terrainZones, terrainConfig);
    let distanciaReal = Math.hypot(alcance.x - pos.x, alcance.y - pos.y);

    if (distanciaReal > 0 && distanciaSolicitada > 0) {
      const dx = (xMetros - pos.x) / distanciaSolicitada, dy = (yMetros - pos.y) / distanciaSolicitada;
      const otrosVivos = [...s.vivos(s.party), ...s.vivos(s.enemies)].filter(a => a.id !== actorId);
      const posicionesOcupadas = otrosVivos.map(a => s.positions[a.id]);
      distanciaReal = distanciaClampeadaPorOcupacion(pos.x, pos.y, dx, dy, distanciaReal, posicionesOcupadas);
    }
    if (distanciaReal <= 0) {
      const motivo = distanciaSolicitada > 0 && Math.min(distanciaSolicitada, restante) > 0 ? "POSITION_OCCUPIED" : "NO_MOVEMENT_REMAINING";
      log(`${actorId}: ${motivo === "POSITION_OCCUPIED" ? "posición ocupada por otro actor." : "sin movimiento restante."}`);
      return { ok: false, reasons: [motivo] };
    }

    const t = distanciaSolicitada > 0 ? distanciaReal / distanciaSolicitada : 0;
    const nuevoX = pos.x + (xMetros - pos.x) * t, nuevoY = pos.y + (yMetros - pos.y) * t;
    const costeMovimiento = puntoAlcanzable(pos, { x: nuevoX, y: nuevoY }, Number.POSITIVE_INFINITY, terrainZones, terrainConfig).coste;

    ({ activation } = applyResourceCost(activation, { type: "MOVE", distance: costeMovimiento }));
    s.activations.set(actorId, activation);
    adapter.moverActor(actorId, nuevoX, nuevoY);
    s.moverActor(actorId, nuevoX, nuevoY);
    log(`${actorId}: MOVE ${distanciaReal.toFixed(1)}m (coste ${costeMovimiento.toFixed(1)}m) -> movementRemaining=${movementRemaining(activation).toFixed(1)}m.`);
    onEstadoCambiado();
    return { ok: true, x: nuevoX, y: nuevoY, distance: distanciaReal, movementCost: costeMovimiento };
  }

  function atacar(targetId, { cc = false, modoFuego = "tiroATiro" } = {}) {
    const actorId = s.currentActorId;
    const atacanteConfig = s.configDe(actorId), objetivoConfig = s.configDe(targetId);
    if ((!cc && armaActivaDe(atacanteConfig).noDisponible) || (cc && atacanteConfig.armaCC?.noDisponible)) {
      const reasons = [cc ? "NO_MELEE_WEAPON" : "NO_RANGED_WEAPON"];
      onRechazo({ attacker: actorId, target: targetId, reasons });
      return { ok: false, reasons };
    }
    let activation = s.activations.get(actorId);
    const qsActor = toQsActor(atacanteConfig);
    const spatialContext = cc ? null : adapter.getCover(actorId, targetId);
    const modoReal = cc ? "tiroATiro" : modoFuego;
    const cadenciaBonus = cc ? 0 : modificadorCadencia(modoReal, cadenciaData);
    const intentBase = toQsAttackIntent(atacanteConfig, objetivoConfig, { cc, modoFuego: modoReal, cadenciaBonus });
    if (cc && objetivoConfig.exitosDefensaPendiente) intentBase.exitosDefensa = objetivoConfig.exitosDefensaPendiente;

    const validacion = validateIntent(qsActor, intentBase, activation, spatialContext);
    if (!validacion.valid) {
      log(`ATTACK${cc ? " (CC)" : ""} rechazado (${actorId} -> ${targetId}): ${validacion.reasons.join(", ")}.`);
      onRechazo({ attacker: actorId, target: targetId, reasons: validacion.reasons });
      return { ok: false, reasons: validacion.reasons };
    }

    ({ activation } = applyResourceCost(activation, { type: intentBase.type }));
    s.activations.set(actorId, activation);
    if (!cc) municionArmaActivaDe(atacanteConfig).cargador -= COSTO_MUNICION[intentBase.type];

    const { result, events } = resolveIntent(qsActor, { id: targetId }, intentBase, { rng }, spatialContext);

    let danioFinal = result.danioFinal, impacto = result.impacto;
    if (cc && objetivoConfig.esquivaTotalActiva) {
      danioFinal = 0; impacto = false;
      objetivoConfig.esquivaTotalActiva = false;
      events.push({ type: "DODGE_TOTAL_CANCELLED_DAMAGE", targetId });
    }
    if (cc && objetivoConfig.exitosDefensaPendiente) objetivoConfig.exitosDefensaPendiente = 0;

    let downOcurrido = false;
    if (impacto) downOcurrido = s.aplicarDanioLocal(targetId, danioFinal);

    const detalle = {
      attacker: actorId, target: targetId, rechazado: false,
      tirada: result.tiradaTexto, exito: result.exito, esCritico: result.esCritico, esPifia: result.esPifia,
      impacto, danioFinal, localizacion: result.localizacion, downOcurrido, cobertura: spatialContext?.level ?? null,
      modoFuego: modoReal, municionConsumida: cc ? 0 : COSTO_MUNICION[intentBase.type]
    };
    log(`ATTACK${cc ? " CC" : ""} (${actorId} -> ${targetId}${spatialContext ? `, cobertura=${spatialContext.level}` : ""}): tirada=${result.tiradaTexto} ${result.exito ? "éxito" : "fallo"}${result.esCritico ? " CRIT" : ""}${result.esPifia ? " PIFIA" : ""} · ${impacto ? `impacto en ${result.localizacion}, daño=${danioFinal}${downOcurrido ? " -- ¡ABAJO!" : ""}` : "sin impacto"}. Eventos: ${events.map(e => e.type).join(", ")}.`);
    onAtaqueResuelto(detalle);
    onEstadoCambiado();
    const terminado = s.comprobarFinDeCombate();
    return { ok: true, ...detalle, terminado };
  }

  function recargar() {
    const actorId = s.currentActorId;
    const actor = s.configDe(actorId);
    let activation = s.activations.get(actorId);
    const qsActor = toQsActor(actor);
    const validacion = validateIntent(qsActor, { type: "RELOAD" }, activation);
    if (!validacion.valid) { log(`RELOAD rechazado: ${validacion.reasons.join(", ")}.`); return { ok: false, reasons: validacion.reasons }; }

    ({ activation } = applyResourceCost(activation, { type: "RELOAD" }));
    s.activations.set(actorId, activation);

    const arma = armaActivaDe(actor);
    const municion = municionArmaActivaDe(actor);
    const progreso = avanzarProgreso(actor.recargaProgreso, costeAccionesPorTamano(arma.tamano));
    let resultado;
    if (progreso.completo) {
      const magSize = arma.tamano === "grande" ? 2 : arma.tamano === "mediana" ? 6 : 8;
      const hueco = Math.max(0, magSize - municion.cargador);
      const transferido = Math.min(hueco, municion.reserva);
      municion.cargador += transferido;
      municion.reserva -= transferido;
      actor.recargaProgreso = null;
      resultado = { completo: true };
      log(`${actorId}: recarga completa (${progreso.progress}/${progreso.required} acciones) -- cargador=${municion.cargador}, reserva=${municion.reserva}.`);
    } else {
      actor.recargaProgreso = progreso;
      resultado = { completo: false, progreso };
      log(`${actorId}: recarga en progreso (${progreso.progress}/${progreso.required} acciones) -- continúa en una próxima actuación.`);
    }
    onEstadoCambiado();
    return { ok: true, ...resultado };
  }

  function cambiarArmaActiva() {
    const actorId = s.currentActorId;
    const actor = s.configDe(actorId);
    let activation = s.activations.get(actorId);
    if (!cambiarArma(activation.minorActionAvailable)) { log(`CHANGE_WEAPON rechazado: sin acción menor disponible.`); return { ok: false, reasons: ["MINOR_ACTION_SPENT"] }; }
    if (!actor.armaSecundaria) { log(`${actorId}: no tiene arma secundaria.`); return { ok: false, reasons: ["NO_SECONDARY_WEAPON"] }; }

    ({ activation } = applyResourceCost(activation, { type: "CHANGE_WEAPON" }));
    s.activations.set(actorId, activation);
    actor.armaActiva = actor.armaActiva === "primaria" ? "secundaria" : "primaria";
    log(`${actorId}: cambia a ${armaActivaDe(actor).nombre}.`);
    onEstadoCambiado();
    return { ok: true, armaActiva: actor.armaActiva };
  }

  // Guard de habilidadEsquivar ausente (Phase 3.5/5) -- ver
  // docs/TACTICAL_PRODUCTION_PHASE5_AUDIT.md. Idéntico al que ya existía
  // inline en TacticalScene.
  function evadir() {
    const actorId = s.currentActorId;
    const actor = s.configDe(actorId);
    if (typeof actor.habilidadEsquivar !== "number") { log(`${actorId}: no dispone de esquiva.`); return { ok: false, reasons: ["NO_DODGE_CAPABILITY"] }; }
    let activation = s.activations.get(actorId);
    const validacion = validateIntent(toQsActor(actor), { type: "EVASIVE_MOVEMENT" }, activation);
    if (!validacion.valid) { log(`EVASIVE_MOVEMENT rechazado: ${validacion.reasons.join(", ")}.`); return { ok: false, reasons: validacion.reasons }; }

    const resultado = resolverMovimientoEvasivo({ habilidadEsquivar: actor.habilidadEsquivar, dificultad: penalizadorPorNivel(nivelHeridaDe(actor)), rng });
    actor.efectoEvasivo = { penalizadorAtacantes: resultado.penalizadorAtacantes };
    ({ activation } = applyResourceCost(activation, { type: "EVASIVE_MOVEMENT" }));
    s.activations.set(actorId, activation);
    log(`${actorId}: movimiento evasivo (tirada=${resultado.tiradaTexto}) -- penalizador a atacantes a distancia: ${resultado.penalizadorAtacantes}.`);
    onEstadoCambiado();
    return { ok: true, ...resultado };
  }

  function defender() {
    const actorId = s.currentActorId;
    const actor = s.configDe(actorId);
    if (typeof actor.habilidadEsquivar !== "number") { log(`${actorId}: no dispone de esquiva.`); return { ok: false, reasons: ["NO_DODGE_CAPABILITY"] }; }
    let activation = s.activations.get(actorId);
    const validacion = validateIntent(toQsActor(actor), { type: "DODGE_TOTAL", cc: true }, activation);
    if (!validacion.valid) { log(`DODGE_TOTAL rechazado: ${validacion.reasons.join(", ")}.`); return { ok: false, reasons: validacion.reasons }; }

    const resultado = resolverEsquivaTotal({ habilidadEsquivar: actor.habilidadEsquivar, dificultad: penalizadorPorNivel(nivelHeridaDe(actor)), rng });
    actor.esquivaTotalActiva = resultado.cancelaDanioCC;
    ({ activation } = applyResourceCost(activation, { type: "DODGE_TOTAL", cc: true }));
    s.activations.set(actorId, activation);
    log(`${actorId}: esquiva total (tirada=${resultado.tiradaTexto}) -- ${resultado.cancelaDanioCC ? "cancelará el próximo golpe CC recibido" : "no logró activarse"}.`);
    onEstadoCambiado();
    return { ok: true, ...resultado };
  }

  function terminarActuacion() {
    const actorId = s.currentActorId;
    let activation = s.activations.get(actorId);
    ({ activation } = applyResourceCost(activation, { type: "END_ACTIVATION" }));
    s.activations.set(actorId, activation);
    log(`${actorId}: termina la actuación.`);
    return { ok: true };
  }

  return { moverA, atacar, recargar, cambiarArma: cambiarArmaActiva, evadir, defender, terminarActuacion };
}

export { createActivation };
