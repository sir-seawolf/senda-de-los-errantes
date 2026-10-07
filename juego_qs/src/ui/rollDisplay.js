import { rollD100, interpretarTirada, localizacionPorUnidad } from "../rules/dice.js";
import { evaluarProgreso, aplicarProgreso } from "../rules/progression.js";
import { penalizadorPorNivel } from "../rules/woundPenalty.js";
import { obtenerMiembro, gastarPuntoEpico, registrarTirada, nivelHeridaDe } from "../gameState.js";

// Muestra una tirada de forma visible y comprensible: quién tira, con qué
// habilidad, dificultad, animación d100, resultado — y si procede, progreso.
//
// Único punto central del pipeline de Habilidad efectiva:
//   base + dificultad (de la escena) + penalización por herida (automática,
//   según el nivel de vida ACTUAL del actor) + Punto Épico (opcional) = efectiva.
// Ninguna escena tiene que acordarse de restar la penalización por herida:
// se calcula aquí siempre, a partir del estado real del actor que tira.
//
// Flujo interno (fuente única de verdad, ver src/rules/dice.js):
//   1. se tira el d100 UNA vez (rollD100), al terminar la animación;
//   2. se interpreta contra la Habilidad efectiva ACTUAL (interpretarTirada);
//   3. si el jugador gasta un Punto Épico — antes o después de ver el
//      resultado — se vuelve a interpretar la MISMA tirada contra la nueva
//      Habilidad efectiva (nunca se vuelve a tirar el dado);
//   4. crítico/pifia se recalculan como parte de esa misma interpretación,
//      nunca por separado — para un mismo par (tirada, habilidadEfectiva)
//      el veredicto es siempre el mismo, sin importar cuántas veces se
//      recalcule;
//   5. la progresión de habilidad y el registro en el historial se aplican
//      UNA SOLA VEZ, al pulsar "Continuar", sobre el resultado definitivo
//      en ese momento — nunca antes, nunca dos veces.
//
// opts:
//   actorId          id del miembro del grupo que tira ("player" o id de characters.json)
//   etiquetaHabilidad texto descriptivo ("Diagnóstico — examinar el cuerpo")
//   skillId           clave dentro de habilidades{} del actor (para poder progresar)
//   habilidadBase     valor numérico ya resuelto (categoría+concreta) del actor
//   dificultad/dificultadTexto
//   permitirPuntoEpico
//   escenaId          para el historial de tiradas
//   onResuelto(resultado)  resultado trae además actorId, skillId y progreso (o null)
export function mostrarTirada({ actorId = "player", actorNombre, etiquetaHabilidad, skillId, habilidadBase, dificultad = 0, dificultadTexto = "Normal", permitirPuntoEpico = true, escenaId = null, onResuelto }) {
  const actor = obtenerMiembro(actorId);
  const nombreActor = actorNombre || actor?.base?.nombre || "Personaje";
  const nivel = actor ? nivelHeridaDe(actor) : "sano";
  const penalizacionHerida = penalizadorPorNivel(nivel);
  const dificultadTotal = dificultad + penalizacionHerida;

  const overlay = document.createElement("div");
  overlay.className = "roll-overlay";

  const permitido = permitirPuntoEpico && actor && actor.puntosEpicosActuales > 0;

  overlay.innerHTML = `
    <div class="roll-card">
      <div class="roll-quien"><span class="roll-actor">${nombreActor}</span><span class="roll-habilidad">${etiquetaHabilidad}</span></div>
      <div class="roll-efectiva-cifra"><strong id="rl-efectiva">${habilidadBase + dificultadTotal}</strong><span>efectiva</span></div>
      ${permitido ? `<button id="rl-pe" class="btn-epico">Gastar Punto Épico de ${nombreActor} <span>+50 · quedan ${actor.puntosEpicosActuales}</span></button>` : ""}
      <div class="roll-dado" id="rl-dice">··</div>
      <div class="roll-result" id="rl-result"></div>
      <details class="roll-detalles">
        <summary>Detalles</summary>
        <div class="roll-line"><span>Habilidad base</span><strong>${habilidadBase}</strong></div>
        <div class="roll-line"><span>Dificultad (${dificultadTexto})</span><strong>${dificultad >= 0 ? "+" : ""}${dificultad}</strong></div>
        ${penalizacionHerida ? `<div class="roll-line res-herida"><span>Herida (${nivel})</span><strong>${penalizacionHerida}</strong></div>` : ""}
      </details>
      <button id="rl-continuar" class="btn-continuar" hidden>Continuar</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Estado local de este visor — nunca se duplica en otro sitio:
  //   peGastado    si ya se gastó el Punto Épico de este actor en esta tirada
  //   tiradaFija   el d100 ya salido (null mientras dura la animación) —
  //                gastar el PE después NUNCA cambia este número, solo la
  //                habilidad efectiva contra la que se interpreta
  //   resultadoActual  última interpretación calculada (lo que consume
  //                    "Continuar" para progresión/registro/onResuelto)
  let peGastado = false;
  let tiradaFija = null;
  let resultadoActual = null;

  const habilidadEfectivaActual = () => habilidadBase + dificultadTotal + (peGastado ? 50 : 0);

  const efectivaEl = overlay.querySelector("#rl-efectiva");
  const peBtn = overlay.querySelector("#rl-pe");
  const diceEl = overlay.querySelector("#rl-dice");
  const resultEl = overlay.querySelector("#rl-result");
  const continuarBtn = overlay.querySelector("#rl-continuar");

  // Recalcula el veredicto sobre la MISMA tirada fija con la habilidad
  // efectiva actual, y repinta el bloque de resultado entero — nunca solo
  // el número de "Efectiva" suelto, que es justo el bug que esto corrige.
  function recalcularYPintar() {
    if (tiradaFija === null) return; // el dado todavía está animándose
    const interpretacion = interpretarTirada({ tirada: tiradaFija, habilidadEfectiva: habilidadEfectivaActual() });
    resultadoActual = { habilidadBase, dificultad: dificultadTotal, puntoEpicoGastado: peGastado, ...interpretacion };
    pintarResultado(resultadoActual);
  }

  if (peBtn) {
    peBtn.addEventListener("click", () => {
      if (peGastado) return;
      if (!gastarPuntoEpico(actorId)) return;
      peGastado = true;
      peBtn.disabled = true;
      peBtn.textContent = "Punto Épico gastado (+50)";
      efectivaEl.textContent = habilidadEfectivaActual();
      recalcularYPintar(); // recalcula éxito/fallo/éxitos/crítico/pifia, no solo el número
    });
  }

  setTimeout(() => {
    let frames = 0;
    const anim = setInterval(() => {
      diceEl.textContent = String(Math.floor(Math.random() * 100)).padStart(2, "0");
      frames++;
      if (frames > 10) {
        clearInterval(anim);
        tiradaFija = rollD100();
        diceEl.textContent = String(tiradaFija).padStart(2, "0");
        recalcularYPintar();
      }
    }, 60);
  }, 250);

  function pintarResultado(resultado) {
    let clase = resultado.exito ? "res-exito" : "res-fallo";
    let titulo = resultado.exito ? "ÉXITO" : "FALLO";
    if (resultado.esCritico) { clase = "res-critico"; titulo = "CRÍTICO"; }
    if (resultado.esPifia) { clase = "res-pifia"; titulo = "PIFIA"; }

    const loc = localizacionPorUnidad(resultado.tirada);

    // Vista previa de progreso, sin aplicarlo todavía: evaluarProgreso() no
    // muta nada (a diferencia de aplicarProgreso(), que solo se llama una
    // vez, al pulsar "Continuar", sobre el resultado ya definitivo). Si el
    // jugador gasta el PE después y eso cambia si hay crítico/pifia, esta
    // vista previa se recalcula igual que el resto del resultado.
    const previaProgreso = (actor && skillId) ? evaluarProgreso(resultado) : null;

    // Vínculo visual con el Punto Épico (§7): el mismo dato que ya viaja en
    // el resultado (puntoEpicoGastado) añade una clase propia y sobria —
    // nunca el glitch del gateway, que está reservado al Mosaico/anomalía.
    resultEl.className = `roll-result ${clase}${resultado.puntoEpicoGastado ? " roll-result-pe" : ""}`;
    resultEl.innerHTML = `
      <div class="res-titulo">${titulo} — ${resultado.exitos >= 0 ? resultado.exitos + " éxito" + (resultado.exitos === 1 ? "" : "s") : resultado.exitos + " (fallo)"}</div>
      <div class="res-sub">Localización si aplica: ${loc}</div>
      ${previaProgreso ? `<div class="res-progreso">${nombreActor} mejorará ${skillId} (+${previaProgreso.incremento})</div>` : ""}
    `;
    continuarBtn.hidden = false;
  }

  // La progresión y el registro en el historial se enganchan UNA sola vez,
  // fuera de pintarResultado()/recalcularYPintar() (que pueden llamarse
  // varias veces si se gasta el PE) — así nunca se aplican dos veces ni
  // sobre un resultado que todavía podía cambiar.
  continuarBtn.addEventListener("click", () => {
    overlay.remove();
    const progreso = (actor && skillId) ? aplicarProgreso(actor, skillId, resultadoActual) : null;
    const resultadoFinal = { ...resultadoActual, actorId, actorNombre: nombreActor, skillId, progreso, penalizacionHerida };

    registrarTirada({
      escena: escenaId,
      actorId,
      actorNombre: nombreActor,
      skillId,
      etiqueta: etiquetaHabilidad,
      habilidadEfectiva: resultadoFinal.habilidadEfectiva,
      dificultad,
      penalizacionHerida,
      puntoEpicoGastado: resultadoFinal.puntoEpicoGastado,
      d100: resultadoFinal.tirada,
      exitos: resultadoFinal.exitos,
      critico: resultadoFinal.esCritico,
      pifia: resultadoFinal.esPifia,
      progreso: progreso ? `${progreso.skillId} ${progreso.anterior} → ${progreso.nuevo}` : null
    });

    onResuelto && onResuelto(resultadoFinal);
  }, { once: true });
}
