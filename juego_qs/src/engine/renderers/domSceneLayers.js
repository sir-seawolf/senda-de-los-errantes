import { calculateLayerMotion, isLayerVisible } from "../sceneLayers.js";
function applyResource(element, layer, resolveResource) {
  const primary = layer.resource?.src, fallback = layer.fallback?.src;
  element.addEventListener("error", () => {
    if (fallback && element.dataset.fallbackApplied !== "true") {
      element.dataset.fallbackApplied = "true"; element.src = resolveResource(fallback);
    } else { element.hidden = true; element.dataset.resourceUnavailable = "true"; }
  });
  if (primary) element.src = resolveResource(primary);
  else if (fallback) { element.dataset.fallbackApplied = "true"; element.src = resolveResource(fallback); }
  else element.hidden = true;
}
export function mountDomSceneLayers(container, presentation, options = {}) {
  const resolveResource = options.resolveResource || (resource => resource);
  const mounted = presentation.layers.map(layer => {
    const element = document.createElement("img");
    element.className = `panoramica-capa panoramica-capa--${layer.semantic}`;
    element.dataset.sceneLayer = layer.id; element.dataset.semantic = layer.semantic;
    if (layer.occlusionProfile) element.dataset.occlusionProfile = layer.occlusionProfile;
    element.alt = layer.resource?.alt || layer.fallback?.alt || ""; element.draggable = false;
    element.style.zIndex = String(layer.depth); element.style.left = `${layer.position.x}px`; element.style.top = `${layer.position.y}px`;
    if (layer.size.width) element.style.width = `${layer.size.width}px`;
    if (layer.size.height) element.style.height = `${layer.size.height}px`;
    element.style.objectFit = layer.fit;
    element.style.objectPosition = `${layer.frame.focus.x * 100}% ${layer.frame.focus.y * 100}%`;
    const clip = layer.frame.clip;
    if (clip.top || clip.right || clip.bottom || clip.left) {
      element.style.clipPath = `inset(${clip.top * 100}% ${clip.right * 100}% ${clip.bottom * 100}% ${clip.left * 100}%)`;
    }
    element.style.transformOrigin = `${layer.anchor.x * 100}% ${layer.anchor.y * 100}%`;
    element.style.pointerEvents = layer.interactive ? "auto" : "none";
    applyResource(element, layer, resolveResource); container.appendChild(element);
    return { element, layer };
  });
  function update(context = {}) {
    mounted.forEach(({ element, layer }) => {
      const available = element.dataset.resourceUnavailable !== "true";
      element.hidden = !available || !isLayerVisible(layer, context.flags);
      const movement = calculateLayerMotion(layer, context);
      element.style.transform = `translate3d(${movement.x}px, ${movement.y}px, 0)`;
    });
  }
  return { elements: mounted, update };
}
