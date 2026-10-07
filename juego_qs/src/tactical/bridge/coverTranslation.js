// Traducción de VOCABULARIO entre el SpatialCoverAdapter (etiquetas en
// inglés: "none"/"partial"/"solid"/"total", DIGITAL_SPATIAL_ADAPTATION,
// ver docs/SPATIAL_COVER_ADAPTER.md §5) y las claves canónicas QS
// (src/rules/cover.js, en español: "ninguna"/"parcial"/"solida"/"total").
//
// Esto NO duplica ningún valor de regla -- es solo un mapa de nombres
// (arbitrario, decidido en el sandbox). Los NÚMEROS reales
// (valorCobertura -> 0/1/2/3) siguen viviendo únicamente en
// JUEGO_QS/src/rules/cover.js y se leen de ahí en tiempo real vía
// qsRulesBridge.js -- nunca se copian aquí. Por eso este archivo puede
// ser puro (cero imports) y perfectamente testable con node --test sin
// tocar producción ni el alias de Vite.
export const NIVEL_SPATIAL_A_CLAVE_QS = {
  none: "ninguna",
  partial: "parcial",
  solid: "solida",
  total: "total"
};

export function claveQsDeNivelSpatial(level) {
  return NIVEL_SPATIAL_A_CLAVE_QS[level] ?? "ninguna";
}
