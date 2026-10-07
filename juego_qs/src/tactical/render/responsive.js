// Deteccion de touch y utilidades de responsive compartidas por las escenas.
// Segun el encargo (punto 27-29): usar Scale Manager nativo de Phaser para
// resize/orientacion, no CSS a medida -- esto solo aporta lo que Phaser no
// expone directamente (deteccion de touch real, no solo ancho de viewport).

export function detectaTouch() {
  return Boolean(
    ("ontouchstart" in window) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0)
  );
}

export function esRetrato(scale) {
  return scale.height > scale.width;
}

export function infoViewport(scale) {
  return { width: scale.width, height: scale.height, retrato: esRetrato(scale) };
}
