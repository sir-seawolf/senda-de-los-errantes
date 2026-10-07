import { state } from "../gameState.js";

// Historial de tiradas: pensado para debugging y como base de futuras
// herramientas de Director de Juego. No se muestra siempre — se abre bajo demanda
// desde el botón "Historial de tiradas" de la ficha lateral.
export function mostrarHistorial() {
  const overlay = document.createElement("div");
  overlay.className = "roll-overlay";
  const filas = state.historialTiradas.slice(-100).reverse().map(t => `
    <tr>
      <td>${t.orden}</td>
      <td>${t.escena ?? "—"}</td>
      <td>${t.actorNombre ?? t.actorId}</td>
      <td>${t.etiqueta ?? t.skillId ?? "—"}</td>
      <td>${t.habilidadEfectiva}</td>
      <td>${String(t.d100).padStart(2, "0")}</td>
      <td>${t.exitos}</td>
      <td>${t.puntoEpicoGastado ? "Sí (+50)" : "—"}</td>
      <td>${t.critico ? "Sí" : ""}</td>
      <td>${t.pifia ? "Sí" : ""}</td>
      <td>${t.progreso ?? ""}</td>
    </tr>`).join("");

  overlay.innerHTML = `
    <div class="log-card">
      <div class="roll-header">Historial de tiradas (${state.historialTiradas.length})</div>
      <div class="log-scroll">
        <table class="log-table">
          <thead><tr>
            <th>#</th><th>Escena</th><th>Actor</th><th>Habilidad</th><th>Efectiva</th>
            <th>d100</th><th>Éxitos</th><th>P. Épico</th><th>Crít.</th><th>Pifia</th><th>Progreso</th>
          </tr></thead>
          <tbody>${filas || `<tr><td colspan="11">Sin tiradas todavía.</td></tr>`}</tbody>
        </table>
      </div>
      <button class="btn-continuar" id="log-cerrar" style="margin-top:12px;align-self:flex-end">Cerrar</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#log-cerrar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}
