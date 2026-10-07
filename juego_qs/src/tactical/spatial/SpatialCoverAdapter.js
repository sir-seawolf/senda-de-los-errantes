// Spatial Cover Adapter -- renderer-agnostic (punto 6/7 del encargo
// SPATIAL_COVER_ADAPTER, docs/SPATIAL_COVER_ADAPTER.md).
//
// Responsabilidad de este modulo: SOLO espacio. Resuelve posiciones,
// distancias, obstaculos, relacion espacial y si una linea de tiro esta
// bloqueada. NO tira dados, NO aplica Penetracion/Blindaje/dano, NO decide
// legalidad de reglas QS mas alla de "hay o no hay linea de tiro" -- eso
// es responsabilidad del Rules Engine REAL de JUEGO_QS, consumido a
// traves de src/bridge/qsRulesBridge.js (docs/SHARED_RULES_BRIDGE.md),
// que usa el resultado de este adaptador pero no lo produce.
//
// Todas las coordenadas son METROS de mundo abstracto (no pixels de
// Phaser) -- ver docs/SPATIAL_COVER_ADAPTER.md, seccion "Escala", para la
// conversion metros<->pixels que usa la escena.

const NIVELES = ["none", "partial", "solid", "total"];

function rangoNivel(nivel) {
  return NIVELES.indexOf(nivel);
}

// Cobertura "rebajada" un escalon -- una silueta con angulo de exposicion
// amplio (pero no total) nunca da mas proteccion de la que el objeto
// permite en su mejor angulo. total->solid->partial->none.
function degradarNivel(nivel) {
  const idx = rangoNivel(nivel);
  return idx <= 0 ? "none" : NIVELES[idx - 1];
}

function distancia(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalizar(v) {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function anguloEntreGrados(u, v) {
  const dot = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y));
  return (Math.acos(dot) * 180) / Math.PI;
}

// Interseccion segmento-AABB (algoritmo slab -- estandar, sin dependencias).
// Devuelve true si el segmento (x1,y1)-(x2,y2) cruza el rectangulo rect
// {x,y,width,height} (x,y = esquina superior-izquierda, en metros).
function segmentoCruzaRectangulo(x1, y1, x2, y2, rect) {
  const minX = rect.x, minY = rect.y;
  const maxX = rect.x + rect.width, maxY = rect.y + rect.height;
  let tMin = 0, tMax = 1;
  const dx = x2 - x1, dy = y2 - y1;

  for (const [p, q] of [
    [-dx, x1 - minX], [dx, maxX - x1],
    [-dy, y1 - minY], [dy, maxY - y1]
  ]) {
    if (p === 0) {
      if (q < 0) return false; // paralelo y fuera de esa franja
      continue;
    }
    const t = q / p;
    if (p < 0) { if (t > tMax) return false; if (t > tMin) tMin = t; }
    else { if (t < tMin) return false; if (t < tMax) tMax = t; }
  }
  return tMin <= tMax;
}

