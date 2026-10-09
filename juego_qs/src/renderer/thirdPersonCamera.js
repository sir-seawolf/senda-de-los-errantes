const OPCIONES_CAMARA = Object.freeze({
  distance: 1.05,
  minDistance: 0.55,
  step: 0.04,
  clearance: 0.12
});

/** Coloca la cámara detrás del actor sin permitir que atraviese paredes. */
export function resolverCamaraTrasera(jugador, esBloqueado, opciones = {}) {
  const config = { ...OPCIONES_CAMARA, ...opciones };
  const dirX = Math.cos(jugador.angulo);
  const dirY = Math.sin(jugador.angulo);
  let distanciaSegura = 0;

  for (let distancia = config.step; distancia <= config.distance + 0.0001; distancia += config.step) {
    const x = jugador.x - dirX * distancia;
    const y = jugador.y - dirY * distancia;
    const lateralX = -dirY * config.clearance;
    const lateralY = dirX * config.clearance;
    const bloqueada = esBloqueado(x, y)
      || esBloqueado(x + lateralX, y + lateralY)
      || esBloqueado(x - lateralX, y - lateralY);
    if (bloqueada) break;
    distanciaSegura = distancia;
  }

  if (distanciaSegura < config.minDistance) {
    return { x: jugador.x, y: jugador.y, angulo: jugador.angulo, distance: 0, mode: "firstPerson" };
  }

  return {
    x: jugador.x - dirX * distanciaSegura,
    y: jugador.y - dirY * distanciaSegura,
    angulo: jugador.angulo,
    distance: distanciaSegura,
    mode: "thirdPerson"
  };
}
