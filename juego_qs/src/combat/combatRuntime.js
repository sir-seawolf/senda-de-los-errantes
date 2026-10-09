// Snapshot JSON-safe del combate narrativo. No contiene DOM, temporizadores,
// callbacks ni datos de un módulo concreto.
const CAMPOS_ESTADO = ["orden", "log", "modo", "velocidad", "round", "activationCounter", "contextoCC", "efectosDefensivos"];
const CAMPOS_ACTOR = ["armaActiva", "recarga", "sorpresaDisponible", "armaEstado"];

export function crearSnapshotCombate(combateState, enemigos, party) {
  const estado = Object.fromEntries(CAMPOS_ESTADO.map(campo => [campo, combateState[campo]]));
  const actores = Object.fromEntries(party.map(actor => [actor.baseId,
    Object.fromEntries(CAMPOS_ACTOR.map(campo => [campo, actor[campo]]))
  ]));
  return JSON.parse(JSON.stringify({ estado, enemigos, actores }));
}

export function restaurarSnapshotCombate(snapshot, combateState, enemigos, party) {
  if (!snapshot?.estado || !Array.isArray(snapshot.enemigos) || !snapshot.actores) return false;
  const idsEsperados = enemigos.map(enemigo => enemigo.id).sort();
  const idsGuardados = snapshot.enemigos.map(enemigo => enemigo?.id).sort();
  if (JSON.stringify(idsEsperados) !== JSON.stringify(idsGuardados)) return false;
  if (party.some(actor => !snapshot.actores[actor.baseId])) return false;

  CAMPOS_ESTADO.forEach(campo => {
    if (snapshot.estado[campo] !== undefined) combateState[campo] = structuredClone(snapshot.estado[campo]);
  });
  enemigos.splice(0, enemigos.length, ...structuredClone(snapshot.enemigos));
  party.forEach(actor => CAMPOS_ACTOR.forEach(campo => {
    if (snapshot.actores[actor.baseId][campo] !== undefined) actor[campo] = structuredClone(snapshot.actores[actor.baseId][campo]);
  }));
  combateState.activation = null;
  combateState.resolviendo = false;
  return true;
}
