// Objetivos declarativos de un encuentro (encargo TACTICAL_ENGINE_MODULE_CONTRACT,
// punto 26): el motor NO decide "todos los enemigos muertos = victoria"
// dentro del renderer -- eso vive en `encounterDefinition.objectives`,
// evaluado aquí. Solo se implementan los dos tipos que Predator necesita
// hoy (punto 26: "solo implementar realmente lo que Predator necesita
// ahora") -- el switch está preparado para crecer (surviveRounds,
// reachArea, protectActor, escape) sin tocar el caller.

const EVALUADORES = {
  eliminateEnemies: (session) => session.vivos(session.enemies).length === 0,
  allPartyDown: (session) => session.vivos(session.party).length === 0
};

/**
 * Evalúa los objetivos de `session` contra los declarados en
 * `objectivesDef` ({victory, defeat}). Devuelve "victoria"|"derrota"|null
 * -- null si el encuentro sigue en curso. Se comprueba derrota
 * ANTES que victoria solo por orden de lectura, no importa: ambos
 * objetivos son excluyentes en la práctica (no puede haber 0 enemigos Y 0
 * party vivos a la vez, salvo un empate degenerado que se resuelve como
 * derrota -- ver test correspondiente).
 */
export function evaluarObjetivos(session, objectivesDef) {
  const evaluarDefeat = EVALUADORES[objectivesDef.defeat.type];
  const evaluarVictory = EVALUADORES[objectivesDef.victory.type];
  if (!evaluarDefeat || !evaluarVictory) {
    throw new Error(`TACTICAL_OBJECTIVE_UNSUPPORTED: tipo de objetivo no soportado (victory="${objectivesDef.victory.type}", defeat="${objectivesDef.defeat.type}")`);
  }
  if (evaluarDefeat(session)) return "derrota";
  if (evaluarVictory(session)) return "victoria";
  return null;
}

export const TIPOS_OBJETIVO_SOPORTADOS = Object.keys(EVALUADORES);
