import { costeMovimientoEntre, elevacionEn, terrenoEn } from "../spatial/terrainZones.js";

const ETIQUETAS_COBERTURA = Object.freeze({
  none: "sin cobertura",
  partial: "cobertura parcial",
  solid: "cobertura sólida",
  total: "línea bloqueada"
});

export function etiquetaCobertura(nivel, canAttack = true) {
  if (!canAttack || nivel === "total") return ETIQUETAS_COBERTURA.total;
  return ETIQUETAS_COBERTURA[nivel] ?? ETIQUETAS_COBERTURA.none;
}

export function probabilidadObjetivo(objetivo, modoFuego = "tiroATiro") {
  if (!objetivo) return null;
  const final = modoFuego === "rafaga" ? objetivo.burstHitChance : objetivo.hitChance;
  const base = objetivo.baseHitChance ?? final;
  return {
    final,
    base,
    diferenciaCobertura: Number.isFinite(final) && Number.isFinite(base) ? final - base : 0,
    cobertura: etiquetaCobertura(objetivo.cover, objetivo.canAttack),
    distancia: objetivo.distance
  };
}

// Convierte el presupuesto de movimiento real en destinos de un metro que
// el renderer puede pintar. No decide movimiento ni altera la sesión: usa la
// misma función de coste que el controlador y devuelve únicamente lectura.
export function celdasMovimientoAlcanzables({ origen, presupuesto, width, height, terrainZones = [], terrainConfig = {} }) {
  if (!origen || !Number.isFinite(presupuesto) || presupuesto <= 0) return [];
  const celdas = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const destino = { x: x + .5, y: y + .5 };
      const coste = costeMovimientoEntre(origen, destino, terrainZones, terrainConfig);
      if (coste > presupuesto + 1e-6) continue;
      const zona = terrenoEn(terrainZones, destino.x, destino.y);
      celdas.push({
        ...destino,
        coste: Number(coste.toFixed(1)),
        terrainId: zona?.id ?? null,
        terrainLabel: zona?.label ?? null,
        movementMultiplier: zona?.movementMultiplier ?? 1,
        elevationMeters: elevacionEn(terrainZones, destino.x, destino.y)
      });
    }
  }
  return celdas;
}
