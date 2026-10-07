// Adaptador de datos mínimo (punto 18/19 del encargo SHARED_RULES_BRIDGE,
// ampliado para el Vertical Slice): convierte la forma de combatiente del
// prototipo táctico (src/config/predatorTactical.js, PROTOTYPE_DATA) a la
// forma que el Rules Engine real espera. Evita mantener dos esquemas de
// actor divergentes sin necesidad de tocar ningún dato productivo.

// Arma actualmente empuñada (primaria/secundaria) -- CHANGE_WEAPON solo
// cambia `armaActiva`, nunca duplica el objeto arma.
export function armaActivaDe(actorConfig) {
  return actorConfig.armaActiva === "secundaria" && actorConfig.armaSecundaria
    ? actorConfig.armaSecundaria
    : actorConfig.armaPrimaria;
}

export function municionArmaActivaDe(actorConfig) {
  return actorConfig.municion[actorConfig.armaActiva] ?? actorConfig.municion.primaria;
}

// actor.municion.{cargador,reserva} -- forma runtime esperada por
// validateIntent()/resolveIntent() reales (ver
// JUEGO_QS/src/combat/rulesEngine.js). El cuerpo a cuerpo no consume
// munición (intent.cc=true) así que el valor exacto es irrelevante en ese
// camino, pero se rellena igualmente por consistencia de forma.
export function toQsActor(actorConfig) {
  const municion = municionArmaActivaDe(actorConfig);
  return {
    id: actorConfig.id,
    municion: { cargador: municion.cargador, reserva: municion.reserva }
  };
}

// Construye el `intent` ATTACK que resolveIntent() real espera.
// coberturaObjetivo se deja sin definir a propósito: el bridge
// (qsRulesBridge.js) la rellena leyendo el nivel del Spatial Adapter,
// nunca se calcula aquí (punto 23: no restar cobertura manualmente en
// Phaser). exitosDefensa se inyecta aparte por el caller (defensa activa
// CC del objetivo, si la declaró en su actuación anterior).
export function toQsAttackIntent(attackerConfig, targetConfig, { cc = false, modoFuego = "tiroATiro", cadenciaBonus = 0 } = {}) {
  if (cc) {
    return {
      type: "ATTACK", cc: true,
      habilidadBase: attackerConfig.habilidadCC,
      penetracion: 0,
      blindajeObjetivo: targetConfig.blindaje,
      danioBase: attackerConfig.armaCC.danioBase
    };
  }
  const arma = armaActivaDe(attackerConfig);
  return {
    type: modoFuego === "rafaga" ? "BURST" : "ATTACK",
    habilidadBase: attackerConfig.habilidadDisparo,
    cadenciaBonus,
    penetracion: arma.penetracion ?? 0,
    blindajeObjetivo: targetConfig.blindaje,
    danioBase: arma.danioBase
  };
}
