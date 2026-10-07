// Motor genérico de escenas data-driven. Ver docs/SCENE_SCHEMA.md para el
// esquema completo de los JSON que consume. Este módulo NO conoce ninguna escena
// por nombre — todo lo que hace depende de lo que el JSON describe. Los
// renderers (src/engine/renderers/*) solo se ocupan de layout por `type`.
import {
  state, obtenerMiembro, obtenerJugador, esJugador, miembrosDisponibles,
  establecerFlag, tieneFlag, descubrirObjeto, descubrirPista, actualizar,
  cambiarEscena, registrarDecision
} from "../gameState.js";
import { mostrarTirada } from "../ui/rollDisplay.js";
import { elegirEjecutor } from "../ui/delegation.js";
import { elegirAyudantes } from "../ui/helpSelector.js";
import { agregarResultadosColaborativos } from "../rules/helping.js";
import { rutaDeManifiesto, moduloIdActivo } from "./moduleLoader.js";

// Caché de escenas por módulo — dos módulos distintos pueden usar el mismo id
// de escena sin colisionar entre sí.
const cacheEscenas = new Map();

export async function cargarEscena(id) {
  const moduloId = moduloIdActivo();
  const clave = `${moduloId}:${id}`;
  if (cacheEscenas.has(clave)) return cacheEscenas.get(clave);
  const res = await fetch(`${rutaDeManifiesto("scenes")}${id}.json`);
  if (!res.ok) throw new Error(`Escena no encontrada: ${id} (módulo ${moduloId})`);
  const data = await res.json();
  cacheEscenas.set(clave, data);
  return data;
}

export function cumpleRequisitos(interaccion) {
  const req = interaccion.requiresFlags || [];
  const block = interaccion.blockedByFlags || [];
  if (!req.every(f => tieneFlag(f))) return false;
  if (block.some(f => tieneFlag(f))) return false;
  return true;
}

// Busca, en orden, la primera interacción cuyo trigger coincide y cuyos
// requisitos de flags se cumplen. Así una misma pareja verbo+zona puede tener
// varias versiones (primera vez / ya hecho / bloqueado) sin ninguna condicional
// en JS — el orden del array actúa como prioridad.
export function buscarInteraccion(escena, trigger) {
  return (escena.interactions || []).find(i =>
    triggerCoincide(i.trigger, trigger) && cumpleRequisitos(i)
  ) || null;
}

function triggerCoincide(a, b) {
  if (!a || !b) return false;
  const clavesA = Object.keys(a);
  const clavesB = Object.keys(b);
  if (clavesA.length !== clavesB.length) return false;
  return clavesA.every(k => a[k] === b[k]);
}

function resolverListaEjecutores(spec, escena) {
  if (spec === "party") return escena.availableParty || ["player"];
  if (Array.isArray(spec)) return spec;
  return ["player"]; // por defecto, solo el jugador
}

// Algunas acciones representan un intento material que no puede repetirse
// indefinidamente (forzar una cerradura, descifrar un chip...). La clave vive
// en el guardado genérico como flag y combina escena, interacción y actor: el
// contenido decide cuándo usar la regla mediante `oncePerActor`, mientras el
// motor evita que cada renderer tenga que reinventarla.
export function claveIntentoActor(escenaId, interaccionId, actorId) {
  return `intento:${escenaId}:${interaccionId}:${actorId}`;
}

export function actorYaIntento(escenaId, interaccionId, actorId) {
  return tieneFlag(claveIntentoActor(escenaId, interaccionId, actorId));
}

