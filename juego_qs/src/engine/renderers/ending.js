import { state, cambiarEscena, cerrarPartidaDefinitiva, obtenerJugador, nivelHeridaDe } from "../../gameState.js";
import { cargarEscena } from "../sceneEngine.js";

// Renderer genérico de finales: la escena JSON define un mapa `endings` de
// clave -> { titulo, texto, definitivo?, continuacion? }. La clave activa es
// `state.finalTipo`, fijada por la escena que llevó hasta aquí (combate,
// persecución, esconderse...).
//
// Presentación (Iteración 7.2): "expediente cerrado", no una card genérica
// con botón. Todos los datos de cierre (personaje, vida, Puntos Épicos,
// pistas, decisiones) ya existían en gameState — no se inventa ninguno; si
// un dato no aplica (p.ej. sin jugador activo) su línea simplemente no se
// pinta. Nada aquí conoce el módulo activo por nombre.
//
// `definitivo`/`continuacion` (encargo de cierre vertical, 2026-08-22 --
// Hallazgo 5 del playtest real, "huir del callejón se presenta como final
// falso"): antes CUALQUIER clave de `endings` borraba la partida entera al
// pulsar el único botón disponible -- correcto para una muerte real, pero
// "vehiculo"/"refugio"/"casi_muerto" y los "checkpoint_*" nunca fueron
// finales de personaje (su propio texto ya decía "la aventura sigue" /
// "queda para la próxima vez"), así que huir con éxito borraba pistas,
// heridas, recursos y decisiones igual que morir. Genérico y declarativo,
// sin que este archivo conozca ningún nombre de escena ni de módulo:
//   - `definitivo` ausente o `true` -> comportamiento SIN CAMBIOS (cierre
//     real, borra la partida). Es el default -- cualquier ending que no
//     declare lo contrario sigue siendo tan definitivo como antes.
//   - `definitivo:false` + `continuacion:"<sceneId>"` -> la historia
//     continúa de verdad: transición perceptible + cambiarEscena(destino),
//     SIN borrar nada.
//   - `definitivo:false` sin `continuacion` -> límite real de contenido
//     todavía no desarrollado (los "checkpoint_*"): pantalla "Continuará",
//     vuelve al menú SIN borrar la partida (se puede retomar).
// Decisión PURA (sin DOM, testeable en Node) de cómo tratar un final --
// separada de montarFinal() para poder probar la regla sin necesitar
// `document` (encargo: "prueba de integración... no llamando directamente
// al resultado final" -- aquí se prueba la DECISIÓN completa, no solo un
// booleano aislado).
export function resolverTratamientoFinal(escena, finalTipo) {
  const clave = finalTipo || escena.defaultEnding;
  const final = escena.endings[clave] || escena.endings[escena.defaultEnding];
  const esDefinitivo = final.definitivo !== false;
  const eyebrow = esDefinitivo ? "Expediente cerrado" : (final.continuacion ? "La historia continúa" : "Continuará");
  const textoBoton = esDefinitivo ? "Volver al menú" : (final.continuacion ? "Continuar" : "Volver al menú");
  // Destino real al pulsar el botón: una huida/checkpoint navega hacia
  // `continuacion` (o al menú si no hay ninguna, límite de contenido);
  // un final definitivo siempre vuelve al menú tras borrar la partida.
  const destino = esDefinitivo ? "menu" : (final.continuacion || "menu");
  return { final, esDefinitivo, eyebrow, textoBoton, destino };
}

export async function montarFinal(container, escenaId) {
  const escena = await cargarEscena(escenaId);
  const { final, esDefinitivo, eyebrow, textoBoton, destino } = resolverTratamientoFinal(escena, state.finalTipo);

  const jugador = obtenerJugador();
  const NIVEL_ETIQUETA = { sano: "Sano", herido: "Herido", tullido: "Tullido" };

  const wrap = document.createElement("div");
  wrap.className = "final-screen";
  wrap.innerHTML = `
    <div class="final-expediente">
      <div class="final-eyebrow">${eyebrow}</div>
      <div class="final-titulo">${final.titulo}</div>
      <div class="final-texto"><em>${final.texto}</em></div>
      <div class="final-datos">
        ${jugador ? `<div class="final-dato"><span>Personaje</span><strong>${jugador.base.nombre} — ${NIVEL_ETIQUETA[nivelHeridaDe(jugador)] || "Sano"}</strong></div>` : ""}
        ${jugador ? `<div class="final-dato"><span>Puntos Épicos restantes</span><strong>${jugador.puntosEpicosActuales} / ${jugador.base.puntosEpicos}</strong></div>` : ""}
        <div class="final-dato"><span>Pistas descubiertas</span><strong>${state.pistasDescubiertas.length ? state.pistasDescubiertas.length : "ninguna"}</strong></div>
        <div class="final-dato"><span>Decisiones tomadas</span><strong>${state.decisiones.length ? state.decisiones.join(" · ") : "ninguna registrada"}</strong></div>
      </div>
      <button class="btn-cerrar-expediente" id="btn-menu-final">${textoBoton}</button>
    </div>
  `;
  container.appendChild(wrap);

  wrap.querySelector("#btn-menu-final").addEventListener("click", () => {
    state.finalTipo = null;
    if (esDefinitivo) {
      cerrarPartidaDefinitiva(destino);
      return;
    }
    // La aventura sigue: nunca se borra la partida ni se vacía el party
    // por una huida, una conversación o un límite de contenido pendiente.
    cambiarEscena(destino);
  });
}
