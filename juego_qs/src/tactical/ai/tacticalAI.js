// IA táctica simple del Vertical Slice (encargo PHASER_TACTICAL_RENDERER_VERTICAL_SLICE,
// punto "IA"). Orquestación sandbox-local -- NO son reglas QS, son
// decisiones de qué intent declarar en cada actuación, mismo espíritu que
// las POLITICAS de tools/predatorBalanceSimPost5c.mjs (JUEGO_QS): simple,
// documentado, sin optimización matemática ni pathfinding.
//
// Puro y testable sin Phaser: recibe datos ya resueltos (activation,
// movementRemaining, nivel de herida, candidatos vivos, adapter espacial)
// y devuelve UNA decisión -- el caller (la escena) la ejecuta llamando al
// bridge real.

function vidaTotal(actor) {
  return actor.vidaActual.sano + actor.vidaActual.herido + actor.vidaActual.tullido;
}

function municionArmaActiva(actor) {
  return actor.municion[actor.armaActiva] ?? actor.municion.primaria;
}

function municionOtraArma(actor) {
  const otra = actor.armaActiva === "primaria" ? "secundaria" : "primaria";
  return actor.municion[otra];
}

/**
 * Candidato de objetivo a distancia: el más débil (menos vida total) entre
 * los que el atacante puede realmente disparar (canAttack=true, punto 23:
 * el Spatial Adapter clasifica, la IA solo filtra sobre lo que ya clasificó).
 */
export function elegirObjetivoDisparo(atacanteId, candidatosVivos, spatialAdapter) {
  const opciones = candidatosVivos
    .map(t => ({ target: t, cover: spatialAdapter.getCover(atacanteId, t.id) }))
    .filter(o => o.cover.canAttack);
  if (opciones.length === 0) return null;
  opciones.sort((a, b) => vidaTotal(a.target) - vidaTotal(b.target));
  return { target: opciones[0].target, cover: opciones[0].cover };
}

/** Candidato CC: el más cercano dentro de `alcanceCC` metros. */
export function elegirObjetivoCC(actorId, candidatosVivos, spatialAdapter, alcanceCC = 1.6) {
  const opciones = candidatosVivos
    .map(t => ({ target: t, distancia: spatialAdapter.getDistance(actorId, t.id) }))
    .filter(o => o.distancia <= alcanceCC);
  if (opciones.length === 0) return null;
  opciones.sort((a, b) => a.distancia - b.distancia);
  return opciones[0].target;
}

/**
 * Decide UNA acción para la actuación en curso de `actor`. Se llama en
 * bucle (una vez por decisión, igual que ejecutarActuacionParty() en
 * JUEGO_QS/tools/predatorBalanceSimPost5c.mjs) hasta que devuelve "END" o
 * la actuación se agota.
 *
 * Orden conceptual (no optimización matemática, punto "no IA táctica
 * sofisticada" heredado de la fase Spatial Cover Adapter, ahora con
 * cuerpo a cuerpo/recarga/cambio de arma añadidos):
 *   1. Si el actor está gravemente herido ("tullido") y todavía no ha
 *      hecho movimiento evasivo esta actuación -> EVASIVE_MOVEMENT.
 *   2. Si no se ha posicionado nunca en cobertura y hay una alcanzable ->
 *      MOVE_TO_COVER.
 *   3. Si el arma activa se quedó sin munición y la otra arma sí tiene ->
 *      CHANGE_WEAPON.
 *   4. Si hay un objetivo a distancia válido (canAttack) y munición ->
 *      ATTACK (a distancia).
 *   5. Si no hay objetivo a distancia pero sí uno cuerpo a cuerpo al
 *      alcance -> ATTACK cc.
 *   6. Si el arma activa está vacía y la reserva no -> RELOAD.
 *   7. END.
 */
// Perfil por defecto -- EXACTAMENTE el comportamiento de antes de que
// existiera el concepto de perfil (TACTICAL ENGINE — MODULE CONTRACT,
// punto 28: "TacticalAI CORE" separado de "AI PROFILE"). Un perfil es
// solo un puñado de flags que activan/desactivan pasos de la misma
// secuencia -- no un árbol de comportamiento distinto. Ver
// src/tactical/aiProfiles.js para los perfiles nombrados
// (cautious/aggressive/defensive) que el motor ofrece a los módulos.
export const PERFIL_POR_DEFECTO = {
  buscarCobertura: true,
  evadirSiGraveHerida: true,
  priorizarDisparoSobreCC: true
};

export function decidirAccion({ actor, activation, movementRemaining, nivelHerida, candidatosVivos, spatialAdapter, perfil = PERFIL_POR_DEFECTO }) {
  // habilidadEsquivar es un dato OPCIONAL del actor (Production
  // Integration Phase 3.5, docs/TACTICAL_PRODUCTION_PHASE35.md): un
  // actor sin esta capacidad declarada (p.ej. un NPC cuya ficha fuente
  // nunca definió esquiva) no puede intentar EVASIVE_MOVEMENT -- la
  // acción queda simplemente NO DISPONIBLE, nunca se ejecuta con un
  // valor inventado. Esto no es un ajuste de dificultad: es respetar la
  // ausencia real del dato.
  const puedeEsquivar = typeof actor.habilidadEsquivar === "number";
  if (puedeEsquivar && perfil.evadirSiGraveHerida && nivelHerida === "tullido" && activation.mainActionAvailable && !actor.efectoEvasivo) {
    return { type: "EVASIVE_MOVEMENT" };
  }

  if (perfil.buscarCobertura && !actor._posicionado) {
    const opciones = spatialAdapter.getReachableCover(actor.id, movementRemaining);
    const mejor = opciones.find(o => o.reachable);
    if (mejor) return { type: "MOVE_TO_COVER", obstacleId: mejor.obstacleId };
  }

  const municionActiva = municionArmaActiva(actor);
  if (municionActiva.cargador <= 0 && municionOtraArma(actor)?.cargador > 0 && activation.minorActionAvailable !== false) {
    return { type: "CHANGE_WEAPON" };
  }

  const intentarDisparo = () => {
    if (!activation.mainActionAvailable || municionActiva.cargador <= 0) return null;
    const objetivo = elegirObjetivoDisparo(actor.id, candidatosVivos, spatialAdapter);
    return objetivo ? { type: "ATTACK", targetId: objetivo.target.id, cover: objetivo.cover } : null;
  };
  const intentarCC = () => {
    if (!activation.mainActionAvailable) return null;
    const objetivoCC = elegirObjetivoCC(actor.id, candidatosVivos, spatialAdapter);
    return objetivoCC ? { type: "ATTACK_CC", targetId: objetivoCC.id } : null;
  };

  const orden = perfil.priorizarDisparoSobreCC ? [intentarDisparo, intentarCC] : [intentarCC, intentarDisparo];
  for (const intentar of orden) {
    const decision = intentar();
    if (decision) return decision;
  }

  if (activation.mainActionAvailable && municionActiva.cargador <= 0 && municionActiva.reserva > 0) {
    return { type: "RELOAD" };
  }

  return { type: "END" };
}
