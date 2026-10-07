import { state, iniciarPartida, cambiarEscena, cargar, hayPartidaGuardada, borrarGuardado } from "../gameState.js";
import { manifiestoActivo, rutaDeManifiesto, rutaAsset } from "../engine/moduleLoader.js";
import { normalizeCharacter, desdeExportFichaAutocalculada } from "../data/adapters/characterImport.js";
import { listarPersonajesImportados, guardarPersonajeImportado, eliminarPersonajeImportado } from "../data/characterVault.js";

const personajesCachePorModulo = new Map();

function escaparHtml(texto) {
  return String(texto ?? "")
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

async function cargarPersonajes() {
  const ruta = rutaDeManifiesto("characters");
  if (personajesCachePorModulo.has(ruta)) return personajesCachePorModulo.get(ruta);
  const res = await fetch(ruta);
  const data = await res.json();
  personajesCachePorModulo.set(ruta, data.pregenerados);
  return data.pregenerados;
}

export function montarMenu(container) {
  const manifest = manifiestoActivo();
  const wrap = document.createElement("div");
  wrap.className = "menu-screen";
  const continuarDisponible = hayPartidaGuardada();
  // Entradas de desarrollo (encargo de calibración, 2026-08-22): campo
  // genérico del module.json, mismo patrón que "theme"/"music" -- este
  // archivo no conoce ningún id de escena por nombre, solo pinta lo que el
  // manifiesto declare. Ningún módulo sin devEntryPoints ve nada distinto.
  const entradasDev = manifest.devEntryPoints || [];
  wrap.innerHTML = `
    <div class="menu-titulo">LA SENDA DE LOS ERRANTES</div>
    <div class="menu-subtitulo">${manifest.title}${manifest.subtitle ? " — " + manifest.subtitle : ""}</div>
    <div class="menu-botones">
      <button class="btn-menu" id="btn-nueva">Nueva partida</button>
      <button class="btn-menu" id="btn-continuar" ${continuarDisponible ? "" : "disabled"}>Continuar partida</button>
      <button class="btn-menu" id="btn-como">Cómo jugar</button>
      <button class="btn-menu" id="btn-creditos">Créditos / prototipo</button>
      <button class="btn-menu" id="btn-borrar" ${continuarDisponible ? "" : "disabled"}>Borrar partida</button>
    </div>
    ${entradasDev.length ? `
    <details class="menu-dev-entradas">
      <summary>Herramientas de desarrollo</summary>
      <div class="menu-dev-lista">
        ${entradasDev.map(e => `<button class="btn-menu btn-menu-dev" data-dev-scene="${e.id}" title="${e.nota || ""}">${e.label}</button>`).join("")}
      </div>
    </details>` : ""}
    <p class="volver-modulos"><a href="#" id="link-cambiar-modulo">&larr; Cambiar de módulo</a></p>
  `;
  container.appendChild(wrap);

  wrap.querySelector("#btn-nueva").addEventListener("click", () => montarSeleccion(container));
  wrap.querySelector("#btn-continuar").addEventListener("click", () => {
    if (cargar()) return; // cargar() ya dispara la navegación a la escena guardada
  });
  wrap.querySelector("#btn-como").addEventListener("click", () => montarComoJugar(container));
  wrap.querySelector("#btn-creditos").addEventListener("click", () => montarCreditos(container));
  wrap.querySelector("#btn-borrar").addEventListener("click", () => {
    borrarGuardado();
    montarMenu(replace(container));
  });
  wrap.querySelector("#link-cambiar-modulo").addEventListener("click", (e) => {
    e.preventDefault();
    cambiarEscena("module_select");
  });
  wrap.querySelectorAll(".btn-menu-dev").forEach(btn => {
    btn.addEventListener("click", async () => {
      // Una entrada de desarrollo debe poder abrirse sin pasar antes por la
      // selección de personaje real -- si no hay ya un personaje activo EN
      // MEMORIA (no solo guardado en disco, para no pisar una partida en
      // curso sin guardar), arranca con el primer pregenerado solo para
      // tener un actor con el que probar la escena.
      if (!state.playerCharacterId) {
        const personajes = await cargarPersonajes();
        iniciarPartida(personajes, personajes[0].id);
      }
      cambiarEscena(btn.dataset.devScene);
    });
  });
}

async function montarSeleccion(container) {
  const pregenerados = await cargarPersonajes();
  const importados = listarPersonajesImportados();
  let personajes = [...pregenerados, ...importados.filter(p => !pregenerados.some(base => base.id === p.id))];
  const permiteImportar = manifiestoActivo().allowImportedCharacters === true;
  const wrap = document.createElement("div");
  wrap.className = "menu-screen";
  wrap.innerHTML = `
    <div class="menu-subtitulo">ELEGIR PERSONAJE</div>
    <p class="seleccion-intro">Elige un agente del módulo o continúa con un personaje importado.</p>
    ${permiteImportar ? `
    <div class="importar-personaje">
      <div class="importar-copy"><strong>Tu biblioteca</strong><span>Importa una ficha JSON. Se conservará en este navegador junto con sus mejoras.</span></div>
      <label class="btn-menu btn-importar" for="input-importar-personaje">Importar JSON</label>
      <input id="input-importar-personaje" type="file" accept="application/json,.json" hidden>
      <p id="estado-importacion" role="status" aria-live="polite"></p>
      <div class="importar-confirmacion" id="confirmar-sustitucion" hidden>
        <span></span>
        <div><button class="btn-menu" id="btn-confirmar-sustitucion" type="button">Sustituir</button><button class="btn-menu" id="btn-cancelar-sustitucion" type="button">Cancelar</button></div>
      </div>
    </div>` : ""}
    <div class="seleccion-grid">
      ${personajes.map(p => `
        <article class="card-pj-wrap">
        <button class="card-pj" type="button" data-id="${escaparHtml(p.id)}" aria-label="Jugar con ${escaparHtml(p.nombre)}">
          <span class="cp-retrato" aria-hidden="true"><span class="cp-retrato-iniciales">${escaparHtml(inicialesDe(p.nombre))}</span>${p.retrato ? `<img src="${escaparHtml(rutaAsset(p.retrato))}" alt="">` : ""}</span>
          <span class="cp-identidad"><span class="cp-nombre">${escaparHtml(p.nombre)}</span>${p.origen === "importado" ? `<span class="cp-origen">Guardado</span>` : ""}</span>
          <span class="cp-rol">${escaparHtml(p.rol)}</span>
          ${p.fortaleza ? `<span class="cp-fortaleza">${escaparHtml(p.fortaleza)}</span>` : ""}
        </button>
        ${p.origen === "importado" ? `<button class="btn-eliminar-pj" type="button" data-delete-id="${escaparHtml(p.id)}" data-delete-name="${escaparHtml(p.nombre)}" aria-label="Eliminar a ${escaparHtml(p.nombre)} de la biblioteca">Eliminar de la biblioteca</button>` : ""}
        </article>`).join("")}
    </div>
    <button class="btn-menu" id="btn-volver" style="width:320px;margin-top:10px">Volver</button>
  `;
  container.innerHTML = "";
  container.appendChild(wrap);

  wrap.querySelectorAll(".cp-retrato img").forEach(img => {
    const retirarImagenRota = () => img.remove();
    img.addEventListener("error", retirarImagenRota, { once: true });
    if (img.complete && img.naturalWidth === 0) retirarImagenRota();
  });

  wrap.querySelectorAll(".card-pj").forEach(card => {
    card.addEventListener("click", () => {
      iniciarPartida(personajes, card.dataset.id);
      cambiarEscena(manifiestoActivo().startScene);
    });
  });
  wrap.querySelectorAll(".btn-eliminar-pj").forEach(btn => {
    btn.addEventListener("click", () => {
      const nombre = btn.dataset.deleteName || "este personaje";
      if (!globalThis.confirm(`¿Eliminar a ${nombre} de la biblioteca? Esta acción no borra una partida ya guardada.`)) return;
      if (!eliminarPersonajeImportado(btn.dataset.deleteId)) {
        estadoImportacion.textContent = "No se pudo eliminar el personaje. Revisa el almacenamiento local.";
        return;
      }
      montarSeleccion(container);
    });
  });
  const inputImportar = wrap.querySelector("#input-importar-personaje");
  const estadoImportacion = wrap.querySelector("#estado-importacion");
  const confirmarSustitucion = wrap.querySelector("#confirmar-sustitucion");
  let importadoPendiente = null;

  function limpiarSustitucion() {
    importadoPendiente = null;
    if (confirmarSustitucion) confirmarSustitucion.hidden = true;
    if (inputImportar) inputImportar.value = "";
  }

  function jugarConImportado(importado) {
    if (!guardarPersonajeImportado(importado)) throw new Error("El navegador no permitió guardar la ficha. Revisa el almacenamiento local e inténtalo de nuevo.");
    personajes = [...personajes.filter(personaje => personaje.id !== importado.id), importado];
    iniciarPartida(personajes, importado.id);
    cambiarEscena(manifiestoActivo().startScene);
  }

  inputImportar?.addEventListener("change", async (event) => {
    const archivo = event.target.files?.[0];
    if (!archivo) return;
    limpiarSustitucion();
    try {
      const importado = normalizarArchivoPersonaje(JSON.parse(await archivo.text()));
      if (pregenerados.some(personaje => personaje.id === importado.id)) {
        throw new Error(`El id "${importado.id}" está reservado por un personaje del módulo. Usa otro id en la ficha.`);
      }
      if (importados.some(personaje => personaje.id === importado.id)) {
        importadoPendiente = importado;
        confirmarSustitucion.querySelector("span").textContent = `Ya existe ${importado.nombre} en la biblioteca. ¿Quieres sustituir su ficha guardada?`;
        confirmarSustitucion.hidden = false;
        estadoImportacion.textContent = "Confirma la sustitución para continuar.";
        return;
      }
      jugarConImportado(importado);
    } catch (error) {
      const detalles = error.detalles?.length ? ` ${error.detalles.join(" ")}` : "";
      estadoImportacion.textContent = `No se pudo importar el personaje: ${error.message}${detalles}`;
      event.target.value = "";
    }
  });
  wrap.querySelector("#btn-confirmar-sustitucion")?.addEventListener("click", () => {
    if (!importadoPendiente) return;
    try {
      jugarConImportado(importadoPendiente);
    } catch (error) {
      estadoImportacion.textContent = `No se pudo sustituir el personaje: ${error.message}`;
      limpiarSustitucion();
    }
  });
  wrap.querySelector("#btn-cancelar-sustitucion")?.addEventListener("click", () => {
    estadoImportacion.textContent = "Sustitución cancelada. La ficha guardada no ha cambiado.";
    limpiarSustitucion();
  });
  wrap.querySelector("#btn-volver").addEventListener("click", () => montarMenu(replace(container)));
}

export function normalizarArchivoPersonaje(datos) {
  if (datos?.form && datos?.state && datos?.version !== undefined) {
    return normalizeCharacter(desdeExportFichaAutocalculada(datos));
  }
  return normalizeCharacter(datos);
}

function montarComoJugar(container) {
  const wrap = document.createElement("div");
  wrap.className = "menu-screen";
  wrap.innerHTML = `
    <div class="menu-subtitulo">CÓMO JUGAR</div>
    <div style="max-width:560px;text-align:left;line-height:1.6;font-size:.9em">
      <p>Cuando una acción es incierta, el juego tira un <strong>d100</strong>: si el resultado
      queda igual o por debajo de tu <strong>Habilidad efectiva</strong>, tienes éxito. Cuanta más
      diferencia, más <strong>éxitos</strong> consigues.</p>
      <p><strong>00, 01, 02</strong> son siempre crítico. <strong>97, 98, 99</strong> son siempre pifia.
      Un crítico o una pifia también pueden hacer que la habilidad usada mejore permanentemente.</p>
      <p>Antes de tirar puedes gastar un <strong>Punto Épico</strong> para sumar +50 a tu Habilidad
      efectiva — resérvalos para el momento que de verdad importa.</p>
      <p>Cuando una acción lo permite, puedes <strong>delegarla</strong> en otro miembro del grupo
      presente en la escena: el juego te muestra su habilidad efectiva antes de elegir.</p>
      <p>Usa los verbos <strong>MIRAR, COGER, USAR, HABLAR, MOVERSE</strong> para interactuar con la
      escena. Cuando aparezcan perseguidores tendrás que elegir entre <strong>HUIR, LUCHAR o
      ESCONDERTE</strong>.</p>
    </div>
    <button class="btn-menu" id="btn-volver" style="width:320px;margin-top:16px">Volver</button>
  `;
  container.innerHTML = "";
  container.appendChild(wrap);
  wrap.querySelector("#btn-volver").addEventListener("click", () => montarMenu(replace(container)));
}

function montarCreditos(container) {
  const manifest = manifiestoActivo();
  const wrap = document.createElement("div");
  wrap.className = "menu-screen";
  wrap.innerHTML = `
    <div class="menu-subtitulo">CRÉDITOS / PROTOTIPO</div>
    <div style="max-width:560px;text-align:left;line-height:1.6;font-size:.9em">
      ${(manifest.credits || []).map(p => `<p>${p}</p>`).join("")}
      <p>Motor de escenas data-driven, común a todos los módulos — ver
      <code>docs/MODULE_ARCHITECTURE.md</code>, <code>docs/SCENE_SCHEMA.md</code> y
      <code>docs/PARTY_SYSTEM.md</code>.</p>
    </div>
    <button class="btn-menu" id="btn-volver" style="width:320px;margin-top:16px">Volver</button>
  `;
  container.innerHTML = "";
  container.appendChild(wrap);
  wrap.querySelector("#btn-volver").addEventListener("click", () => montarMenu(replace(container)));
}

function replace(container) {
  container.innerHTML = "";
  return container;
}
