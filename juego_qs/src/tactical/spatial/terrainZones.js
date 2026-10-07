// Adaptación espacial declarativa para superficies y desniveles.
// Las reglas siguen viviendo en metros; el módulo solo aporta rectángulos
// colocables con un multiplicador de movimiento y una elevación visual.

function dentro(zona, x, y) {
  return x >= zona.x && x <= zona.x + zona.width && y >= zona.y && y <= zona.y + zona.height;
}

export function terrenoEn(zonas = [], x, y) {
  return zonas.filter(zona => dentro(zona, x, y)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? null;
}

export function elevacionEn(zonas = [], x, y) {
  return zonas.reduce((max, zona) => dentro(zona, x, y) ? Math.max(max, zona.elevationMeters ?? 0) : max, 0);
}

// Liang-Barsky: intervalo [t0,t1] del segmento que atraviesa el rectángulo.
function intervaloRectangulo(origen, destino, zona) {
  const dx = destino.x - origen.x, dy = destino.y - origen.y;
  let t0 = 0, t1 = 1;
  const limites = [
    [-dx, origen.x - zona.x], [dx, zona.x + zona.width - origen.x],
    [-dy, origen.y - zona.y], [dy, zona.y + zona.height - origen.y]
  ];
  for (const [p, q] of limites) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [Math.max(0, t0), Math.min(1, t1)];
}

export function costeMovimientoEntre(origen, destino, zonas = [], { costeAscensoPorMetro = 0.5 } = {}) {
  const distancia = Math.hypot(destino.x - origen.x, destino.y - origen.y);
  if (distancia === 0) return 0;
  const cortes = [0, 1];
  for (const zona of zonas) {
    const intervalo = intervaloRectangulo(origen, destino, zona);
    if (intervalo) cortes.push(...intervalo);
  }
  cortes.sort((a, b) => a - b);
  let coste = 0;
  for (let i = 1; i < cortes.length; i += 1) {
    const a = cortes[i - 1], b = cortes[i];
    if (b - a < 1e-6) continue;
    const medio = (a + b) / 2;
    const x = origen.x + (destino.x - origen.x) * medio;
    const y = origen.y + (destino.y - origen.y) * medio;
    const multiplicador = Math.max(1, ...zonas.filter(z => dentro(z, x, y)).map(z => z.movementMultiplier ?? 1));
    coste += distancia * (b - a) * multiplicador;
  }
  const desnivel = Math.max(0, elevacionEn(zonas, destino.x, destino.y) - elevacionEn(zonas, origen.x, origen.y));
  return coste + desnivel * costeAscensoPorMetro;
}

export function puntoAlcanzable(origen, destino, presupuesto, zonas = [], config = {}) {
  if (presupuesto <= 0) return { ...origen, coste: 0, proporcion: 0 };
  const costeCompleto = costeMovimientoEntre(origen, destino, zonas, config);
  if (costeCompleto <= presupuesto) return { ...destino, coste: costeCompleto, proporcion: 1 };
  let bajo = 0, alto = 1;
  for (let i = 0; i < 24; i += 1) {
    const medio = (bajo + alto) / 2;
    const punto = { x: origen.x + (destino.x - origen.x) * medio, y: origen.y + (destino.y - origen.y) * medio };
    if (costeMovimientoEntre(origen, punto, zonas, config) <= presupuesto) bajo = medio; else alto = medio;
  }
  const punto = { x: origen.x + (destino.x - origen.x) * bajo, y: origen.y + (destino.y - origen.y) * bajo };
  return { ...punto, coste: costeMovimientoEntre(origen, punto, zonas, config), proporcion: bajo };
}
