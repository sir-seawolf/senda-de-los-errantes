// Contrato puro y portable para la composición visual de escenas.
export const SCENE_LAYERS_SCHEMA_VERSION = 1;
const SEMANTICS = new Set(["background", "architecture", "object", "occupant", "foreground", "lighting", "other"]);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback) => { const number = finite(value, fallback); return number > 0 ? number : fallback; };
const unit = (value, fallback = 0) => Math.max(0, Math.min(1, finite(value, fallback)));
const list = value => Array.isArray(value) ? value.filter(item => typeof item === "string" && item) : [];

function normalizeResource(value) {
  if (typeof value === "string" && value) return { src: value };
  if (!value || typeof value !== "object") return null;
  const src = value.src || value.file || null;
  return src ? { src, alt: typeof value.alt === "string" ? value.alt : "" } : null;
}
function normalizeVisibility(value) {
  if (!value || typeof value !== "object") return { all: [], any: [], none: [] };
  return { all: list(value.all || value.requiresFlags), any: list(value.any || value.anyFlags), none: list(value.none || value.blockedByFlags) };
}
function normalizeLayer(layer, index) {
  const position = layer.position || {}, size = layer.size || {}, anchor = layer.anchor || {};
  const parallax = typeof layer.parallax === "number" ? { x: layer.parallax, y: 1 } : (layer.parallax || {});
  const pointer = layer.pointer || layer.pointerResponse || {};
  const oscillation = layer.oscillation || layer.ambientMotion || {};
  const frame = layer.frame || {}, clip = frame.clip || {}, focus = frame.focus || {};
  return {
    id: typeof layer.id === "string" && layer.id ? layer.id : `layer-${index + 1}`,
    resource: normalizeResource(layer.resource || layer.file),
    depth: finite(layer.depth ?? layer.order, index),
    semantic: SEMANTICS.has(layer.semantic) ? layer.semantic : "other",
    position: { x: finite(position.x ?? layer.x), y: finite(position.y ?? layer.y) },
    size: { width: positive(size.width ?? layer.width, null), height: positive(size.height ?? layer.height, null) },
    anchor: { x: finite(anchor.x), y: finite(anchor.y) },
    fit: ["fill", "contain", "cover", "none"].includes(layer.fit) ? layer.fit : "fill",
    frame: {
      clip: { top: unit(clip.top), right: unit(clip.right), bottom: unit(clip.bottom), left: unit(clip.left) },
      focus: { x: unit(focus.x, 0.5), y: unit(focus.y, 0.5) }
    },
    parallax: { x: finite(parallax.x, 1), y: finite(parallax.y, 1) },
    pointer: { x: finite(pointer.x), y: finite(pointer.y) },
    oscillation: { x: finite(oscillation.x), y: finite(oscillation.y), periodMs: Math.max(1000, positive(oscillation.periodMs, 8000)), phase: finite(oscillation.phase) },
    visibility: normalizeVisibility(layer.visibility || layer.visibleWhen),
    occlusionProfile: typeof layer.occlusionProfile === "string" ? layer.occlusionProfile : null,
    fallback: normalizeResource(layer.fallback),
    optional: layer.optional === true,
    interactive: layer.interactive === true
  };
}
function legacyLayers(scene) {
  const layers = [];
  if (scene.master?.file) layers.push({ id: "legacy-master", resource: scene.master.file, depth: 0, semantic: "background", width: scene.master.width, height: scene.master.height });
  else if (scene.background) layers.push({ id: "legacy-background", resource: scene.background, depth: 0, semantic: "background", fit: "cover" });
  (scene.foregroundLayers || []).forEach((layer, index) => layers.push({
    ...layer, id: layer.id || `legacy-foreground-${index + 1}`, resource: layer.file,
    depth: layer.depth ?? 100 + index, semantic: layer.semantic || "foreground",
    parallax: { x: 1 + finite(layer.parallaxFactor), y: 1 }
  }));
  return layers;
}
export function normalizeSceneLayers(scene = {}) {
  const declared = scene.presentation?.layers;
  const source = Array.isArray(declared) ? declared : legacyLayers(scene);
  return {
    schemaVersion: SCENE_LAYERS_SCHEMA_VERSION,
    sourceVersion: finite(scene.presentation?.schemaVersion, SCENE_LAYERS_SCHEMA_VERSION),
    width: positive(scene.presentation?.width ?? scene.master?.width, null),
    height: positive(scene.presentation?.height ?? scene.master?.height, null),
    layers: source.map(normalizeLayer).sort((a, b) => a.depth - b.depth),
    legacy: !Array.isArray(declared)
  };
}
export function isLayerVisible(layer, flags = {}) {
  const visibility = layer.visibility || { all: [], any: [], none: [] };
  const enabled = key => Boolean(flags?.[key]);
  return visibility.all.every(enabled) && (!visibility.any.length || visibility.any.some(enabled)) && !visibility.none.some(enabled);
}
// Desplazamiento relativo a la composición base; el adaptador conserva la cámara navegable.
export function calculateLayerMotion(layer, context = {}) {
  if (context.reducedMotion) return { x: 0, y: 0 };
  const cameraX = finite(context.cameraX), cameraY = finite(context.cameraY);
  const pointerX = Math.max(-1, Math.min(1, finite(context.pointerX))), pointerY = Math.max(-1, Math.min(1, finite(context.pointerY)));
  const wave = Math.sin((finite(context.timeMs) / layer.oscillation.periodMs) * Math.PI * 2 + layer.oscillation.phase);
  return {
    x: (1 - layer.parallax.x) * cameraX + layer.pointer.x * pointerX + layer.oscillation.x * wave,
    y: (1 - layer.parallax.y) * cameraY + layer.pointer.y * pointerY + layer.oscillation.y * wave
  };
}
export function validateSceneLayers(scene = {}) {
  const errors = [], presentation = scene.presentation;
  if (!presentation) return errors;
  if (presentation.schemaVersion !== undefined && presentation.schemaVersion !== SCENE_LAYERS_SCHEMA_VERSION) errors.push(`presentation.schemaVersion no soportada: ${presentation.schemaVersion}`);
  if (!Array.isArray(presentation.layers)) errors.push("presentation.layers debe ser un array");
  const ids = new Set();
  (presentation.layers || []).forEach((layer, index) => {
    const path = `presentation.layers[${index}]`;
    if (!layer || typeof layer !== "object") { errors.push(`${path} debe ser un objeto`); return; }
    if (typeof layer.id !== "string" || !layer.id) errors.push(`${path}.id es obligatorio`);
    else if (ids.has(layer.id)) errors.push(`${path}.id duplicado: ${layer.id}`); else ids.add(layer.id);
    if (!layer.resource && !layer.fallback && !layer.optional) errors.push(`${path} necesita resource, fallback u optional:true`);
    if (layer.semantic && !SEMANTICS.has(layer.semantic)) errors.push(`${path}.semantic no reconocida: ${layer.semantic}`);
  });
  return errors;
}
