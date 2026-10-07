import { state, obtenerJugador, nivelHeridaDe } from "../gameState.js";
import { rutaAsset } from "../engine/moduleLoader.js";
import { fichaColapsada, establecerFichaColapsada } from "./uiSettings.js";

// Cierre del cajón superpuesto (layout "overlay") al pulsar fuera o con
// Escape (encargo de calibración, 2026-08-22, punto 2). Solo un listener
// vivo a la vez -- cada renderFicha() retira el anterior antes de decidir
// si hace falta uno nuevo, así remontar la ficha muchas veces (cada roll,
// cada flag) nunca acumula listeners fantasma en document.
let limpiarCierreSuperpuesto = null;

function escaparHtml(texto) {
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inicialesDe(nombre) {
  const partes = String(nombre ?? "").trim().split(/\s+/).filter(Boolean);
  return (partes.length > 1 ? partes[0][0] + partes.at(-1)[0] : partes[0]?.slice(0, 2) || "PJ").toUpperCase();
}

export function renderInventario(items = []) {
  if (!items.length) return '<li class="ficha-inventario-vacio">Sin objetos</li>';
  return items.map(item => `<li>${escaparHtml(item)}</li>`).join("");
}

// Ficha lateral: solo la información necesaria en cada momento. `contexto` decide
// qué bloques adicionales se muestran (exploración / persecución / combate) — ver
// docs/PARTY_SYSTEM.md, sección HUD dinámico.
//
// Iteración 0.3 (UI/UX): plegable — el escenario debe poder recuperar el
// espacio que ocupa la ficha (punto 7-9 del encargo). Estado persistido en
// uiSettings.js, nunca perdido al remontar. Colapsada, se muestra una tira
// compacta con lo crítico (nombre/vida/PE/estado) — nunca un icono sin
// texto: "no diseñar una mini-ficha ilegible".
export function renderFicha(container, contexto = "callejon", layout = "docked") {
  limpiarCierreSuperpuesto?.();
  limpiarCierreSuperpuesto = null;

  const m = obtenerJugador();
  if (!m) { container.innerHTML = ""; container.classList.remove("colapsada"); return; }
  const base = m.base;

  const nivel = nivelHeridaDe(m);
  const vida = m.vidaActual;
  const totalVida = base.niveles.sano + base.niveles.herido + base.niveles.tullido;
  const vidaRestante = vida.sano + vida.herido + vida.tullido;
  const colapsada = fichaColapsada(layout);
  container.classList.toggle("colapsada", colapsada);

  const iconoToggle = colapsada
    ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 2 6 6-6 6"/></svg>'
    : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m11 2-6 6 6 6"/></svg>';
  const tituloToggle = colapsada ? "Mostrar ficha" : "Ocultar ficha";
  const botonToggle = `<button type="button" class="ficha-toggle" id="btn-ficha-toggle" aria-label="${tituloToggle}" aria-expanded="${!colapsada}" title="${tituloToggle}">${iconoToggle}</button>`;

  if (colapsada) {
    const segmentosVida = ["sano", "herido", "tullido"].map((tramo) => {
      const maximo = base.niveles[tramo] || 1;
      const relleno = Math.max(0, Math.min(100, (vida[tramo] / maximo) * 100));
      return `<span class="fc-vida-segmento ${tramo}" aria-hidden="true"><i style="width:${relleno}%"></i></span>`;
    }).join("");
    const epicosMini = Array.from({ length: base.puntosEpicos }, (_, i) =>
      `<span class="fc-pe-punto ${i < m.puntosEpicosActuales ? "activo" : ""}" aria-hidden="true"></span>`
    ).join("");
    container.innerHTML = `
      ${botonToggle}
      <div class="ficha-compacta" id="btn-ficha-expandir" role="button" tabindex="0" aria-label="Mostrar ficha completa">
        <div class="fc-nombre">${escaparHtml(base.nombre)}</div>
        <div class="fc-recursos">
          <div class="fc-vida-bar" role="img" aria-label="${nivel}; ${vidaRestante} de ${totalVida} puntos de vida" title="${nivel.toUpperCase()} · ${vidaRestante}/${totalVida}">${segmentosVida}</div>
          <div class="fc-pe" role="img" aria-label="${m.puntosEpicosActuales} de ${base.puntosEpicos} Puntos Épicos" title="PE ${m.puntosEpicosActuales}/${base.puntosEpicos}">${epicosMini}</div>
        </div>
      </div>
      <button type="button" class="ficha-inventario-acceso" id="btn-inventario" aria-label="Abrir inventario">Inventario</button>
    `;
    const expandir = () => { establecerFichaColapsada(false, layout); renderFicha(container, contexto, layout); };
    container.querySelector("#btn-ficha-toggle")?.addEventListener("click", expandir);
    const compacta = container.querySelector("#btn-ficha-expandir");
    compacta?.addEventListener("click", expandir);
    compacta?.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); expandir(); } });
    container.querySelector("#btn-inventario")?.addEventListener("click", () => import("./inventoryManager.js").then(({ mostrarGestorInventario }) => mostrarGestorInventario()));
    return;
  }

  const epicos = Array.from({ length: base.puntosEpicos }, (_, i) =>
    `<span class="ep-dot ${i < m.puntosEpicosActuales ? "activo" : ""}" aria-hidden="true"></span>`).join("");

  let bloqueContextual = "";
  if (contexto === "combate") {
    // Arma activa (punto 20 del encargo): el runtime ya conoce
    // munición/cargador/reserva desde Combat UX 0.2 (m.municion) — mostrarlo
    // aquí es solo lectura, no una mecánica nueva de selección de equipo.
    const municionTexto = m.municion ? `${m.municion.cargador}/${m.municion.reserva}` : null;
    bloqueContextual = `
      <div class="ficha-bloque">
        <div class="ficha-titulo">Arma activa</div>
        <div>${base.arma?.nombre ?? "—"} — daño ${base.arma?.danio ?? 0}${base.arma?.cadenciaMax ? " · " + base.arma.cadenciaMax : ""}</div>
        ${municionTexto ? `<div class="ficha-municion">${municionTexto}</div>` : ""}
        <div class="ficha-titulo">Protección</div>
        <div>${base.armadura?.blindaje ? base.armadura.nombre + " (Blindaje " + base.armadura.blindaje + ")" : "Sin protección"}</div>
        <div class="ficha-titulo">Estado</div>
        <div>${m.estadoDisponibilidad}</div>
      </div>`;
  } else if (contexto === "persecucion") {
    const ep = state.estadoPersecucion;
    bloqueContextual = `
      <div class="ficha-bloque">
        <div class="ficha-titulo">Atlética / Esquivar</div>
        <div>${m.habilidades["Atlética"] ?? "—"} / ${m.habilidades["Esquivar"] ?? "—"}</div>
        <div class="ficha-titulo">Persecución</div>
        <div>${ep ? `Perseguidor a ${ep.distanciaActual?.toFixed?.(1) ?? "—"} m` : "—"}</div>
        <div class="ficha-titulo">Objetivo</div>
        <div>${ep?.objetivo ?? "Llegar a un refugio o vehículo"}</div>
      </div>`;
  }

  const retrato = base.retrato ? rutaAsset(base.retrato) : "";
  container.innerHTML = `
    ${botonToggle}
    <div class="ficha">
      <div class="ficha-retrato" role="img" aria-label="Retrato de ${escaparHtml(base.nombre)}"><span>${escaparHtml(inicialesDe(base.nombre))}</span>${retrato ? `<img src="${escaparHtml(retrato)}" alt="">` : ""}</div>
      <div class="ficha-nombre">${escaparHtml(base.nombre)}</div>
      <div class="ficha-rol">${escaparHtml(base.rol)}</div>

      <div class="ficha-bloque">
        <div class="ficha-titulo">Vida (${nivel.toUpperCase()})</div>
        <div class="barra-vida"><div class="barra-vida-fill" style="width:${Math.max(0, (vidaRestante / totalVida) * 100)}%"></div></div>
        <div class="vida-detalle">Sano ${vida.sano}/${base.niveles.sano} · Herido ${vida.herido}/${base.niveles.herido} · Tullido ${vida.tullido}/${base.niveles.tullido}</div>
      </div>

      ${bloqueContextual}

      <div class="ficha-bloque">
        <div class="ficha-titulo">Puntos Épicos</div>
        <div class="ep-dots">${epicos}</div>
      </div>

      <div class="ficha-bloque">
        <div class="ficha-titulo">Inventario</div>
        <ul class="ficha-inventario">${renderInventario(m.inventario)}</ul>
        <button type="button" class="ficha-inventario-gestionar" id="btn-inventario">Gestionar equipo y transferencias</button>
      </div>

      <button class="btn-historial" id="btn-abrir-historial">Historial de tiradas</button>
    </div>
  `;
  const imagenRetrato = container.querySelector(".ficha-retrato img");
  if (imagenRetrato) {
    const retirarImagenRota = () => imagenRetrato.remove();
    imagenRetrato.addEventListener("error", retirarImagenRota, { once: true });
    if (imagenRetrato.complete && imagenRetrato.naturalWidth === 0) retirarImagenRota();
  }

  const colapsar = () => {
    establecerFichaColapsada(true, layout);
    renderFicha(container, contexto, layout);
  };
  container.querySelector("#btn-ficha-toggle")?.addEventListener("click", colapsar);
  container.querySelector("#btn-abrir-historial")?.addEventListener("click", () => {
    import("./rollLog.js").then(m => m.mostrarHistorial());
  });
  container.querySelector("#btn-inventario")?.addEventListener("click", () => import("./inventoryManager.js").then(({ mostrarGestorInventario }) => mostrarGestorInventario()));

  // Cajón superpuesto expandido: cerrar al pulsar fuera o con Escape (punto 2
  // del encargo de calibración). En layout "docked" la ficha siempre ocupó
  // su propia columna -- "fuera" incluiría el escenario entero, así que ese
  // comportamiento no aplica y no se activa.
  if (layout === "overlay") {
    const alPulsarFuera = (e) => { if (!container.contains(e.target)) colapsar(); };
    const alTeclado = (e) => { if (e.key === "Escape") colapsar(); };
    document.addEventListener("pointerdown", alPulsarFuera);
    document.addEventListener("keydown", alTeclado);
    limpiarCierreSuperpuesto = () => {
      document.removeEventListener("pointerdown", alPulsarFuera);
      document.removeEventListener("keydown", alTeclado);
    };
  }
}
