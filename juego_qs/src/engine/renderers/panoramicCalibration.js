// Capa de calibración para escenas panorámicas (config.debug.
// showPanoramicCalibration, "false" por defecto -- solo desarrollo).
// Genérica a propósito: lee únicamente lo que cualquier escena de tipo
// "panoramic" ya declara (master, walkable, objects[].anchor/width/height,
// hotspots[].objectRef) -- no conoce "callejón" ni ningún id concreto, así
// que sirve igual para cualquier localización futura de Localización C (ver
// docs/CONTRATO_VISUAL_PREDATOR.md y CALIBRACION_GEOMETRICA_CALLEJON_
// PREDATOR.md). Vive DENTRO de #mundo (la llama panoramic.js como hija más),
// así que hereda la misma transformación de escala/cámara que el fondo, los
// objetos y el avatar -- ninguna coordenada propia en píxeles de viewport.
//
// Las cajas se derivan con las MISMAS funciones que usa el renderer real
// (cajaDeObjeto/cajaDeHotspot) -- la calibración nunca recalcula su propia
// versión de la geometría, o podría mentir sobre dónde está realmente algo.
import { cajaDeObjeto, cajaDeHotspot, resolverEstadoObjeto } from "./panoramic.js";

const NS = "http://www.w3.org/2000/svg";

function crearSvgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function montarCapaCalibracion(mundoEl, escena) {
  const w = escena.master.width;
  const h = escena.master.height;

  const svg = crearSvgEl("svg", {
    class: "panoramica-calibracion",
    viewBox: `0 0 ${w} ${h}`,
    width: w,
    height: h
  });

  // Cuadrícula del mundo cada 100px, con coordenada legible cada 200px.
  const grid = crearSvgEl("g", { class: "cal-grid" });
  for (let x = 0; x <= w; x += 100) {
    grid.appendChild(crearSvgEl("line", { x1: x, y1: 0, x2: x, y2: h }));
    if (x % 200 === 0) grid.appendChild(crearSvgEl("text", { x: x + 4, y: 14 })).textContent = String(x);
  }
  for (let y = 0; y <= h; y += 100) {
    grid.appendChild(crearSvgEl("line", { x1: 0, y1: y, x2: w, y2: y }));
    if (y % 200 === 0) grid.appendChild(crearSvgEl("text", { x: 4, y: y + 14 })).textContent = String(y);
  }
  svg.appendChild(grid);

  // Banda caminable + línea de pies.
  const walkable = escena.walkable;
  if (walkable) {
    if (Array.isArray(walkable.band) && walkable.band.length === 2) {
      svg.appendChild(crearSvgEl("rect", {
        class: "cal-banda",
        x: walkable.xMin ?? 0, y: walkable.band[0],
        width: (walkable.xMax ?? w) - (walkable.xMin ?? 0), height: walkable.band[1] - walkable.band[0]
      }));
    }
    const lineaPies = crearSvgEl("line", {
      class: "cal-linea-pies", x1: walkable.xMin ?? 0, y1: walkable.y, x2: walkable.xMax ?? w, y2: walkable.y
    });
    svg.appendChild(lineaPies);
  }

  // Cajas de objetos + punto de anclaje (derivadas con cajaDeObjeto, igual
  // que el renderer real -- nunca una copia propia de la geometría).
  (escena.objects || []).forEach(obj => {
    if (!obj.anchor) return;
    const caja = cajaDeObjeto(obj, resolverEstadoObjeto(obj));
    svg.appendChild(crearSvgEl("rect", {
      class: "cal-caja-objeto", x: caja.x, y: caja.y, width: caja.width, height: caja.height
    }));
    const cx = obj.anchor.x, cy = obj.anchor.y;
    const cruz = crearSvgEl("g", { class: "cal-anclaje" });
    cruz.appendChild(crearSvgEl("line", { x1: cx - 8, y1: cy, x2: cx + 8, y2: cy }));
    cruz.appendChild(crearSvgEl("line", { x1: cx, y1: cy - 8, x2: cx, y2: cy + 8 }));
    svg.appendChild(cruz);
    const etiqueta = crearSvgEl("text", { class: "cal-etiqueta", x: caja.x + 2, y: caja.y - 4 });
    etiqueta.textContent = obj.id;
    svg.appendChild(etiqueta);
  });

  // Cajas de hotspots (derivadas con cajaDeHotspot -- la misma que usa la
  // interacción real para decidir proximidad).
  (escena.hotspots || []).forEach(hs => {
    const caja = cajaDeHotspot(hs, escena.objects || []);
    if (!caja) return;
    svg.appendChild(crearSvgEl("rect", {
      class: "cal-caja-hotspot", x: caja.x, y: caja.y, width: caja.width, height: caja.height
    }));
  });

  mundoEl.appendChild(svg);
  return svg;
}
