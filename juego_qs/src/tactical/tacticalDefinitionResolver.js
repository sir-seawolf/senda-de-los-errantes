// Resolver de TacticalEncounterDefinition por moduleId + definitionId
// (Production Integration Phase 4, ver docs/TACTICAL_PRODUCTION_PHASE4.md).
//
// Vive en la capa de INTEGRACIÓN/gateway (junto a
// tacticalPhaserRenderer.js), NUNCA dentro de src/tactical/{contracts,
// core,ai,spatial,bridge}/ -- el core sigue sin saber qué módulos
// existen. Este archivo tampoco importa nada de ningún módulo
// concreto directamente: solo conoce una CONVENCIÓN de ruta
// (modules/<moduleId>/encounters/tactical/index.js) que CUALQUIER
// módulo puede implementar -- ver
// docs/TACTICAL_PRODUCTION_PHASE4.md para el primer módulo real que la
// usa (test de aislamiento motor/módulo, tests/moduleIsolation.test.mjs,
// exige que src/ nunca mencione el id de un módulo concreto por
// nombre).
//
// Import dinámico con ruta calculada: ESM estándar, sin bundler, sin
// alias de Vite -- funciona igual en Node (`node --test`) y en el
// navegador real, mismo criterio que el resto de src/tactical/.

export class TacticalDefinitionNotFoundError extends Error {
  constructor(moduleId, definitionId, reason) {
    super(`TACTICAL_ENCOUNTER_NOT_FOUND: moduleId="${moduleId}" definitionId="${definitionId}" reason="${reason}"`);
    this.name = "TacticalDefinitionNotFoundError";
    this.moduleId = moduleId;
    this.definitionId = definitionId;
    this.reason = reason;
  }
}

/**
 * Resuelve una TacticalEncounterDefinition real a partir de un
 * moduleId + definitionId (el `escena.tactical.definitionId` que un
 * encounter payload puede declarar, ver combat.js/cargarEncuentroSiProcede).
 * NO valida la definición (eso es responsabilidad del caller, vía
 * validateEncounterDefinition() del contrato) -- este resolver solo
 * localiza el objeto.
 *
 * @param {string} moduleId
 * @param {string} definitionId
 * @param {(moduleId:string) => Promise<any>} [importarRegistro] -- inyectable SOLO para tests (evita depender de rutas reales de fetch/import en Node)
 * @returns {Promise<object>} TacticalEncounterDefinition (sin defaults aplicados)
 */
export async function resolverTacticalDefinition(moduleId, definitionId, importarRegistro = (id) => import(`../../modules/${id}/encounters/tactical/index.js`)) {
  if (!moduleId) throw new TacticalDefinitionNotFoundError(moduleId, definitionId, "moduleId no proporcionado");
  if (!definitionId) throw new TacticalDefinitionNotFoundError(moduleId, definitionId, "definitionId no proporcionado");

  let registro;
  try {
    registro = await importarRegistro(moduleId);
  } catch (e) {
    throw new TacticalDefinitionNotFoundError(moduleId, definitionId, `no se pudo cargar el registro táctico del módulo (modules/${moduleId}/encounters/tactical/index.js): ${e.message}`);
  }

  const definicion = registro?.TACTICAL_ENCOUNTERS?.[definitionId];
  if (!definicion) {
    throw new TacticalDefinitionNotFoundError(moduleId, definitionId, `definitionId no está registrado en TACTICAL_ENCOUNTERS del módulo "${moduleId}"`);
  }
  return definicion;
}