// habilidad concreta -> si no existe, cae a fallbackSkill -> si tampoco existe,
// 0 (QS línea 98: "Habilidad a 0: si no se tiene, se puede intentar con un
// penalizador de −20" — el penalizador de dificultad ya lo declara la propia
// interacción cuando aplica; aquí solo resolvemos el valor base).
function valorHabilidad(actorRuntime, skillId, fallbackSkillId) {
  if (actorRuntime.habilidades[skillId] !== undefined) return { skillId, valor: actorRuntime.habilidades[skillId] };
  if (fallbackSkillId && actorRuntime.habilidades[fallbackSkillId] !== undefined) {
    return { skillId: fallbackSkillId, valor: actorRuntime.habilidades[fallbackSkillId] };
  }
  return { skillId, valor: 0 };
}

// `onCustom` deja que un renderer concreto (p.ej. la persecución 2.5D) interprete
// campos de consecuencia que no son genéricos de todas las escenas (como
// `pursuerPauseTicks`), sin que el motor central tenga que conocerlos.
export function aplicarConsecuencias(consecuencia, actorId, { onTexto, onCustom } = {}) {
  if (!consecuencia) return;
  const actor = obtenerMiembro(actorId);

  (consecuencia.setFlags || []).forEach(f => establecerFlag(f, true));
  (consecuencia.clearFlags || []).forEach(f => establecerFlag(f, false));
  (consecuencia.discoverClues || []).forEach(descubrirPista);
  (consecuencia.discoverObjects || []).forEach(descubrirObjeto);
  if (consecuencia.inventoryAdd && actor) actor.inventario.push(...consecuencia.inventoryAdd);
  if (consecuencia.inventoryRemove && actor) {
    const retirados = new Set(consecuencia.inventoryRemove);
    actor.inventario = actor.inventario.filter(item => !retirados.has(item));
  }
  if (consecuencia.adjustResources) {
    state.resources ||= {};
    for (const [id, delta] of Object.entries(consecuencia.adjustResources)) {
      state.resources[id] = (Number(state.resources[id]) || 0) + Number(delta || 0);
    }
  }
  if (consecuencia.registerDecision) registrarDecision(consecuencia.registerDecision);
  if (consecuencia.setFinalTipo) state.finalTipo = consecuencia.setFinalTipo;

  actualizar();

  if (consecuencia.text && onTexto) onTexto(consecuencia.text, actor);
  if (onCustom) onCustom(consecuencia, actor);

  if (consecuencia.transition) {
    const delay = consecuencia.transitionDelay ?? 0;
    setTimeout(() => cambiarEscena(consecuencia.transition, {
      spawnId: consecuencia.transitionSpawnId ?? null
    }), delay);
  }
}