function puntoMasCercanoEnRectangulo(p, rect) {
  const cx = Math.max(rect.x, Math.min(p.x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(p.y, rect.y + rect.height));
  return { x: cx, y: cy };
}

function centroRectangulo(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Crea un Spatial Cover Adapter para un conjunto de actores y obstaculos.
 *
 * @param {object} config
 * @param {Array<{id:string,x:number,y:number}>} config.actors
 * @param {Array<{id:string,type:"partial"|"solid"|"total",x:number,y:number,width:number,height:number}>} config.obstacles
 *   AABB en metros. type="total" se trata como oclusion pura (muro/esquina
 *   -- bloquea linea de tiro para cualquiera que la cruce, simetrico).
 *   type="solid"/"partial" se trata como cobertura direccional de baja
 *   altura (coche/barrera -- el objetivo debe estar "usandola", protege
 *   distinto segun el angulo de aproximacion del atacante).
 * @param {number} [config.coverRadius=2.2] distancia (m) dentro de la cual
 *   se considera que un objetivo esta "usando" un obstaculo solid/partial
 *   como cobertura.
 * @param {number} [config.tightAngleDeg=45] angulo (grados) hasta el cual
 *   el atacante recibe el nivel completo del obstaculo.
 * @param {number} [config.wideAngleDeg=120] angulo a partir del cual el
 *   atacante ya no recibe ninguna cobertura de ese obstaculo (flanqueo
 *   espacial -- distinto del isFlanking() canonico del Rules Engine,
 *   punto 29 del encargo: no se fusionan).
 */
export function createSpatialCoverAdapter({ actors, obstacles, coverRadius = 2.2, tightAngleDeg = 45, wideAngleDeg = 120 }) {
  const posiciones = new Map(actors.map(a => [a.id, { x: a.x, y: a.y }]));

  function moverActor(id, x, y) {
    posiciones.set(id, { x, y });
  }

  function posicionDe(id) {
    const p = posiciones.get(id);
    if (!p) throw new Error(`SpatialCoverAdapter: actor desconocido "${id}"`);
    return p;
  }

  function getDistance(attackerId, targetId) {
    return distancia(posicionDe(attackerId), posicionDe(targetId));
  }

  // Nivel de cobertura que aporta UN obstaculo concreto a la relacion
  // attacker->target. No agrega varios obstaculos -- eso lo hace getCover().
  function nivelPorObstaculo(obstacle, attackerPos, targetPos) {
    if (obstacle.type === "total") {
      const bloqueado = segmentoCruzaRectangulo(attackerPos.x, attackerPos.y, targetPos.x, targetPos.y, obstacle);
      return bloqueado ? "total" : "none";
    }

    // solid/partial: el objetivo debe estar realmente junto al obstaculo
    // para beneficiarse de el (no es un campo de fuerza a distancia).
    const puntoMasCercano = puntoMasCercanoEnRectangulo(targetPos, obstacle);
    if (distancia(targetPos, puntoMasCercano) > coverRadius) return "none";

    const centro = centroRectangulo(obstacle);
    const dirRefugio = normalizar({ x: targetPos.x - centro.x, y: targetPos.y - centro.y });
    if (dirRefugio.x === 0 && dirRefugio.y === 0) return obstacle.type; // objetivo exactamente en el centro -- caso degenerado, máxima protección
    const dirAproximacion = normalizar({ x: targetPos.x - attackerPos.x, y: targetPos.y - attackerPos.y });
    const angulo = anguloEntreGrados(dirAproximacion, dirRefugio);

    if (angulo <= tightAngleDeg) return obstacle.type;
    if (angulo <= wideAngleDeg) return degradarNivel(obstacle.type);
    return "none";
  }

  /**
   * Cobertura de `targetId` frente a `attackerId`, evaluada
   * RELACIONALMENTE (direccion atacante->objetivo + geometria real) --
   * nunca una propiedad absoluta del actor (punto 3 del encargo).
   * @returns {{level: "none"|"partial"|"solid"|"total", canAttack: boolean, source: string|null}}
   */
  function getCover(attackerId, targetId) {
    const attackerPos = posicionDe(attackerId);
    const targetPos = posicionDe(targetId);

    let mejorNivel = "none";
    let mejorFuente = null;
    for (const obstacle of obstacles) {
      const nivel = nivelPorObstaculo(obstacle, attackerPos, targetPos);
      if (rangoNivel(nivel) > rangoNivel(mejorNivel)) {
        mejorNivel = nivel;
        mejorFuente = obstacle.id;
      }
    }

    return { level: mejorNivel, canAttack: mejorNivel !== "total", source: mejorFuente };
  }

  function canAttack(attackerId, targetId) {
    return getCover(attackerId, targetId).canAttack;
  }

  /**
   * Obstaculos solid/partial alcanzables por `actorId` dado el movimiento
   * restante de su actuacion -- para que la politica/UI decida si moverse
   * a cubrirse es una opcion real en este turno (equivalente espacial de
   * moverHaciaCobertura() del Rules Engine QS, docs/PREDATOR_COVER_MOVEMENT_MODEL.md).
   * No incluye obstaculos "total" -- esos no se "usan" como cobertura,
   * bloquean linea de tiro por si mismos independientemente de si alguien
   * los usa como refugio.
   */
  function getReachableCover(actorId, movementRemaining) {
    const pos = posicionDe(actorId);
    return obstacles
      .filter(o => o.type !== "total")
      .map(o => {
        const puntoMasCercano = puntoMasCercanoEnRectangulo(pos, o);
        const distanciaAlBorde = distancia(pos, puntoMasCercano);
        const distanciaParaCubrirse = Math.max(0, distanciaAlBorde - coverRadius * 0.6); // aproximarse lo suficiente para quedar dentro de coverRadius
        return { obstacleId: o.id, type: o.type, distance: +distanciaParaCubrirse.toFixed(2), reachable: distanciaParaCubrirse <= movementRemaining };
      })
      .sort((a, b) => a.distance - b.distance);
  }

  // Punto de destino (metros) para que `actorId` se acerque a `obstacleId`
  // lo suficiente como para quedar dentro de coverRadius -- usado por la
  // IA/UI de movimiento del Vertical Slice (encargo PHASER_TACTICAL_RENDERER_VERTICAL_SLICE)
  // para saber HACIA DÓNDE mover, no solo si es alcanzable
  // (getReachableCover ya daba la distancia; esto da las coordenadas).
  // Mismo cálculo interno que getReachableCover(), sin recortar por
  // movimiento restante -- eso lo hace el caller al aplicar el intent MOVE.
  function puntoDeAcercamiento(actorId, obstacleId) {
    const obstacle = obstacles.find(o => o.id === obstacleId);
    if (!obstacle) throw new Error(`SpatialCoverAdapter: obstáculo desconocido "${obstacleId}"`);
    const pos = posicionDe(actorId);
    const puntoMasCercano = puntoMasCercanoEnRectangulo(pos, obstacle);
    const dir = normalizar({ x: pos.x - puntoMasCercano.x, y: pos.y - puntoMasCercano.y });
    const margen = coverRadius * 0.6;
    if (dir.x === 0 && dir.y === 0) return { x: puntoMasCercano.x, y: puntoMasCercano.y + margen };
    return { x: puntoMasCercano.x + dir.x * margen, y: puntoMasCercano.y + dir.y * margen };
  }

  // Exporta TODAS las posiciones actuales -- usado por TacticalSession
  // (encargo TACTICAL_ENGINE_MODULE_CONTRACT, punto 21/23) para capturar
  // el estado espacial al serializar. El adapter en sí NUNCA se
  // serializa (es un objeto con funciones/closures) -- se reconstruye
  // desde estas posiciones + la definición de obstáculos al deserializar.
  function exportarPosiciones() {
    return Object.fromEntries(posiciones);
  }

  return { getDistance, getCover, canAttack, getReachableCover, puntoDeAcercamiento, moverActor, posicionDe, exportarPosiciones };
}

// Alias hacia el nombre objetivo del encargo TACTICAL_ENGINE_MODULE_CONTRACT
// (punto 17: "SpatialCoverAdapter debe evolucionar, si hace falta, hacia
// SpatialCombatAdapter") -- MISMA implementación, sin duplicar lógica ni
// complejizarla. Se mantiene también el nombre original para no romper
// los tests/imports existentes de la fase Spatial Cover Adapter.
export const createSpatialCombatAdapter = createSpatialCoverAdapter;
