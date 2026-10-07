// Progresión de habilidades por uso.
//
// Fuente: NO está en la chuleta del Quick Starter (QUICKSTART_Kit_de_Inicio_v2.md,
// líneas 73-250 — el QS no cubre progresión en absoluto). El propio QS se declara
// "versión reducida para playtest" y remite al manual completo para todo lo que no
// cubre (QS línea 63). La regla real vive en el manual:
//
//   CAP03_Mecanicas_Sistema_v2_DEFINITIVO.md, línea 243:
//   "Por uso: críticos y pifias en tiradas suben la habilidad usada según la tabla
//   de resultados (+1/+2/+3). Estas mejoras permanentes cuentan para REC como
//   experiencia adquirida y recalculan POT cuando cambian el valor máximo
//   relevante de su categoría."
//
// "La tabla de resultados" es la misma tabla de crítico/pifia ya implementada en
// rules/dice.js (00→+3, 01→+2, 02→+1 éxitos · 97→-1, 98→-2, 99→-3 éxitos). Este
// módulo reutiliza esa magnitud: un crítico sube la habilidad usada +3/+2/+1 según
// el número exacto sacado, y una pifia la sube +1/+2/+3 (a mayor pifia, mayor
// margen de aprendizaje del fallo — coherente con la cita del propio manual en la
// sección de Enseñanza Directa: "El fallo indica que había margen de aprendizaje").
//
// REC/POT (recálculo de Reconocimiento y Potencial) no se implementan todavía en
// este prototipo — quedan fuera de alcance de esta iteración y se documentan como
// pendientes en QS_RULE_MAP.md. Aquí solo se aplica el incremento permanente a la
// habilidad concreta.

const INCREMENTO_CRITICO = { 0: 3, 1: 2, 2: 1 };
const INCREMENTO_PIFIA = { 97: 1, 98: 2, 99: 3 };

// Resolver tirada -> ¿genera esto progreso? No muta nada, solo evalúa.
export function evaluarProgreso(resultadoTirada) {
  const { tirada, esCritico, esPifia } = resultadoTirada;
  if (esCritico) {
    const incremento = INCREMENTO_CRITICO[tirada];
    if (incremento) return { incremento, motivo: "critico" };
  }
  if (esPifia) {
    const incremento = INCREMENTO_PIFIA[tirada];
    if (incremento) return { incremento, motivo: "pifia" };
  }
  return null;
}

// Aplica el progreso (si lo hay) sobre el estado runtime de un miembro del grupo.
// `miembroRuntime.habilidades` es la copia mutable (nunca characters.json base).
// Devuelve el detalle del cambio para mostrar feedback, o null si no hubo progreso.
export function aplicarProgreso(miembroRuntime, skillId, resultadoTirada) {
  const progreso = evaluarProgreso(resultadoTirada);
  if (!progreso) return null;
  const anterior = miembroRuntime.habilidades[skillId];
  if (anterior === undefined) return null; // habilidad no catalogada: no hay base sobre la que progresar

  const nuevo = anterior + progreso.incremento;
  miembroRuntime.habilidades[skillId] = nuevo;

  return {
    skillId,
    anterior,
    nuevo,
    incremento: progreso.incremento,
    motivo: progreso.motivo
  };
}
