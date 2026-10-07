// Nivel 1 del arranque: selector de módulos. Lee modules/modules.json — no
// hardcodea ningún título ni id de módulo concreto. Solo los módulos con
// status "playable" y enabled:true son cargables; el resto se muestra como
// referencia ("coming_soon"/"development"/"disabled") sin intentar
// fetch(module.json) para ellos, porque no tienen por qué existir todavía
// (ver docs/MODULE_ARCHITECTURE.md).
import { cargarListaModulos, cargarModulo } from "../engine/moduleLoader.js";
import { cambiarEscena } from "../gameState.js";

const ETIQUETA_ESTADO = {
  playable: "JUGAR",
  development: "EN DESARROLLO",
  coming_soon: "PRÓXIMAMENTE",
  disabled: "NO DISPONIBLE",
  // Estado genérico (cualquier módulo puede declararlo en modules.json,
  // el motor no conoce ids concretos) para marcar un módulo temporalmente
  // fuera de alcance de una demo sin tocar sus datos ni escenas -- solo
  // afecta al listado, nunca oculta ni borra nada.
  in_review: "EN REVISIÓN"
};

export async function montarSelectorModulos(container) {
  // Título neutro de la zona de juego: en este punto todavía no hay ningún
  // módulo concreto cargado (ni debe nombrarse ninguno).
  if (typeof document !== "undefined") document.title = "La Senda de los Errantes — Zona de juego";
  // La publicación es explícita y `visible:false` permite retirar temporalmente
  // una entrada sin borrar sus datos. Ambas condiciones deben cumplirse.
  const modulos = (await cargarListaModulos())
    .filter(m => m.publishable === true && m.visible !== false);
  const wrap = document.createElement("div");
  wrap.className = "menu-screen";
  wrap.innerHTML = `
    <div class="menu-titulo">LA SENDA DE LOS ERRANTES</div>
    <div class="menu-subtitulo">Registro de expediciones</div>
    <div class="modulos-lista">
      ${modulos.map((m, i) => {
        const jugable = m.enabled && m.status === "playable";
        return `
          <div class="expediente ${jugable ? "jugable" : "bloqueado"}" data-id="${m.id}" data-jugable="${jugable}" ${jugable ? 'tabindex="0" role="button"' : ""}>
            <div class="exp-num">${String(i + 1).padStart(2, "0")}</div>
            <div class="exp-cuerpo">
              <div class="exp-titulo">${m.title}${m.subtitle ? `<span class="exp-subtitulo"> — ${m.subtitle}</span>` : ""}</div>
              ${m.description ? `<div class="exp-desc">${m.description}</div>` : ""}
            </div>
            <div class="exp-estado exp-estado-${m.status}">${ETIQUETA_ESTADO[m.status] || m.status}</div>
          </div>`;
      }).join("")}
    </div>
  `;
  container.appendChild(wrap);

  wrap.querySelectorAll(".expediente.jugable").forEach(card => {
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); }
    });
  });
  wrap.querySelectorAll(".expediente.jugable").forEach(card => {
    card.addEventListener("click", async () => {
      await cargarModulo(card.dataset.id);
      cambiarEscena("menu");
    });
  });
}
