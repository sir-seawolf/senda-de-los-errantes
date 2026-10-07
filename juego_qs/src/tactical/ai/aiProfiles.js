// AI PROFILE (encargo TACTICAL_ENGINE_MODULE_CONTRACT, punto 28-29):
// separa TacticalAI CORE (src/ai/tacticalAI.js, la secuencia de decisión)
// de la CONFIGURACIÓN de esa secuencia. Un perfil es un puñado de flags,
// no un árbol de comportamiento nuevo -- "no construir árbol de
// comportamiento complejo" (punto 28). Un módulo elige un perfil por
// nombre en su encounterDefinition (`ai.enemies`/`ai.companions`); nunca
// tiene que escribir una IA nueva para un encuentro normal (punto 29).
import { PERFIL_POR_DEFECTO } from "./tacticalAI.js";

export const AI_PROFILES = {
  // Comportamiento exacto de antes de que existiera el concepto de
  // perfil -- el que usa Predator. Alias "cautious" porque busca
  // cobertura y evade cuando está grave antes de exponerse.
  cautious: PERFIL_POR_DEFECTO,

  // No busca cobertura, no evade -- siempre intenta el daño más directo
  // disponible. Útil para encuentros donde la ambientación pide enemigos
  // temerarios (p.ej. una fixture de prueba, o un futuro perfil narrativo).
  aggressive: {
    buscarCobertura: false,
    evadirSiGraveHerida: false,
    priorizarDisparoSobreCC: true
  },

  // Prioriza sobrevivir sobre hacer daño: evade en cuanto puede (no solo
  // gravemente herido) y sigue buscando cobertura.
  defensive: {
    buscarCobertura: true,
    evadirSiGraveHerida: true,
    priorizarDisparoSobreCC: false
  }
};

export function resolverPerfilIA(nombre) {
  return AI_PROFILES[nombre] ?? AI_PROFILES.cautious;
}
