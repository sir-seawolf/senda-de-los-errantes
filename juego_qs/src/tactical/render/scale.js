// Conversión metros<->píxeles parametrizada por `metersToPx` (encargo
// TACTICAL_ENGINE_MODULE_CONTRACT): antes era una constante fija
// (METROS_A_PX=40 en predatorTactical.js, específica de Predator); ahora
// cada encuentro declara su propia escala en
// `battlefield.metersToPx` (con default 40 si no la declara, ver
// TacticalEncounterDefinition.js/conDefaults) y el motor la usa sin
// conocer de qué módulo viene.
export function crearEscala(metersToPx) {
  return {
    metersToPx,
    px: (metros) => metros * metersToPx,
    metros: (pixeles) => pixeles / metersToPx
  };
}
