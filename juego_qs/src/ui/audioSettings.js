// Configuración global: audio por buses y preferencia de ficha. Vive fuera
// de #scenario para que abrirla o cambiar una preferencia no remonte escenas.
const CONTROLES_BUS = [
  { bus: "music", etiqueta: "MÚSICA" },
  { bus: "ambience", etiqueta: "AMBIENTE" },
  { bus: "sfx", etiqueta: "EFECTOS" },
  { bus: "ui", etiqueta: "INTERFAZ" }
];

export function montarAjustesAudio(panel, toggleBtn, audioManager) {
  const prefs = audioManager.obtenerPreferencias();
  const uiSettingsPromise = import("./uiSettings.js");

  const filasAudio = CONTROLES_BUS.map(({ bus, etiqueta }) => {
    const pref = prefs.buses[bus];
    return `
      <div class="ajustes-fila ajustes-fila-bus">
        <span class="ajustes-etiqueta">${etiqueta}</span>
        <button type="button" class="ajustes-onoff" id="ajustes-${bus}-onoff"
          data-audio-bus="${bus}" aria-pressed="${pref.enabled}">${pref.enabled ? "ON" : "OFF"}</button>
        <input type="range" id="ajustes-${bus}-volumen" data-audio-volume="${bus}"
          min="0" max="100" step="1" value="${Math.round(pref.volume * 100)}"
          aria-label="Volumen de ${etiqueta.toLowerCase()}">
      </div>
    `;
  }).join("");

  panel.innerHTML = `
    <div class="ajustes-caja" role="dialog" aria-modal="true" aria-label="Configuración">
      ${filasAudio}
      <div class="ajustes-fila">
        <span class="ajustes-etiqueta">FICHA POR DEFECTO</span>
        <button type="button" class="ajustes-onoff" id="ajustes-ficha-defecto" aria-pressed="false">EXPANDIDA</button>
      </div>
      <button type="button" class="ajustes-cerrar" id="ajustes-cerrar">CERRAR</button>
    </div>
  `;
  panel.hidden = true;

  const btnCerrar = panel.querySelector("#ajustes-cerrar");
  const btnFicha = panel.querySelector("#ajustes-ficha-defecto");

  panel.querySelectorAll("[data-audio-bus]").forEach((boton) => {
    boton.addEventListener("click", () => {
      const bus = boton.dataset.audioBus;
      const nuevoEstado = boton.getAttribute("aria-pressed") !== "true";
      audioManager.establecerMuteBus(bus, !nuevoEstado);
      boton.setAttribute("aria-pressed", String(nuevoEstado));
      boton.textContent = nuevoEstado ? "ON" : "OFF";
    });
  });

  panel.querySelectorAll("[data-audio-volume]").forEach((slider) => {
    slider.addEventListener("input", () => {
      audioManager.establecerVolumenBus(slider.dataset.audioVolume, Number(slider.value) / 100);
    });
  });

  uiSettingsPromise.then(({ fichaColapsada }) => {
    const colapsada = fichaColapsada();
    btnFicha.setAttribute("aria-pressed", String(colapsada));
    btnFicha.textContent = colapsada ? "COLAPSADA" : "EXPANDIDA";
  });
  btnFicha.addEventListener("click", async () => {
    const { fichaColapsada, establecerFichaColapsada } = await uiSettingsPromise;
    const nuevoColapsada = !fichaColapsada();
    establecerFichaColapsada(nuevoColapsada);
    btnFicha.setAttribute("aria-pressed", String(nuevoColapsada));
    btnFicha.textContent = nuevoColapsada ? "COLAPSADA" : "EXPANDIDA";
    const { actualizar } = await import("../gameState.js");
    actualizar();
  });

  let origenFoco = null;

  function controlesEnPanel() {
    return [...panel.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((control) => !control.disabled && !control.hidden);
  }

  function abrir() {
    origenFoco = document.activeElement;
    panel.hidden = false;
    toggleBtn.setAttribute("aria-expanded", "true");
    controlesEnPanel()[0]?.focus();
  }

  function cerrar() {
    panel.hidden = true;
    toggleBtn.setAttribute("aria-expanded", "false");
    const destino = origenFoco?.isConnected ? origenFoco : toggleBtn;
    origenFoco = null;
    destino.focus();
  }

  toggleBtn.setAttribute("aria-expanded", "false");
  toggleBtn.addEventListener("click", () => { panel.hidden ? abrir() : cerrar(); });
  btnCerrar.addEventListener("click", cerrar);
  panel.addEventListener("click", (e) => { if (e.target === panel) cerrar(); });
  document.addEventListener("keydown", (e) => {
    if (panel.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar();
      return;
    }
    if (e.key !== "Tab") return;
    const controles = controlesEnPanel();
    if (!controles.length) return;
    const primero = controles[0];
    const ultimo = controles.at(-1);
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  });
}
