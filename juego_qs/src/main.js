import { state, suscribirEscena, suscribirFicha, migrarGuardadoAntiguoSiExiste, cambiarEscena, iniciarPartida } from "./gameState.js";
import { renderFicha } from "./ui/sheet.js";
import { montarMenu } from "./scenes/menu.js";
import { montarSelectorModulos } from "./scenes/moduleMenu.js";
import { montarEscenaPorId } from "./engine/renderers/index.js";
import { cargarEscena } from "./engine/sceneEngine.js";
import { aplicarAccesibilidad, config } from "./config.js";
import { audioManager } from "./engine/audioManager.js";
import { montarAjustesAudio } from "./ui/audioSettings.js";
import { cargarListaModulos, cargarModulo, moduloIdActivo, manifiestoActivo, rutaDeManifiesto } from "./engine/moduleLoader.js";
import { resolverModuloRevision, resolverEscenaRevision } from "./engine/moduleReview.js";

const appEl = document.getElementById("app");
const scenario = document.getElementById("scenario");
const sheetPanel = document.getElementById("sheet-panel");
const configPanel = document.getElementById("config-panel");
const configToggle = document.getElementById("config-toggle");
const gameModulo = document.getElementById("game-modulo");
const gameEscena = document.getElementById("game-escena");

function actualizarCabecera(tituloEscena = null) {
  const manifiesto = manifiestoActivo();
  gameModulo.textContent = manifiesto?.title || "ARCHIVO DE MÓDULOS";
  gameEscena.textContent = tituloEscena || (state.escena === "menu" ? "CENTRO DE MISIÓN" : "SELECCIÓN");
}

aplicarAccesibilidad();
migrarGuardadoAntiguoSiExiste(); // ver docs/SAVE_MIGRATION.md — no-op si no hay nada que migrar

// Audio (Iteración Audio): se inicializa siempre, pero no suena nada hasta
// desbloquear() — el primer gesto real del usuario en ESTE documento (los
// gestos de una página anterior, p.ej. el gateway en juego.html, no
// desbloquean el autoplay de un documento nuevo tras una navegación
// completa; ver docs/AUDIO_SYSTEM.md). Un solo listener, una sola vez.
if (audioManager) {
  audioManager.inicializar();
  function primerGestoDesbloqueaAudio() {
    audioManager.desbloquear();
    document.removeEventListener("pointerdown", primerGestoDesbloqueaAudio);
    document.removeEventListener("keydown", primerGestoDesbloqueaAudio);
  }
  document.addEventListener("pointerdown", primerGestoDesbloqueaAudio, { once: true });
  document.addEventListener("keydown", primerGestoDesbloqueaAudio, { once: true });
  document.addEventListener("visibilitychange", () => audioManager.alCambiarVisibilidad(document.hidden));
  if (configPanel && configToggle) montarAjustesAudio(configPanel, configToggle, audioManager);
}

let renderToken = 0;
let sheetContextActual = null; // qué contexto de ficha pinta la escena montada ahora mismo
// "docked" (columna fija, comportamiento de siempre) | "overlay" (cajón
// superpuesto, sin reservar ancho -- piloto de Localización C, ver
// docs/CONTRATO_VISUAL_PREDATOR.md). Campo genérico de la escena
// (escena.sheetLayout), mismo patrón que "theme"/"music": este archivo no
// conoce ningún tipo de escena por nombre, solo lee el campo si existe.
let sheetLayoutActual = "docked";

