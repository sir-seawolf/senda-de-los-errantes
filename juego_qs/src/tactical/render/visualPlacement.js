const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const finite = value => Number.isFinite(Number(value));
const positive = value => finite(value) && Number(value) > 0;

/**
 * Resuelve el anclaje de una pieza visual sin conocer ningún módulo.
 * - screen: proporciones estables del lienzo (paredes, puertas, decorado).
 * - obstacleId: centro del obstáculo mecánico correspondiente.
 * - grid: coordenadas lógicas del encuentro.
 */
export function resolverAnclajeVisual(entry, { world, project, obstacles = [] }) {
  if (entry.positionMode === "screen") {
    if (!finite(entry.x) || !finite(entry.y)) return null;
    return { x: world.width * clamp01(entry.x), y: world.height * clamp01(entry.y) };
  }
  if (entry.obstacleId) {
    const obstacle = obstacles.find(candidate => candidate.id === entry.obstacleId);
    if (obstacle) return project(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);
    return null;
  }
  if (!finite(entry.x) || !finite(entry.y)) return null;
  return project(Number(entry.x), Number(entry.y));
}

/** Conserva siempre la proporción natural; solo una dimensión gobierna. */
export function resolverTamanoVisual(entry, { naturalWidth, naturalHeight, world, metersToPx }) {
  const safeWidth = Math.max(1, Number(naturalWidth) || 1);
  const safeHeight = Math.max(1, Number(naturalHeight) || 1);
  const ratio = safeHeight / safeWidth;
  const width = positive(entry.widthRatio)
    ? world.width * clamp01(entry.widthRatio)
    : positive(entry.widthMeters)
      ? Number(entry.widthMeters) * metersToPx * 2
      : positive(entry.widthPx)
        ? Number(entry.widthPx)
        : safeWidth;
  return { width, height: width * ratio };
}

export function profundidadVisual(entry, anchorY) {
  if (Number.isFinite(entry.depth)) return entry.depth;
  return 40 + Math.round(anchorY) + (Number(entry.depthOffset) || 0);
}
