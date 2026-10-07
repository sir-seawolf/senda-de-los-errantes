// TacticalEncounterLoader (encargo TACTICAL_ENGINE_MODULE_CONTRACT,
// punto 6/36/43): valida un TacticalEncounterDefinition (fail-fast, ANTES
// de arrancar Phaser) y produce una TacticalSession nueva lista para que
// TacticalScene la consuma. Punto 36: API conceptual para módulos --
// `loadTacticalEncounter(definition)` -- demostrable en el sandbox, sin
// integrar todavía con un loader de módulos productivo.
import { validateEncounterDefinition, conDefaults } from "../contracts/TacticalEncounterDefinition.js";
import { crearTacticalSession } from "./TacticalSession.js";

export class TacticalEncounterError extends Error {
  constructor(encounterId, errors) {
    super(`TACTICAL_ENCOUNTER_INVALID (${encounterId}):\n${errors.map(e => "  - " + e).join("\n")}`);
    this.name = "TacticalEncounterError";
    this.encounterId = encounterId;
    this.errors = errors;
  }
}

/**
 * Carga un encuentro táctico: valida y, si es válido, crea la
 * TacticalSession. Lanza TacticalEncounterError (fail-fast, punto 43) si
 * la definición es inválida -- nunca deja llegar un encuentro roto a
 * mitad de combate.
 *
 * @param {object} definition - TacticalEncounterDefinition (sin defaults aplicados)
 * @returns {{ definition: object, session: object }}
 */
export function loadTacticalEncounter(definition) {
  const { valid, errors } = validateEncounterDefinition(definition);
  if (!valid) {
    throw new TacticalEncounterError(definition?.id ?? "(sin id)", errors);
  }
  const definitionConDefaults = conDefaults(definition);
  const session = crearTacticalSession(definitionConDefaults);
  return { definition: definitionConDefaults, session };
}
