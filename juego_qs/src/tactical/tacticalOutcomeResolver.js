// Frontera TacticalResult -> consecuencia narrativa (Production
// Integration Phase 5, ver docs/TACTICAL_PRODUCTION_PHASE5.md).
//
// Vive en la capa de INTEGRACIÓN (junto a tacticalPhaserRenderer.js /
// tacticalDefinitionResolver.js), NUNCA dentro de
// src/tactical/{contracts,core,ai,spatial,bridge}/ -- el core sigue sin
// saber qué es "aplicarConsecuencias" ni qué módulos existen.
//
// PRINCIPIO (encargo §2/§36/§37): Tactical Engine detecta el outcome.
// El módulo decide la consecuencia. Este resolver es la ÚNICA puerta de
// entrada genérica entre ambos -- reutiliza aplicarConsecuencias() real
// (src/engine/sceneEngine.js), nunca reimplementa transición/flags.
//
// Dos casos, ambos ya declarados en el TacticalResult (P3.5):
//   - result.transition es un string -> transición directa (victory/flee
//     de Predator: "rastrear_tarjeta"/"persecucion", ids de escena reales).
//   - result.context.resolver === "module" -> delega en
//     modules/<moduleId>/encounters/tactical/outcomeResolver.js (mismo
//     patrón de convención que tacticalDefinitionResolver.js: moduleId
//     resuelve una ruta, nunca un import directo de un módulo concreto
//     aquí).
import { aplicarConsecuencias } from "../engine/sceneEngine.js";

export class TacticalOutcomeResolverError extends Error {
  constructor(moduleId, reason) {
    super(`TACTICAL_OUTCOME_RESOLVER_ERROR: moduleId="${moduleId}" reason="${reason}"`);
    this.name = "TacticalOutcomeResolverError";
    this.moduleId = moduleId;
    this.reason = reason;
  }
}

/**
 * Resuelve la consecuencia narrativa de un TacticalResult ya terminado
 * (outcome !== null). No hace nada si el combate sigue en curso
 * (outcome === null) o si no hay transición ni resolver declarados.
 *
 * @param {string} moduleId
 * @param {object} result - TacticalResult (P3.5, src/tactical/core/result.js)
 * @param {{actorId?:string, onTexto?:Function, importarResolverModulo?:Function}} [opts]
 *   `importarResolverModulo` es inyectable SOLO para tests.
 * @returns {Promise<{resuelto:boolean, via:string}>}
 */
export async function resolverOutcomeTactico(moduleId, result, opts = {}) {
  const { actorId, onTexto, importarResolverModulo = (id) => import(`../../modules/${id}/encounters/tactical/outcomeResolver.js`) } = opts;

  if (typeof result.transition === "string") {
    // Transición directa (victory/flee) -- misma ruta real que ya usa
    // combat.js para onVictory/onFlee (aplicarConsecuencias), sin
    // reimplementar cambiarEscena()/setTimeout aquí.
    aplicarConsecuencias({ transition: result.transition }, actorId, { onTexto });
    return { resuelto: true, via: "transition-directa" };
  }

  if (result.context?.resolver === "module") {
    let modulo;
    try {
      modulo = await importarResolverModulo(moduleId);
    } catch (e) {
      throw new TacticalOutcomeResolverError(moduleId, `no se pudo cargar modules/${moduleId}/encounters/tactical/outcomeResolver.js: ${e.message}`);
    }
    if (typeof modulo?.resolverOutcomeModulo !== "function") {
      throw new TacticalOutcomeResolverError(moduleId, `modules/${moduleId}/encounters/tactical/outcomeResolver.js no exporta resolverOutcomeModulo()`);
    }
    await modulo.resolverOutcomeModulo(result, { actorId, onTexto });
    return { resuelto: true, via: "module-resolver" };
  }

  // outcome === null (combate en curso) o transición desconocida --
  // nada que resolver todavía, no es un error.
  return { resuelto: false, via: "sin-transicion" };
}
