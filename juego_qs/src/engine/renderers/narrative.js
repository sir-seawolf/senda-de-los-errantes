// Renderer genérico para escenas narrativas: point_click, decision, single_roll.
// Las tres comparten el mismo motor de interacciones (sceneEngine.js); solo
// cambia qué controles se dibujan. Ninguna escena concreta se nombra aquí.
import { cargarEscena, buscarInteraccion, ejecutarInteraccion } from "../sceneEngine.js";
import { moduloIdActivo, rutaAsset } from "../moduleLoader.js";
import { audioManager } from "../audioManager.js";
import { state } from "../../gameState.js";
import { config } from "../../config.js";
import { normalizeSceneLayers } from "../sceneLayers.js";
import { mountDomSceneLayers } from "./domSceneLayers.js";

export async function montarNarrativa(container, escenaId) {
  const escena = await cargarEscena(escenaId);
  const wrap = document.createElement("div");
  wrap.className = "narrativa";

  const fondoStyle = escena.background ? `background-image:url('${rutaAsset(escena.background)}')` : "";
  wrap.innerHTML = `
    <div class="narrativa-fondo" id="fondo" style="${fondoStyle}">
      <div class="hotspots" id="hotspots"></div>
    </div>
    <div class="narrativa-hud">
      <div class="narrativa-texto" id="texto"><em>${escena.introText || ""}</em></div>
      <div id="controles"></div>
    </div>
  `;
  container.appendChild(wrap);

  const fondoEl = wrap.querySelector("#fondo");
  const texto = wrap.querySelector("#texto");
  const hotspotsEl = wrap.querySelector("#hotspots");
  const controlesEl = wrap.querySelector("#controles");

  let updateLayerPresentation = () => {};
  if (escena.presentation) {
    // Las escenas compuestas necesitan que imagen, texto y acciones compartan
    // un viewport estable. La clase solo cambia el layout: el motor de
    // interacciones y los tipos narrativos siguen siendo los mismos.
    wrap.classList.add("narrativa-con-presentacion");
    const presentation = normalizeSceneLayers(escena);
    if (presentation.width > 0 && presentation.height > 0 && presentation.layers.length) {
      const layerHost = document.createElement("div");
      layerHost.className = "narrativa-presentacion";
      layerHost.style.width = `${presentation.width}px`;
      layerHost.style.height = `${presentation.height}px`;
      fondoEl.prepend(layerHost);
      const layers = mountDomSceneLayers(layerHost, presentation, { resolveResource: rutaAsset });
      const pointer = { x: 0, y: 0 };

      function reducedMotion() {
        return config.accessibility.reduceMotion ||
          document.documentElement.classList.contains("reduce-motion") ||
          Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
      }
      updateLayerPresentation = (timeMs = performance.now()) => layers.update({
        cameraX: 0, cameraY: 0, pointerX: pointer.x, pointerY: pointer.y,
        timeMs, reducedMotion: reducedMotion(), flags: state.flags
      });
      function fitPresentation() {
        const scale = Math.max(
          fondoEl.clientWidth / presentation.width,
          fondoEl.clientHeight / presentation.height
        );
        layerHost.style.transform = `translate(-50%, -50%) scale(${scale || 1})`;
        updateLayerPresentation();
      }
      fondoEl.addEventListener("pointermove", event => {
        const rect = fondoEl.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
        pointer.y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
        updateLayerPresentation();
      });
      fondoEl.addEventListener("pointerleave", () => {
        pointer.x = 0; pointer.y = 0; updateLayerPresentation();
      });
      new ResizeObserver(fitPresentation).observe(fondoEl);
      fitPresentation();

      if (presentation.layers.some(layer => layer.oscillation.x || layer.oscillation.y)) {
        function animateLayers(timestamp) {
          if (!wrap.isConnected) return;
          updateLayerPresentation(timestamp);
          requestAnimationFrame(animateLayers);
        }
        requestAnimationFrame(animateLayers);
      }
    }
  }

  function onTexto(t) { texto.innerHTML = `<em>${t}</em>`; }

  const local = { verbo: escena.verbs?.[0] || null };

  function disparar(trigger) {
    const interaccion = buscarInteraccion(escena, trigger);
    if (!interaccion) {
      onTexto(escena.defaultText || "No parece que puedas hacer eso ahí.");
      return;
    }
    function reproducirEvento(evento) {
      const sonido = escena.audio?.events?.[evento];
      if (sonido) audioManager?.reproducirPuntual("sfx", moduloIdActivo(), sonido);
    }
    reproducirEvento(interaccion.audioEvent);
    ejecutarInteraccion({
      escenaId, escena, interaccion, onTexto,
      onCustom: consecuencia => {
        updateLayerPresentation();
        reproducirEvento(consecuencia?.audioEvent);
      }
    });
  }

  // Tap directo (móvil): capacidad táctil real, nunca solo user-agent —
  // mismo criterio que src/engine/renderers/raycast.js. En escritorio el
  // flujo de verbos (botón -> zona) sigue intacto y sin cambios.
  const esTactil = (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;

  // De todos los verbos declarados por la escena, ¿cuáles tienen de verdad
  // una interacción válida (respetando flags) para esta zona ahora mismo?
  // Así un tap puede resolver la acción sin obligar a elegir MIRAR primero.
  function verbosDisponiblesPara(zoneId) {
    return (escena.verbs || []).filter(v => buscarInteraccion(escena, { verb: v, zone: zoneId }));
  }

  // CORRECCIÓN (bug de playtest, 2026-08-21 -- "menú de selección
  // tapado"): antes se posicionaba con porcentajes CSS relativos a la
  // zona dentro de #hotspots (inset:0 de .narrativa-fondo) y se montaba
  // COMO HIJO de esa capa. Con una zona de varios verbos (menú alto) y
  // poco alto disponible (típico en móvil horizontal), el menú se salía
  // de la caja de #scenario -- que tiene overflow:hidden -- y quedaba
  // recortado; en el hueco recortado se veía lo que hubiera debajo en
  // el layout de página (#sheet-panel), no un problema de z-index en
  // sí. Se monta ahora en una capa de overlay COMÚN fuera de #scenario
  // (document.body, position:fixed) -- nunca la recorta overflow:hidden
  // ni la tapa nada del layout -- y se posiciona con píxeles reales
  // (getBoundingClientRect(), no porcentajes) con abrazadera al
  // viewport: si no cabe hacia abajo o hacia la derecha, se abre hacia
  // arriba/izquierda en su lugar.
  function menuContextual(hs, zoneId, verbos) {
    if (menuContextualAbierto) { menuContextualAbierto.remove(); menuContextualAbierto = null; }
    const menu = document.createElement("div");
    menu.className = "hotspot-menu";
    verbos.forEach(v => {
      const btn = document.createElement("button");
      btn.className = "hotspot-menu-opcion";
      btn.textContent = v;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        cerrarMenuContextual();
        disparar({ verb: v, zone: zoneId });
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    menuContextualAbierto = menu;

    const hsRect = hs.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margen = 4;
    let top = hsRect.bottom;
    if (top + menuRect.height > window.innerHeight - margen) top = Math.max(margen, hsRect.top - menuRect.height);
    let left = hsRect.left;
    if (left + menuRect.width > window.innerWidth - margen) left = Math.max(margen, window.innerWidth - menuRect.width - margen);
    // Última garantía (independiente de dónde caiga la zona ancla): el
    // menú SIEMPRE cabe entero en el viewport visible, nunca queda
    // recortado -- ver comentario de más arriba.
    top = Math.min(Math.max(top, margen), Math.max(margen, window.innerHeight - menuRect.height - margen));
    left = Math.min(Math.max(left, margen), Math.max(margen, window.innerWidth - menuRect.width - margen));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const cerrar = (e) => { if (!menu.contains(e.target)) cerrarMenuContextual(); };
    setTimeout(() => document.addEventListener("click", cerrar), 0);
    function cerrarMenuContextual() {
      menu.remove();
      if (menuContextualAbierto === menu) menuContextualAbierto = null;
      document.removeEventListener("click", cerrar);
    }
  }
  let menuContextualAbierto = null;

  if (escena.type === "point_click") {
    controlesEl.className = "acciones-bar";
    (escena.verbs || []).forEach(v => {
      const btn = document.createElement("button");
      btn.className = "btn-accion" + (v === local.verbo ? " destacado" : "");
      btn.textContent = v;
      btn.addEventListener("click", () => {
        local.verbo = v;
        controlesEl.querySelectorAll(".btn-accion").forEach(b => b.classList.remove("destacado"));
        btn.classList.add("destacado");
      });
      controlesEl.appendChild(btn);
    });

    (escena.zones || []).forEach(z => {
      const [x, y, w, h] = z.rect;
      const hs = document.createElement("div");
      hs.className = "hotspot";
      hs.style.cssText = `left:${x}%;top:${y}%;width:${w}%;height:${h}%`;
      hs.textContent = z.label;
      hs.addEventListener("click", () => {
        if (esTactil) {
          const verbos = verbosDisponiblesPara(z.id);
          if (verbos.length === 0) return disparar({ verb: local.verbo || escena.verbs?.[0], zone: z.id });
          if (verbos.length === 1) return disparar({ verb: verbos[0], zone: z.id });
          return menuContextual(hs, z.id, verbos);
        }
        if (!local.verbo) return;
        disparar({ verb: local.verbo, zone: z.id });
      });
      hotspotsEl.appendChild(hs);
    });
  } else if (escena.type === "decision") {
    controlesEl.className = "decision-bar";
    (escena.choices || []).forEach(c => {
      const btn = document.createElement("button");
      btn.className = "btn-decision";
      btn.textContent = c.label;
      const interaccion = buscarInteraccion(escena, { choice: c.id });
      if (!interaccion) {
        if (c.hideWhenUnavailable) return;
        btn.setAttribute("disabled", "");
        btn.classList.add("agotado");
        if (c.unavailableLabel) btn.textContent = c.unavailableLabel;
      } else {
        btn.addEventListener("click", () => disparar({ choice: c.id }));
      }
      controlesEl.appendChild(btn);
    });
  } else if (escena.type === "single_roll") {
    controlesEl.className = "acciones-bar";
    (escena.actions || []).forEach(a => {
      const btn = document.createElement("button");
      btn.className = "btn-accion destacado";
      btn.textContent = a.label;
      btn.addEventListener("click", () => {
        // Los overlays de delegación/ayuda/tirada ya impiden una segunda
        // activación mientras se resuelve. No deshabilitar permanentemente:
        // una interacción `oncePerActor` fallida debe quedar disponible para
        // los demás personajes aún elegibles.
        disparar({ action: a.id });
      });
      controlesEl.appendChild(btn);
    });
  }
}
