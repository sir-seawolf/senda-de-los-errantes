// Renderer genérico de diálogo ramificado (iteración 5). Un árbol pequeño de
// nodos: cada nodo tiene un `speaker` + `text`, y opcionalmente `choices[]`
// (botones que saltan a otro nodo o aplican una consecuencia) o un `roll`
// (se resuelve con el mismo pipeline que cualquier otra tirada del motor —
// mostrarTirada → dice → progression, con delegación y Ayudar si la
// interacción lo declara — y salta a `onSuccessNext`/`onFailureNext`).
//
// Deliberadamente mínimo (punto 20 del encargo: "no crear un motor de
// diálogo gigante"): sin árboles infinitos. El nodo actual sí se guarda para
// que recargar la página no reinicie una conversación ni reaplique su efecto.
import { cargarEscena, ejecutarInteraccion, aplicarConsecuencias, cumpleRequisitos } from "../sceneEngine.js";
import { obtenerJugador, obtenerProgresoEscena, guardarProgresoEscena, limpiarProgresoEscena } from "../../gameState.js";
import { rutaAsset } from "../moduleLoader.js";

function nombreDeHablante(speaker) {
  if (speaker === "player") return obtenerJugador()?.base?.nombre ?? "Tú";
  return speaker;
}

export async function montarDialogo(container, escenaId) {
  const escena = await cargarEscena(escenaId);
  const wrap = document.createElement("div");
  wrap.className = "narrativa dialogo-wrap";
  const fondoStyle = escena.background ? `background-image:url('${rutaAsset(escena.background)}')` : "";
  wrap.innerHTML = `
    <div class="narrativa-fondo" style="${fondoStyle}"></div>
    <div class="narrativa-hud dialogo-hud">
      <div class="dialogo-caja" id="dialogo-caja"></div>
    </div>
  `;
  container.appendChild(wrap);
  const caja = wrap.querySelector("#dialogo-caja");

  function irANodo(nodoId, { reanudando = false } = {}) {
    const nodo = escena.nodes[nodoId];
    if (!nodo) throw new Error(`Nodo de diálogo inexistente: "${nodoId}" en ${escenaId}`);
    renderNodo(nodoId, nodo, { reanudando });
  }

  function renderNodo(nodoId, nodo, { reanudando = false } = {}) {
    if (nodo.consequence && !reanudando) aplicarConsecuencias(nodo.consequence, "player", { onTexto: () => {} });
    guardarProgresoEscena(escenaId, { nodeId: nodoId });
    caja.innerHTML = `
      <div class="dialogo-hablante">${nombreDeHablante(nodo.speaker)}</div>
      <div class="dialogo-texto">${nodo.text}</div>
      <div class="dialogo-opciones" id="dialogo-opciones"></div>
    `;
    const opcionesEl = caja.querySelector("#dialogo-opciones");

    if (nodo.roll) {
      const btn = document.createElement("button");
      btn.className = "btn-accion destacado";
      btn.textContent = nodo.rollLabel || "Continuar";
      btn.addEventListener("click", () => {
        btn.disabled = true;
        ejecutarInteraccion({
          escenaId,
          escena,
          interaccion: {
            executors: nodo.executors,
            delegationTitle: nodo.delegationTitle,
            roll: nodo.roll,
            onSuccess: { ...(nodo.onSuccessConsequence || {}), _next: nodo.onSuccessNext },
            onFailure: { ...(nodo.onFailureConsequence || {}), _next: nodo.onFailureNext }
          },
          onTexto: (t) => { caja.querySelector(".dialogo-texto").innerHTML += `<br><em>${t}</em>`; },
          onCustom: (consecuencia) => {
            if (consecuencia._next) setTimeout(() => irANodo(consecuencia._next), consecuencia.text ? 900 : 0);
            else if (consecuencia.transition) limpiarProgresoEscena(escenaId);
          }
        });
      });
      opcionesEl.appendChild(btn);
      return;
    }

    (nodo.choices || []).filter(cumpleRequisitos).forEach(c => {
      const btn = document.createElement("button");
      btn.className = "dialogo-opcion";
      btn.textContent = c.label;
      btn.addEventListener("click", () => {
        if (c.next) return irANodo(c.next);
        if (c.consequence) {
          if (c.consequence.transition) limpiarProgresoEscena(escenaId);
          aplicarConsecuencias(c.consequence, "player", { onTexto: () => {} });
        }
      });
      opcionesEl.appendChild(btn);
    });
  }

  const guardado = obtenerProgresoEscena(escenaId);
  const nodeId = guardado?.nodeId && escena.nodes[guardado.nodeId] ? guardado.nodeId : escena.startNode;
  irANodo(nodeId, { reanudando: nodeId !== escena.startNode || guardado?.nodeId === escena.startNode });
}
