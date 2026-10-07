// TacticalResult (Production Integration Phase 3.5,
// docs/TACTICAL_PRODUCTION_PHASE35.md): traduce el resultado interno de
// una TacticalSession ("victoria"/"derrota"/"huida"/null, en español,
// vocabulario ya usado por objectives.js) al contrato de salida en
// inglés que un caller (renderer o módulo) consume -- misma separación
// de responsabilidades del resto del motor (core = mecánica, en
// español; contrato externo = interfaz, en inglés, mismo criterio que
// el gateway de renderer de Phase 1).
//
// PRINCIPIO (punto 7 del encargo P3.5): el Tactical Engine DETECTA el
// outcome. El MÓDULO decide la consecuencia narrativa. Este archivo
// nunca importa nada de un módulo concreto, nunca resuelve una
// transición por su cuenta -- solo traduce y, cuando la definición
// delega expresamente ({resolver:"module"}), deja transition=null y
// dice en `context.resolver` que la resolución le toca al caller.
//
// 100% JSON-safe: ningún campo es una función. `{resolver:"module"}` es
// un STRING declarativo, nunca una función serializada (punto 10 del
// encargo).

const OUTCOME_INTERNO_A_EXTERNO = { victoria: "victory", derrota: "defeat", huida: "flee" };

/**
 * Construye el TacticalResult final de una sesión terminada (o en
 * curso -- outcome será null si `session.resultado` todavía no está
 * fijado, útil para inspección intermedia sin esperar al final).
 *
 * @param {object} session - TacticalSession (real o deserializada)
 * @param {object} [transitionsDef] - definition.transitions ya con
 *   defaults aplicados (conDefaults()) -- {victory, defeat, flee}, cada
 *   uno string|null|{resolver:string}
 * @returns {{encounterId:string, outcome:string|null, transition:string|null, context:object, rounds:number, survivingActors:string[], defeatedActors:string[], actorResources:Array}}
 */
export function construirTacticalResult(session, transitionsDef = {}) {
  const outcome = OUTCOME_INTERNO_A_EXTERNO[session.resultado] ?? null;
  const entry = outcome ? transitionsDef[outcome] : undefined;

  let transition = null;
  const context = {};
  if (typeof entry === "string") {
    transition = entry;
  } else if (entry && typeof entry === "object" && typeof entry.resolver === "string") {
    context.resolver = entry.resolver;
  }

  const todosLosActores = [...session.party, ...session.enemies];
  const survivingActors = todosLosActores.filter(a => a.estadoDisponibilidad === "disponible").map(a => a.id);
  const defeatedActors = todosLosActores.filter(a => a.estadoDisponibilidad !== "disponible").map(a => a.id);
  const actorResources = session.party.map(actor => ({
    actorId: actor.id,
    primaryInstanceId: actor.equipoInstancias?.primaria ?? null,
    municionPrimaria: actor.equipoInstancias?.primaria ? { ...actor.municion.primaria } : null
  }));

  return {
    encounterId: session.encounterId,
    outcome,
    transition,
    context,
    rounds: session.round,
    survivingActors,
    defeatedActors,
    actorResources
  };
}
