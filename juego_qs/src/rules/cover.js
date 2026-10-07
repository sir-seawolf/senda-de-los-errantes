// Niveles de cobertura, QS PARTE 1 "Penetración y cobertura" (ver
// src/combat/combat.js, resolverAtaque). Mismos valores que
// src/data/shared/rules.json → cobertura, duplicados aquí como constante síncrona:
// combate.js los necesita en el mismo tick del clic de "Cubrirse", sin poder
// esperar a un fetch. rules.json queda como referencia legible para quien
// audite las reglas; este módulo es la fuente que el motor ejecuta de verdad.
export const NIVELES_COBERTURA = {
  ninguna: { valor: 0, etiqueta: "Sin cobertura" },
  parcial: { valor: 1, etiqueta: "Cobertura parcial" },
  solida: { valor: 2, etiqueta: "Cobertura sólida" },
  total: { valor: 3, etiqueta: "Cobertura total" }
};

export function valorCobertura(clave) {
  return NIVELES_COBERTURA[clave]?.valor ?? NIVELES_COBERTURA.ninguna.valor;
}

// Etiqueta visible por umbral, sin exponer el número exacto de Blindaje que
// concede — mismo criterio que estadoVisibleEnemigo() en combat.js (punto 20
// del encargo original: no revelar cifras internas cuando el sistema no lo
// justifica).
export function etiquetaCoberturaVisible(clave) {
  const valor = valorCobertura(clave);
  if (valor <= 0) return "sin cobertura";
  if (valor === 1) return "cobertura parcial";
  return "cobertura relevante";
}