// Remonta #scenario por completo. SOLO se llama en navegación real (cambio de
// escena) — ver el comentario en gameState.js sobre por qué existen dos
// canales de notificación separados.
async function renderEscena() {
  const miToken = ++renderToken;
  scenario.innerHTML = "";
  if (config.visualEffects.sceneFade) {
    scenario.classList.remove("fundiendo");
    void scenario.offsetWidth;
    scenario.classList.add("fundiendo");
  }

  if (state.escena === "module_select") {
    actualizarCabecera("SELECCIÓN");
    montarSelectorModulos(scenario);
    sheetContextActual = null;
    sheetLayoutActual = "docked";
    appEl.classList.remove("ficha-superpuesta");
    sheetPanel.innerHTML = "";
    audioManager?.detenerAmbiente();
    audioManager?.reproducirEstado(null, "menu"); // "menu" global = senda_game_zone.mp3, ver src/data/audio/audioConfig.json
    return;
  }

  if (state.escena === "menu") {
    actualizarCabecera("CENTRO DE MISIÓN");
    montarMenu(scenario);
    sheetContextActual = null;
    sheetLayoutActual = "docked";
    appEl.classList.remove("ficha-superpuesta");
    sheetPanel.innerHTML = "";
    audioManager?.detenerAmbiente();
    audioManager?.reproducirEstado(moduloIdActivo(), "exploration"); // menú del módulo ya es "entrar" al módulo (punto 15) — state.moduloId todavía no existe aquí, solo se rellena en iniciarPartida()
    return;
  }

  // CORRECCIÓN (encargo de cierre vertical, 2026-08-22 -- Hallazgo 7 del
  // playtest real, "ausencia de transición perceptible entre escenas"):
  // entre borrar #scenario y que cargarEscena()/montarEscenaPorId()
  // resuelvan (fetch de red + montaje) la pantalla quedaba en blanco sin
  // ninguna señal -- indistinguible de una app bloqueada si la carga
  // tardaba o fallaba. El fundido de arriba ya cubre el caso normal
  // (rápido); esto cubre el hueco real: un indicador breve mientras se
  // espera, y una pantalla de error RECUPERABLE (reintentar o volver al
  // menú) si algo falla, en vez de dejar la pantalla vacía para siempre.
  mostrarCargandoEscena(scenario);
  let escena;
  try {
    escena = await cargarEscena(state.escena);
    if (miToken !== renderToken) return; // el estado cambió mientras cargábamos
    // El indicador de carga vive SOLO durante este await -- los
    // renderers de escena (narrative.js, combat.js...) montan con
    // `container.appendChild()`, no limpian el contenedor por su
    // cuenta, así que hay que retirarlo antes de que monten o quedaría
    // pegado permanentemente junto al contenido real.
    scenario.innerHTML = "";
    // Los renderers de larga duración (combate táctico, persecución) no
    // resuelven su promesa hasta que termina la escena. La cabecera debe
    // identificar la escena al entrar, no cuando el jugador ya ha salido.
    actualizarCabecera(escena.title || state.escena.replaceAll("_", " "));
    await montarEscenaPorId(scenario, state.escena);
  } catch (e) {
    if (miToken !== renderToken) return;
    mostrarErrorCargaEscena(scenario, e);
    return;
  }
  if (miToken !== renderToken) return;

  // Música por ESTADO musical de la escena, no por su id (punto 10): si la
  // escena no declara "musicState", se deja sonando lo que ya sonaba — no
  // se asume silencio ni se reinicia nada.
  if (escena.musicState) audioManager?.reproducirEstado(moduloIdActivo(), escena.musicState);
  const ambienceId = Array.isArray(escena.audio?.ambience)
    ? escena.audio.ambience[0]
    : escena.audio?.ambience;
  if (ambienceId) audioManager?.reproducirAmbiente(moduloIdActivo(), ambienceId);
  else audioManager?.detenerAmbiente();

  sheetContextActual = escena.sheetContext || null;
  sheetLayoutActual = escena.sheetLayout === "overlay" ? "overlay" : "docked";
  appEl.classList.toggle("ficha-superpuesta", sheetLayoutActual === "overlay");
  renderFichaSiProcede();
}

// Refresca SOLO la ficha lateral (inventario, vida, PE, progreso...) sin tocar
// la escena en curso — así un combate o una persecución con su propio bucle
// de animación no se reinicia cada vez que cambia un flag o se coge un objeto.
function renderFichaSiProcede() {
  if (sheetContextActual && state.playerCharacterId) {
    renderFicha(sheetPanel, sheetContextActual, sheetLayoutActual);
  } else {
    sheetPanel.innerHTML = "";
  }
}

// Indicador breve de carga (Hallazgo 7): confirma que la orden de
// cambiar de escena SÍ se ha recibido mientras se espera la red/el
// montaje. Deliberadamente mínimo -- misma tipografía/paleta del resto
// del motor (theme.css), ninguna dependencia nueva.
function mostrarCargandoEscena(container) {
  const div = document.createElement("div");
  div.className = "escena-cargando";
  div.textContent = "Cargando…";
  container.appendChild(div);
}

// Pantalla de error RECUPERABLE (Hallazgo 7): si cargarEscena() o
// montarEscenaPorId() lanzan (red caída, JSON roto, renderer no
// disponible...), antes la pantalla quedaba en blanco para siempre,
// indistinguible de una aplicación bloqueada. Ahora se explica el
// fallo y se ofrecen dos salidas reales -- nunca deja al jugador sin
// ninguna acción posible.
function mostrarErrorCargaEscena(container, error) {
  console.error("[renderEscena] fallo al cargar/montar la escena:", error);
  const div = document.createElement("div");
  div.className = "escena-error";
  div.innerHTML = `
    <div class="escena-error-titulo">No se ha podido cargar esta escena</div>
    <div class="escena-error-detalle">${error?.message ? String(error.message).slice(0, 200) : "Error desconocido."}</div>
    <div class="escena-error-botones">
      <button type="button" id="escena-error-reintentar">Reintentar</button>
      <button type="button" id="escena-error-menu">Volver al menú</button>
    </div>
  `;
  container.appendChild(div);
  div.querySelector("#escena-error-reintentar").addEventListener("click", () => renderEscena());
  div.querySelector("#escena-error-menu").addEventListener("click", () => cambiarEscena("menu"));
}

suscribirEscena(renderEscena);
suscribirFicha(renderFichaSiProcede);

async function iniciarAplicacion() {
  try {
    const registro = await cargarListaModulos();
    const moduleIdRevision = resolverModuloRevision(window.location.search, registro);
    if (moduleIdRevision) {
      await cargarModulo(moduleIdRevision);
      const escenaDirecta = resolverEscenaRevision(window.location.search, manifiestoActivo());
      if (escenaDirecta) {
        const response = await fetch(rutaDeManifiesto("characters"));
        if (!response.ok) throw new Error(`No se pudieron cargar los personajes (${response.status}).`);
        const personajes = (await response.json()).pregenerados;
        if (!personajes?.length) throw new Error("El módulo no declara personajes para la revisión directa.");
        iniciarPartida(personajes, personajes[0].id);
        cambiarEscena(escenaDirecta);
        return;
      }
      cambiarEscena("menu");
      return;
    }
  } catch (error) {
    // Un enlace de revisión roto o una red temporalmente caída no debe dejar
    // la aplicación en blanco: el selector conserva su recuperación normal.
    console.warn("[arranque] no se pudo abrir el módulo solicitado:", error);
  }
  renderEscena();
}

iniciarAplicacion();
