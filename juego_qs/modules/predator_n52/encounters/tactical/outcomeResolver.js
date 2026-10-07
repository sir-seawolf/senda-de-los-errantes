// Resolver de derrota táctica de Predator N-5.2 (Production Integration
// Phase 5, ver docs/TACTICAL_PRODUCTION_PHASE5.md). Vive DENTRO del
// módulo (nunca en src/tactical/) -- es la implementación real que
// src/tactical/tacticalOutcomeResolver.js invoca cuando
// predatorTacticalEncounter.js declara `transitions.defeat: {resolver:
// "module"}` (Phase 3.5).
//
// Reutiliza aplicarConsecuencias() real -- nunca reimplementa
// transición/flags/registro de decisión.
import { aplicarConsecuencias } from "../../../../src/engine/sceneEngine.js";
import { rutaDeManifiesto } from "../../../../src/engine/moduleLoader.js";

// DEFEAT_EPIC_POINT_UX_NOT_PORTED (documentado, no silencioso): el
// combate legacy (src/engine/renderers/combat.js, mostrarConfirmPE())
// pregunta "¿gastar un Punto Épico?" en el momento EXACTO en que UN
// party member concreto muere, mostrando el diálogo sobre ESE
// personaje (objetivo.baseId) -- setFinalTipo "casi_muerto" si se
// gasta, "muerte" si no. El modelo táctico (TacticalSession) evalúa
// "defeat" como allPartyDown de forma agregada (posiblemente varios
// party members caen en la misma resolución de daño), sin un
// "objetivo" único y sin volver a que el jugador decida por-personaje
// en mitad del combate Phaser. Adaptar fielmente esa UX exigiría una
// decisión de diseño nueva (¿a quién se le pregunta si caen varios a
// la vez? ¿se pregunta dentro de TacticalScene o después?) que esta
// fase NO debe inventar (encargo: "no completar contenido narrativo
// pendiente", "no inventar"). Se aplica el camino real ya existente en
// encuentro_perseguidores_01.json (`onDeath`, "muerte", sin gastar
// Punto Épico) como resolución por defecto -- el MISMO destino
// (`finales`) y el MISMO setFinalTipo que legacy usa cuando el jugador
// no gasta el punto, así que ningún contenido inexistente se inventa.
// Pendiente de una decisión de autor si se quiere portar la variante
// "casi_muerto" al modelo táctico.
export async function resolverOutcomeModulo(result, { actorId, onTexto } = {}) {
  if (result.outcome !== "defeat") return; // este resolver solo sabe de derrota

  // rutaDeManifiesto() resuelve contra el módulo ACTIVO -- correcto aquí
  // porque este resolver solo se invoca mientras Predator es el módulo
  // en curso (nunca se importa "en frío" sin que el módulo esté cargado).
  const res = await fetch(`${rutaDeManifiesto("encounters")}encuentro_perseguidores_01.json`);
  const encuentro = await res.json();
  aplicarConsecuencias(encuentro.onDeath, actorId, { onTexto });
}
