// Snapshot de estado para la interfaz DOM responsive -- Production
// Integration Phase 6B (docs/TACTICAL_PRODUCTION_PHASE6_AUDIT.md §5).
//
// Función pura: lee TacticalSession/adapter y devuelve un objeto plano
// serializable. La capa DOM NUNCA toca TacticalSession directamente --
// solo consume este snapshot y llama al controlador de acciones
// (tacticalActionController.js) para mutar. Ningún objeto Phaser
// cruza este puente.
import { movementRemaining, nivelHeridaDe } from "../bridge/qsRulesBridge.js";
import { armaActivaDe, municionArmaActivaDe } from "../bridge/qsDataAdapter.js";
import { construirCatalogoAcciones } from "./tacticalActionCatalog.js";

function resumenCompacto(session, actor, activation) {
  if (!actor) return null;
  const arma = armaActivaDe(actor);
  const municion = municionArmaActivaDe(actor);
  const restante = activation ? movementRemaining(activation) : 0;
  return {
    actorId: actor.id,
    nombre: actor.nombre,
    nivelHerida: nivelHeridaDe(actor),
    vida: { ...actor.vidaActual },
    abajo: actor.estadoDisponibilidad !== "disponible",
    movimientoRestante: activation ? Number(restante.toFixed(1)) : null,
    movimientoTotal: activation ? activation.movementTotal : null,
    accionPrincipalDisponible: activation ? activation.mainActionAvailable : null,
    accionMenorDisponible: activation ? activation.minorActionAvailable : null,
    arma: { nombre: arma.nombre, cargador: municion.cargador, reserva: municion.reserva },
    esControladoPorJugador: session.esControladoPorJugador(actor.id)
  };
}

function fichaCompleta(actor) {
  if (!actor) return null;
  return {
    actorId: actor.id,
    nombre: actor.nombre,
    esPJ: !!actor.esPJ,
    vida: { ...actor.vidaActual },
    nivelHerida: nivelHeridaDe(actor),
    habilidadDisparo: actor.habilidadDisparo ?? null,
    habilidadCC: actor.habilidadCC ?? null,
    habilidadEsquivar: typeof actor.habilidadEsquivar === "number" ? actor.habilidadEsquivar : null,
    armaPrimaria: actor.armaPrimaria ? { ...actor.armaPrimaria } : null,
    armaSecundaria: actor.armaSecundaria ? { ...actor.armaSecundaria } : null,
    armaActiva: actor.armaActiva ?? "primaria",
    recargaProgreso: actor.recargaProgreso ?? null,
    efectoEvasivo: actor.efectoEvasivo ?? null,
    esquivaTotalActiva: !!actor.esquivaTotalActiva
  };
}

/**
 * @param {object} session - TacticalSession real
 * @param {object} adapter - SpatialCombatAdapter real
 * @param {string|null} [actorIdParaFicha] - actor cuya ficha completa se
 *   quiere (por defecto, el actor activo -- pero la ficha puede abrirse
 *   para consultar a cualquier actor, incluido uno seleccionado como objetivo)
 */
export function construirSnapshotUI(session, adapter, actorIdParaFicha = session.currentActorId, extra = {}) {
  const actorActivo = session.currentActorId ? session.configDe(session.currentActorId) : null;
  const activation = session.currentActorId ? session.activations.get(session.currentActorId) : null;
  const actorFicha = actorIdParaFicha ? session.configDe(actorIdParaFicha) : actorActivo;

  return {
    round: session.round,
    resultado: session.resultado ?? null,
    actorActivoId: session.currentActorId ?? null,
    targetActorId: session.targetActorId ?? null,
    modoMoverActivo: !!extra.modoMoverActivo,
    resumen: resumenCompacto(session, actorActivo, activation),
    ficha: fichaCompleta(actorFicha),
    catalogo: session.currentActorId ? construirCatalogoAcciones({ session, adapter, actorId: session.currentActorId, cadenciaData: extra.cadenciaData }) : { familias: { ofensivas: [], tacticas: [], defensivas: [] }, contextuales: [] }
  };
}
