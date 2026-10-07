// Registro de TacticalEncounterDefinitions del módulo Predator N-5.2
// (Production Integration Phase 4, ver docs/TACTICAL_PRODUCTION_PHASE4.md).
//
// Convención genérica que el gateway táctico
// (src/tactical/tacticalDefinitionResolver.js) espera de CUALQUIER
// módulo que quiera ofrecer encuentros tácticos:
// modules/<moduleId>/encounters/tactical/index.js exportando
// TACTICAL_ENCOUNTERS = { [definitionId]: TacticalEncounterDefinition }.
// El resolver no sabe nada de Predator -- solo conoce esta convención de
// ruta y de forma, igual para cualquier módulo futuro.
import { predatorTacticalEncounter } from "./predatorTacticalEncounter.js";

export const TACTICAL_ENCOUNTERS = {
  [predatorTacticalEncounter.id]: predatorTacticalEncounter
};
