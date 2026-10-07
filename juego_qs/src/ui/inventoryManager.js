import { state, estadoEquipoDe, establecerEstadoEquipo, referenciaEquipoDe, transferirEquipo } from "../gameState.js";
import { rutaAsset } from "../engine/moduleLoader.js";

let overlayActivo = null;

const SLOT_CONFIG = [
  { id: "armor", label: "Protección" },
  { id: "ranged", label: "Arma principal" },
  { id: "melee", label: "Cuerpo a cuerpo" },
  { id: "uso", label: "Equipo en uso" }
];
const ESTADO_LABEL = { equipado: "Equipado", guardado: "En mochila", en_uso: "En uso" };

function escapar(texto) {
  return String(texto).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function inicialesDe(nombre) {
  const partes = String(nombre ?? "").trim().split(/\s+/).filter(Boolean);
  return (partes.length > 1 ? partes[0][0] + partes.at(-1)[0] : partes[0]?.slice(0, 2) || "PJ").toUpperCase();
}

export function categoriaEquipo(referencia) {
  const categoria = referencia?.split(":", 1)[0];
  return ["armor", "ranged", "melee"].includes(categoria) ? categoria : "gear";
}

function inventarioDetallado(miembroId, miembro) {
  return miembro.inventario.map((item, indice) => ({
    item, indice,
    referencia: referenciaEquipoDe(miembroId, item, indice),
    estado: estadoEquipoDe(miembroId, item, indice),
    instanciaId: miembro.inventarioInstancias?.[indice] ?? `${miembroId}:${indice}`
  }));
}

function itemsDeSlot(items, slotId) {
  if (slotId === "uso") return items.filter(item => item.estado === "en_uso" && categoriaEquipo(item.referencia) === "gear");
  return items.filter(item => item.estado !== "guardado" && categoriaEquipo(item.referencia) === slotId);
}

function renderItemSeleccionable(item, seleccionado, clase = "") {
  return `<button type="button" class="inventario-objeto ${clase} ${seleccionado ? "seleccionado" : ""}" data-instancia="${escapar(item.instanciaId)}" aria-pressed="${seleccionado}">
    <span class="inventario-objeto-nombre">${escapar(item.item)}</span>
    <span class="inventario-objeto-estado">${ESTADO_LABEL[item.estado] ?? escapar(item.estado)}</span>
  </button>`;
}

export function mostrarGestorInventario(miembroInicialId = state.playerCharacterId) {
  overlayActivo?.remove();
  const overlay = document.createElement("div");
  overlay.className = "inventario-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Dotación e inventario del grupo");
  document.body.appendChild(overlay);
  overlayActivo = overlay;
  let miembroId = miembroInicialId;
  let instanciaSeleccionada = null;
  let mensaje = "Selecciona un objeto para equiparlo, guardarlo o transferirlo.";

  const cerrar = () => { overlay.remove(); if (overlayActivo === overlay) overlayActivo = null; };

  function render() {
    const miembros = Object.entries(state.partyMembers).filter(([, miembro]) => miembro.estadoDisponibilidad !== "ausente");
    if (!state.partyMembers[miembroId]) miembroId = miembros[0]?.[0];
    const miembro = state.partyMembers[miembroId];
    const items = miembro ? inventarioDetallado(miembroId, miembro) : [];
    const seleccionado = items.find(item => item.instanciaId === instanciaSeleccionada) ?? null;
    if (!seleccionado) instanciaSeleccionada = null;
    const guardados = items.filter(item => item.estado === "guardado" || (categoriaEquipo(item.referencia) === "gear" && item.estado === "equipado"));
    const retrato = miembro?.base?.retrato ? new URL(rutaAsset(miembro.base.retrato), document.baseURI).href : "";

    overlay.innerHTML = `
      <section class="inventario-panel">
        <header class="inventario-cabecera">
          <div><h2>Dotación del grupo</h2><p>Equipa al personaje y organiza lo que permanece en la mochila.</p></div>
          <button class="inventario-cerrar" type="button" aria-label="Cerrar"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4 4 16"/></svg></button>
        </header>
        <nav class="inventario-miembros" aria-label="Personajes">${miembros.map(([id, m]) => `<button type="button" data-miembro="${escapar(id)}" class="${id === miembroId ? "activo" : ""}" aria-current="${id === miembroId ? "true" : "false"}"><span>${escapar(m.base.nombre)}</span><small>${escapar(m.base.rol)}</small></button>`).join("")}</nav>
        <div class="inventario-estacion">
          <section class="inventario-personaje" aria-label="Dotación de ${escapar(miembro?.base?.nombre ?? "personaje")}">
            <div class="inventario-identidad"><strong>${escapar(miembro?.base?.nombre ?? "")}</strong><span>${escapar(miembro?.base?.rol ?? "")}</span></div>
            <div class="inventario-figura" aria-hidden="true"><span>${escapar(inicialesDe(miembro?.base?.nombre))}</span>${retrato ? `<img src="${escapar(retrato)}" alt="">` : ""}</div>
            <div class="inventario-ranuras">
              ${SLOT_CONFIG.map(slot => {
                const asignados = itemsDeSlot(items, slot.id);
                return `<div class="inventario-ranura inventario-ranura-${slot.id}"><span class="inventario-ranura-label">${slot.label}</span>${asignados.length ? asignados.map(item => renderItemSeleccionable(item, item.instanciaId === instanciaSeleccionada, "en-ranura")).join("") : '<span class="inventario-ranura-vacia">Sin asignar</span>'}</div>`;
              }).join("")}
            </div>
          </section>
          <section class="inventario-mochila" aria-label="Contenido de la mochila">
            <div class="inventario-mochila-titulo"><h3>Mochila</h3><span>${guardados.length} objetos</span></div>
            <div class="inventario-mochila-lista">${guardados.length ? guardados.map(item => renderItemSeleccionable(item, item.instanciaId === instanciaSeleccionada)).join("") : '<p class="inventario-vacio">La mochila está vacía. Los objetos equipados aparecen junto al personaje.</p>'}</div>
          </section>
        </div>
        <section class="inventario-operaciones" aria-label="Operaciones de equipo">
          <div class="inventario-seleccion"><strong>${seleccionado ? escapar(seleccionado.item) : "Ningún objeto seleccionado"}</strong><span class="${seleccionado ? (seleccionado.referencia ? "vinculado" : "no-vinculado") : "instruccion"}">${seleccionado ? (seleccionado.referencia ? "Datos del módulo vinculados" : "Objeto legado · sin efectos de combate") : mensaje}</span></div>
          <div class="inventario-acciones">
            <button type="button" data-accion-estado="equipado" ${seleccionado ? "" : "disabled"}>Equipar</button>
            <button type="button" data-accion-estado="guardado" ${seleccionado ? "" : "disabled"}>Guardar</button>
            <button type="button" data-accion-estado="en_uso" ${seleccionado ? "" : "disabled"}>Usar</button>
          </div>
          <div class="inventario-transferencia"><span>Transferir a</span>${miembros.filter(([id]) => id !== miembroId).map(([id, m]) => `<button type="button" data-transferir-a="${escapar(id)}" ${seleccionado ? "" : "disabled"}>${escapar(m.base.nombre)}</button>`).join("") || '<span class="inventario-sin-companeros">Sin compañeros disponibles</span>'}</div>
          <div class="inventario-anuncio" aria-live="polite">${escapar(mensaje)}</div>
        </section>
      </section>`;

    const imagenRetrato = overlay.querySelector(".inventario-figura img");
    if (imagenRetrato) {
      const retirarImagenRota = () => imagenRetrato.remove();
      imagenRetrato.addEventListener("error", retirarImagenRota, { once: true });
      if (imagenRetrato.complete && imagenRetrato.naturalWidth === 0) retirarImagenRota();
    }

    overlay.querySelector(".inventario-cerrar").addEventListener("click", cerrar);
    overlay.querySelectorAll("[data-miembro]").forEach(btn => btn.addEventListener("click", () => { miembroId = btn.dataset.miembro; instanciaSeleccionada = null; mensaje = `Mostrando la dotación de ${state.partyMembers[miembroId].base.nombre}.`; render(); }));
    overlay.querySelectorAll("[data-instancia]").forEach(btn => btn.addEventListener("click", () => { instanciaSeleccionada = btn.dataset.instancia; mensaje = "Objeto seleccionado."; render(); overlay.querySelector("[data-accion-estado]")?.focus(); }));
    overlay.querySelectorAll("[data-accion-estado]").forEach(btn => btn.addEventListener("click", () => {
      const actual = inventarioDetallado(miembroId, miembro).find(item => item.instanciaId === instanciaSeleccionada);
      if (!actual) return;
      establecerEstadoEquipo(miembroId, actual.item, btn.dataset.accionEstado, actual.indice);
      mensaje = `${actual.item}: ${ESTADO_LABEL[btn.dataset.accionEstado].toLocaleLowerCase("es")}.`;
      render();
    }));
    overlay.querySelectorAll("[data-transferir-a]").forEach(btn => btn.addEventListener("click", () => {
      const actual = inventarioDetallado(miembroId, miembro).find(item => item.instanciaId === instanciaSeleccionada);
      if (!actual) return;
      const destino = btn.dataset.transferirA;
      if (transferirEquipo(miembroId, destino, actual.item, actual.indice)) {
        mensaje = `${actual.item} transferido a ${state.partyMembers[destino].base.nombre}.`;
        instanciaSeleccionada = null;
        render();
      }
    }));
  }

  overlay.addEventListener("pointerdown", event => { if (event.target === overlay) cerrar(); });
  document.addEventListener("keydown", function alTeclado(event) {
    if (!overlay.isConnected) return document.removeEventListener("keydown", alTeclado);
    if (event.key === "Escape") return cerrar();
    if (event.key !== "Tab") return;
    const focos = [...overlay.querySelectorAll("button:not([disabled]), select:not([disabled])")];
    const primero = focos[0], ultimo = focos.at(-1);
    if (event.shiftKey && document.activeElement === primero) { event.preventDefault(); ultimo?.focus(); }
    else if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primero?.focus(); }
  });
  render();
  overlay.querySelector(".inventario-cerrar")?.focus();
}
