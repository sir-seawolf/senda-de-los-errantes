// Shared Rules Bridge -- ÚNICA fuente de verdad para las reglas QS
// consumidas por el Tactical Engine core. Migrado desde el sandbox
// D:\SendaPhaserTest en Production Integration Phase 2 (ver
// docs/TACTICAL_PRODUCTION_PHASE2.md) -- aquí vive DENTRO del mismo
// árbol que el Rules Engine real, así que los imports son rutas
// relativas directas, sin alias de build (el alias de Vite "@qs-rules"
// solo existía en el sandbox, donde el bridge vivía en un proyecto
// distinto). NINGUNA función de reglas está reimplementada aquí.
// Superficie explícita y pequeña (nada de "export * from everything").
//
// DOM-free real: ver docs/TACTICAL_PRODUCTION_PHASE2_AUDIT.md
// "Reaudito del efecto de import de audioManager.js" -- en producción
// (a diferencia del sandbox) esto es CERO efecto adicional, verificado
// por singleton de módulos ES (audioManager.js es el mismo archivo/URL
// que main.js ya importa).
import {
  createActivation,
  movementRemaining,
  actuacionAgotada,
  applyResourceCost,
  validateIntent as qsValidateIntent,
  resolveIntent as qsResolveIntent,
  COSTO_MUNICION,
  TAMANO_ACCIONES,
  costeAccionesPorTamano,
  avanzarProgreso,
  cambiarArma,
  validarDivisionDefensiva,
  resolverDefensaDividida,
  resolverEsquivaTotal,
  resolverMovimientoEvasivo
} from "../../combat/rulesEngine.js";
import { valorCobertura } from "../../rules/cover.js";
import { penalizadorPorNivel } from "../../rules/woundPenalty.js";
import { nivelHeridaDe } from "../../gameState.js";
import { tirarIniciativa, ordenDeActuacion, modificadorCadencia } from "../../combat/combat.js";
import { claveQsDeNivelSpatial } from "./coverTranslation.js";

// Ampliación de superficie para el Vertical Slice (punto "combate jugable
// completo" del encargo PHASER_TACTICAL_RENDERER_VERTICAL_SLICE) --
// misma disciplina que la fase Shared Rules Bridge: solo lo que la escena
// usa de verdad, todo re-exportado sin reimplementar ninguna fórmula.
//
// `nivelHeridaDe` viene de `@qs-rules/gameState.js` -- auditado antes de
// importarlo: la única función que se consume es pura (lee
// `vidaActual`/`base.niveles`, no llama a `guardar()`/`notificarFicha()`).
// El resto de gameState.js (mutaciones de `state`, persistencia) NUNCA se
// invoca desde el sandbox -- el runtime de combatientes del Vertical
// Slice es propio (ver src/config/predatorTactical.js), no
// `state.partyMembers`. Ver docs/PHASER_TACTICAL_VERTICAL_SLICE.md,
// sección "Reutilización de gameState.js", para el detalle de esta
// decisión.
export {
  createActivation, movementRemaining, actuacionAgotada, applyResourceCost,
  COSTO_MUNICION, TAMANO_ACCIONES, costeAccionesPorTamano, avanzarProgreso, cambiarArma,
  validarDivisionDefensiva, resolverDefensaDividida, resolverEsquivaTotal, resolverMovimientoEvasivo,
  penalizadorPorNivel, nivelHeridaDe,
  tirarIniciativa, ordenDeActuacion, modificadorCadencia
};

/**
 * validateIntent() del Rules Engine real, con UNA frontera añadida antes:
 * si el Spatial Cover Adapter (sandbox-side, ver
 * docs/SPATIAL_COVER_ADAPTER.md) dice canAttack=false, se rechaza el
 * intent ANTES de preguntarle nada al Rules Engine real -- ni tirada, ni
 * munición, ni acción principal (punto 17 del encargo, caso obligatorio).
 * El Rules Engine real no sabe nada de "cobertura total bloquea línea de
 * tiro" -- esa es una decisión DIGITAL_SPATIAL_ADAPTATION (punto 16), no
 * canon QS; por eso se resuelve aquí, en el bridge, no dentro de
 * rulesEngine.js.
 *
 * @param {object} actor - forma runtime esperada por el Rules Engine real (actor.municion.*)
 * @param {object} intent - {type, ...} igual que validateIntent() real
 * @param {object} [activation] - igual que validateIntent() real
 * @param {{level:string, canAttack:boolean, source:string|null}|null} [spatialContext] - resultado de SpatialCoverAdapter.getCover()
 */
export function validateIntent(actor, intent, activation, spatialContext = null) {
  if ((intent.type === "ATTACK" || intent.type === "BURST") && spatialContext && spatialContext.canAttack === false) {
    return { valid: false, reasons: ["TARGET_FULLY_COVERED"] };
  }
  return qsValidateIntent(actor, intent, activation);
}

/**
 * resolveIntent() del Rules Engine real. Si se pasa spatialContext, su
 * `level` ("none"/"partial"/"solid"/"total") se traduce a la clave QS
 * canónica (src/rules/cover.js) y se inyecta como intent.coberturaObjetivo
 * -- el número real (0/1/2/3) se lee de producción en cada llamada, nunca
 * se copia (punto 23 del encargo: "Spatial adapter clasifica. Rules
 * Engine aplica efecto. No restar cobertura manualmente en Phaser.").
 * Si intent.coberturaObjetivo ya viene explícito (p.ej. tests directos),
 * se respeta y no se sobreescribe.
 */
export function resolveIntent(actor, target, intent, context = {}, spatialContext = null) {
  let intentFinal = intent;
  if (spatialContext && intent.coberturaObjetivo === undefined) {
    const claveQs = claveQsDeNivelSpatial(spatialContext.level);
    intentFinal = { ...intent, coberturaObjetivo: valorCobertura(claveQs) };
  }
  return qsResolveIntent(actor, target, intentFinal, context);
}