// Ejecuta una interacción ya encontrada: resuelve quién la hace (delegando si
// hay varios candidatos disponibles), tira si hace falta, y aplica consecuencias.
export function ejecutarInteraccion({ escenaId, escena, interaccion, onTexto, onCustom }) {
  const idsElegibles = resolverListaEjecutores(interaccion.executors, escena);
  const disponiblesBase = miembrosDisponibles(idsElegibles);
  const disponibles = interaccion.oncePerActor
    ? disponiblesBase.filter(m => !actorYaIntento(escenaId, interaccion.id, m.baseId))
    : disponiblesBase;

  if (disponibles.length === 0) {
    if (interaccion.oncePerActor && disponiblesBase.length > 0 && interaccion.onExhausted) {
      aplicarConsecuencias(interaccion.onExhausted, "player", { onTexto, onCustom });
      return;
    }
    onTexto(interaccion.noExecutorText || (interaccion.oncePerActor
      ? "Nadie del grupo puede volver a intentar exactamente lo mismo."
      : "No hay nadie disponible para hacer esto ahora mismo."));
    return;
  }

  if (disponibles.length === 1) {
    continuarConActor(disponibles[0].baseId);
    return;
  }

  const opciones = disponibles.map(m => {
    const info = interaccion.roll ? valorHabilidad(m, interaccion.roll.skill, interaccion.roll.fallbackSkill) : null;
    return {
      id: m.baseId,
      nombre: m.base.nombre,
      esJugador: esJugador(m.baseId),
      habilidadNombre: info ? info.skillId : "",
      habilidadValor: info ? info.valor : ""
    };
  });

  elegirEjecutor({
    titulo: interaccion.delegationTitle || interaccion.label || "¿Quién lo hace?",
    candidatos: opciones,
    onElegido: continuarConActor
  });

  function continuarConActor(actorId) {
    const actor = obtenerMiembro(actorId);

    if (!interaccion.roll) {
      aplicarConsecuencias(interaccion.onAlways, actorId, { onTexto, onCustom });
      return;
    }

    // Ayudar (SOURCE_OVERRIDE: MANUAL_CANON, ver docs/QS_RULE_MAP.md y
    // src/rules/helping.js): solo se ofrece si la interacción lo declara
    // explícitamente y hay más candidatos disponibles además del que tira.
    if (interaccion.roll.allowsHelp) {
      const otros = disponibles.filter(m => m.baseId !== actorId);
      if (otros.length > 0) {
        const opcionesAyuda = otros.map(m => {
          const info = valorHabilidad(m, interaccion.roll.skill, interaccion.roll.fallbackSkill);
          return { id: m.baseId, nombre: m.base.nombre, habilidadNombre: info.skillId, habilidadValor: info.valor };
        });
        elegirAyudantes({
          titulo: `¿Alguien ayuda a ${actor.base.nombre}?`,
          primario: actor.base.nombre,
          candidatos: opcionesAyuda,
          onConfirmar: (idsAyudantes) => ejecutarTiradaColaborativa(actorId, idsAyudantes)
        });
        return;
      }
    }
    ejecutarTiradaColaborativa(actorId, []);
  }

  // participantes[0] siempre es quien "hace" la acción a efectos de
  // consecuencias (inventario, atribución); el resto son ayudantes cuyos
  // éxitos (o fallos) se suman al total, tal como indica la regla real.
  function ejecutarTiradaColaborativa(actorId, idsAyudantes) {
    const participantes = [actorId, ...idsAyudantes];
    const resultados = [];

    if (interaccion.oncePerActor) {
      participantes.forEach(id => establecerFlag(claveIntentoActor(escenaId, interaccion.id, id), true));
      actualizar();
    }

    rodarSiguiente(0);

    function rodarSiguiente(i) {
      if (i >= participantes.length) return finalizar();
      const pid = participantes[i];
      const pActor = obtenerMiembro(pid);
      const { skillId, valor } = valorHabilidad(pActor, interaccion.roll.skill, interaccion.roll.fallbackSkill);
      mostrarTirada({
        actorId: pid,
        etiquetaHabilidad: (i === 0 ? "" : "Ayudando — ") + (interaccion.roll.label || skillId),
        skillId,
        habilidadBase: valor,
        dificultad: interaccion.roll.difficulty ?? 0,
        dificultadTexto: interaccion.roll.difficultyLabel ?? "Normal",
        escenaId,
        onResuelto: (resultado) => {
          resultados.push(resultado);
          rodarSiguiente(i + 1);
        }
      });
    }

    function finalizar() {
      if (resultados.length === 1) {
        const r = resultados[0];
        const consecuencia = r.exito ? interaccion.onSuccess : interaccion.onFailure;
        aplicarConsecuencias(consecuencia, actorId, { onTexto, onCustom });
        return;
      }
      const agregado = agregarResultadosColaborativos(resultados);
      const nombres = participantes.map(id => obtenerMiembro(id).base.nombre);
      if (onTexto) {
        onTexto(`Tirada colaborativa de ${nombres.join(", ")}: ${agregado.exitosTotal} éxito${agregado.exitosTotal === 1 ? "" : "s"} en total.`);
      }
      const consecuencia = agregado.exito ? interaccion.onSuccess : interaccion.onFailure;
      aplicarConsecuencias(consecuencia, actorId, { onTexto, onCustom });
    }
  }
}

export { obtenerJugador, obtenerMiembro, esJugador };
