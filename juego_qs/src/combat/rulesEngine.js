// Núcleo mínimo de reglas de combate, DOM-free y testable (Fase 2 de
// docs/COMBAT_RULES_MIGRATION_PLAN.md; contrato en docs/COMBAT_RULES_INTERFACE.md).
// Introduce SOLO los intents que ya forman parte del comportamiento
// productivo hoy -- ATTACK y BURST son los dos caminos que antes duplicaban
// la fórmula de Blindaje/Penetración/cadencia/daño (uno en
// engine/renderers/combat.js para el jugador, otro en combat.js para los
// enemigos). RELOAD y END_ACTIVATION se validan aquí porque tienen
// precondiciones reales, pero su ejecución sigue viviendo donde ya vivía
// (gameState.js/recargarArma, engine/renderers/combat.js/siguienteTurno) --
// no se duplica esa lógica en una segunda ruta.
//
// NO incluye (a propósito, ver docs/COMBAT_CANON_MATRIX.md): DEFEND,
// READY_WEAPON, EVADE, HELP, WAIT, ni ninguna Maestría -- ninguno forma
// parte todavía del comportamiento productivo real.
import { resolverAtaque, resolverImpacto, modificadorMovimientoEvasivo } from "./combat.js";
import { resolverTirada } from "../rules/dice.js";

export const COSTO_MUNICION = { ATTACK: 1, BURST: 3 };

// ===== Fase 3: economía de actuaciones (docs/COMBAT_CANON_MATRIX.md,
// sección "DECISIONES DEL AUTOR") =====
//
// Movimiento base por asalto, CAP03:559. No confundir con "puntos de
// acción": es un recurso en metros, divisible, no una moneda abstracta.
export const MOVIMIENTO_BASE_METROS = 15;

// Mapeo canónico acción -> tipo de recurso que consume, auditado contra
// CAP03:555 ("cada actuación: 1 acción principal -- atacar/usar
// habilidad/moverse a distancia -- + 1 acción menor"). ATTACK/BURST son
// canónicamente la acción principal "atacar". MOVE es un recurso de
// movimiento separado y divisible (decisión del autor, 2026-08-20 --
// puede repartirse antes/después de la acción, no consume la acción
// principal salvo que se use TODO el movimiento significativo del asalto
// de una vez, caso que este motor no distingue todavía). RELOAD no tiene
// coste canónico definido hasta Fase 4 -- conserva el comportamiento
// legacy de terminar la actuación entera, etiquetado explícitamente.
export const CLASIFICACION_ACCION = {
  ATTACK: "MAIN_ACTION",
  BURST: "MAIN_ACTION",
  MOVE: "MOVEMENT",
  RELOAD: "LEGACY_ACTION_PENDING_PHASE4",
  END_ACTIVATION: "META",
  // Fase 5A: ambas son variantes de "atacar" (CAP03:555) resueltas con más
  // de una tirada -- ninguna tiene coste de actuación distinto al de un
  // ATTACK normal en el texto (ver docs/COMBAT_PHASE5A_CANON.md).
  MULTI_ATTACK: "MAIN_ACTION",
  SPREAD_FIRE: "MAIN_ACTION"
};

// createActivation() -> objeto plano serializable (JSON.stringify/parse
// sin pérdida, sin getters). Una actuación nueva SIEMPRE tiene los
// recursos completos -- nunca hereda gasto de una actuación anterior del
// mismo actor (punto 16 del encargo: actuaciones múltiples no acumulan
// movimiento sobrante).
export function createActivation({ actorId, round, activationIndex, movementTotal = MOVIMIENTO_BASE_METROS }) {
  return {
    actorId, round, activationIndex,
    mainActionAvailable: true,
    minorActionAvailable: true, // sin intent que la consuma todavía (punto 20) -- documentado, no inventado
    movementTotal,
    movementSpent: 0,
    finished: false
  };
}

export function movementRemaining(activation) {
  return Math.max(0, activation.movementTotal - activation.movementSpent);
}

// Una actuación se considera agotada (sin más decisiones útiles) cuando
// ya no tiene acción principal NI movimiento -- la acción menor no cuenta
// porque hoy no hay ningún intent que la consuma (quedaría "disponible"
// para siempre, no debe bloquear el fin de la actuación).
export function actuacionAgotada(activation) {
  return activation.finished || (!activation.mainActionAvailable && movementRemaining(activation) <= 0);
}

// applyResourceCost(activation, intent) -> { activation, events }
// Pura -- no muta la actuación recibida, devuelve una nueva. Separada de
// resolveIntent() a propósito: resolveIntent() (Fase 2, sin cambios) solo
// calcula el resultado canónico de ATTACK/BURST; esta función solo mueve
// recursos de la actuación. Un caller normal llama a ambas para ATTACK/BURST
// (resolveIntent para el resultado, applyResourceCost para el coste).
export function applyResourceCost(activation, intent) {
  const next = { ...activation };
  const events = [];
  switch (intent.type) {
    case "ATTACK":
    case "BURST":
      next.mainActionAvailable = false;
      if (intent.apuntando) {
        // Fase 5B, CAP03:860-862 -- Apuntar "requiere una acción completa
        // sin moverse": consume TAMBIÉN la acción menor y el movimiento
        // restante de esta actuación (modelo atómico -- ver
        // docs/COMBAT_PHASE5B_CANON.md, "Decisión: modelo atómico").
        next.minorActionAvailable = false;
        next.movementSpent = activation.movementTotal;
        events.push({ type: "AIM_CONSUMED", actorId: activation.actorId });
      }
      events.push({ type: "MAIN_ACTION_SPENT", actorId: activation.actorId });
      break;
    case "MOVE": {
      const distancia = Math.max(0, Math.min(intent.distance ?? 0, movementRemaining(activation)));
      next.movementSpent = activation.movementSpent + distancia;
      events.push({ type: "MOVEMENT_SPENT", actorId: activation.actorId, distancia });
      break;
    }
    case "RELOAD":
      // CANON_PHASE4_BEHAVIOR (docs/COMBAT_PHASE4_RESULT.md, bloque 4A):
      // reemplaza el OLD_LEGACY_BEHAVIOR_PHASE3 (terminaba la actuación
      // entera). RELOAD consume la acción principal, igual que ATTACK/BURST
      // -- el ejemplo del propio autor ("recargar en una actuación y
      // disparar en la siguiente", COMBAT_CANON_MATRIX.md sección
      // "DECISIONES DEL AUTOR" punto 4) exige que recargar y disparar NO
      // quepan en la misma actuación incluso para un arma de coste 1 -- solo
      // el nivel de "acción principal" produce esa exclusión con el modelo
      // de recursos ya existente (acción menor no bloquearía Disparo). El
      // progreso (reloadProgress/reloadRequired) vive FUERA de esta
      // actuación -- ver avanzarProgreso(), gestionado por el caller sobre
      // el estado del arma/actor, no de la actuación (punto 5 del encargo).
      next.mainActionAvailable = false;
      events.push({ type: "RELOAD_PROGRESS", actorId: activation.actorId });
      break;
    case "READY_WEAPON":
      // Mismo esquema de coste que RELOAD (AUTHOR_CLARIFICATION,
      // COMBAT_CANON_MATRIX.md punto 5) -- consume la acción principal,
      // progreso externo a la actuación (readyProgress/readyRequired).
      next.mainActionAvailable = false;
      events.push({ type: "WEAPON_READY_PROGRESS", actorId: activation.actorId });
      break;
    case "CHANGE_WEAPON":
      // CAP03:555 -- acción menor explícita ("cambiar de arma"). Distinta de
      // READY_WEAPON: cambia entre dos armas YA preparadas, sin progreso.
      next.minorActionAvailable = false;
      events.push({ type: "WEAPON_CHANGED", actorId: activation.actorId });
      break;
    case "DEFEND_SPLIT":
    case "DODGE_TOTAL":
      // CAP03:1003-1015 -- alternativas a atacar en CC, consumen la acción
      // principal de esta actuación (no se puede dividir habilidad en
      // defensa/Esquiva total Y además atacar en la misma actuación).
      next.mainActionAvailable = false;
      events.push({ type: intent.type === "DEFEND_SPLIT" ? "DEFENSE_STARTED" : "DEFENSE_STARTED", actorId: activation.actorId, modo: intent.type });
      break;
    case "EVASIVE_MOVEMENT":
      // CAP03:1017-1036 -- "consume la actuación completa" (línea 1021):
      // termina la actuación entera al declararse, no solo la acción
      // principal (a diferencia de RELOAD/READY_WEAPON/DEFEND_SPLIT, que sí
      // dejan la acción menor/movimiento restante utilizables). El efecto
      // (penalizador a atacantes) lo calcula resolverMovimientoEvasivo() y
      // lo conserva el caller "hasta la siguiente actuación" del actor
      // (punto 14 del encargo) -- no vive dentro de esta actuación, que ya
      // ha terminado.
      next.finished = true;
      events.push({ type: "EVASIVE_MOVEMENT_STARTED", actorId: activation.actorId });
      break;
    case "MULTI_ATTACK":
    case "SPREAD_FIRE":
    case "DUAL_ATTACK":
      // Fase 5A/5B -- variante de "atacar" (CAP03:555), misma acción
      // principal que ATTACK/BURST. Ver docs/COMBAT_PHASE5A_CANON.md,
      // "Relación con actuaciones" (DUAL_ATTACK hereda el mismo
      // razonamiento: "como en los ataques múltiples", CAP03:939).
      next.mainActionAvailable = false;
      events.push({ type: "MAIN_ACTION_SPENT", actorId: activation.actorId });
      break;
    case "CLEAR_JAM":
      // CAP03:1146 -- "Encasquillamiento grave. Requiere acción." Lectura
      // más literal del texto (una sola palabra "acción", sin progresión
      // 1/2/3 como recarga/preparar arma, sin más detalle): consume UNA
      // acción principal, igual criterio que RELOAD sin progreso extra.
      next.mainActionAvailable = false;
      events.push({ type: "JAM_CLEARED", actorId: activation.actorId });
      break;
    case "REPAIR_WEAPON":
      // CAP03:1152 -- "puede intentar repararla (1 acción completa,
      // tirada)". Mismo patrón "acción completa" que Apuntar (Fase 5B):
      // consume principal + menor + movimiento restante.
      next.mainActionAvailable = false;
      next.minorActionAvailable = false;
      next.movementSpent = activation.movementTotal;
      events.push({ type: "WEAPON_REPAIR_ATTEMPTED", actorId: activation.actorId });
      break;
    case "END_ACTIVATION":
      next.finished = true;
      events.push({ type: "ACTIVATION_ENDED", actorId: activation.actorId, reason: "VOLUNTARY" });
      break;
    default:
      break;
  }
  return { activation: next, events };
}

// validateIntent(actor, intent, activation?) -> { valid, reasons }
// actor: forma runtime ya usada por engine/renderers/combat.js -- para el
// jugador/compañeros, miembro.municion; para enemigos, enemigo.municion.
// `activation` es OPCIONAL y retrocompatible con Fase 2: si se omite, no
// se comprueba ningún recurso de actuación (comportamiento exacto de
// Fase 2). No muta nada. No conoce Phaser, DOM ni gameState.js.
export function validateIntent(actor, intent, activation) {
  const reasons = [];
  if (activation) {
    if (activation.finished) reasons.push("ACTIVATION_FINISHED");
    else if (activation.actorId !== actor.id) reasons.push("NOT_ACTIVE_ACTOR");
  }
  switch (intent.type) {
    case "ATTACK":
    case "BURST": {
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      // Fase 5B, CAP03:860-866 -- Apuntar/Tiro Certero como parámetros de
      // ATTACK/BURST (docs/COMBAT_PHASE5B_CANON.md, "modelo atómico").
      if (intent.apuntando) {
        if (!intent.tieneSistemaPunteria) reasons.push("NO_SIGHT_SYSTEM"); // "sistema de puntería apropiado"
        if (activation && activation.movementSpent > 0) reasons.push("AIM_REQUIRES_NO_PRIOR_MOVEMENT"); // "sin moverse"
      }
      if (intent.tiroCertero) {
        if (!intent.apuntando) reasons.push("PRECISE_SHOT_REQUIRES_AIM"); // "requiere haber apuntado"
        if ((intent.distanciaMediaActor ?? 0) < TIRO_CERTERO_DM_MINIMA) reasons.push("PRECISE_SHOT_BELOW_MINIMUM_SKILL");
      }
      // Fase 5C, CAP03:1141-1156 -- estado runtime del arma (jammed/broken),
      // NUNCA leído de weapons.json/characters.json (eso es definición, no
      // estado) -- el caller pasa el estado actual del arma del actor.
      if (intent.armaJammed) reasons.push("WEAPON_JAMMED");
      if (intent.armaBroken) reasons.push("WEAPON_BROKEN");
      if (intent.cc) break; // cuerpo a cuerpo no consume munición
      const cargador = actor.municion?.cargador ?? 0;
      const costo = COSTO_MUNICION[intent.type];
      if (cargador < costo) reasons.push("NO_AMMO");
      break;
    }
    case "MOVE": {
      if (activation) {
        const restante = movementRemaining(activation);
        if ((intent.distance ?? 0) > restante) reasons.push("NOT_ENOUGH_MOVEMENT");
      }
      break;
    }
    case "RELOAD": {
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      const reserva = actor.municion?.reserva ?? 0;
      if (reserva <= 0) reasons.push("NO_RESERVE");
      break;
    }
    case "READY_WEAPON": {
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      if (intent.yaLista) reasons.push("WEAPON_ALREADY_READY");
      break;
    }
    case "CHANGE_WEAPON": {
      if (activation && !activation.finished && !activation.minorActionAvailable) reasons.push("MINOR_ACTION_SPENT");
      if (intent.objetivoNoListo) reasons.push("WEAPON_NOT_READY");
      break;
    }
    case "DEFEND_SPLIT": {
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      if (!intent.cc) reasons.push("ONLY_MELEE"); // CAP03:1005 -- "solo cuerpo a cuerpo"
      const total = intent.habilidadTotal ?? 0;
      const ataque = intent.ataque ?? 0;
      const defensa = intent.defensa ?? 0;
      // CAP03:1007 no cuantifica "los mínimos existentes" (a diferencia de
      // la división de ataques múltiples, CAP03:1044-1051, que sí exige
      // 50/25) -- ver BLOCKED_CANON_QUESTION en docs/COMBAT_PHASE4_RESULT.md.
      // Se valida solo lo que el propio texto exige sin ambigüedad: ambas
      // partes positivas y que no superen la habilidad total.
      if (ataque <= 0 || defensa <= 0) reasons.push("SPLIT_MUST_BE_POSITIVE");
      if (ataque + defensa > total) reasons.push("SPLIT_EXCEEDS_SKILL");
      break;
    }
    case "DODGE_TOTAL": {
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      if (!intent.cc) reasons.push("ONLY_MELEE"); // CAP03:1013 -- "solo cuerpo a cuerpo"
      break;
    }
    case "EVASIVE_MOVEMENT": {
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      if (intent.cc) reasons.push("ONLY_RANGED"); // CAP03:1017 -- "contra ataques a distancia"
      break;
    }
    case "MULTI_ATTACK": {
      // CAP03:1044-1051 -- división de habilidad CC, mínimo 50 total / 25
      // por ataque. intent.attacks: [{targetId, skillAllocation}, ...].
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      const habilidadTotal = intent.habilidadTotal ?? 0;
      const allocations = (intent.attacks ?? []).map(a => a.skillAllocation);
      const { errores } = validarDivisionAtaques({ habilidadTotal, allocations });
      reasons.push(...errores);
      break;
    }
    case "SPREAD_FIRE": {
      // CAP03:1067-1090 -- disparo a varios objetivos, mínimo Distancia
      // Media 50 total / 25 por objetivo, mínimo 1 proyectil por objetivo.
      // intent.targets: [{targetId, skillAllocation, proyectiles}, ...].
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      const distanciaMedia = intent.distanciaMedia ?? 0;
      const targets = intent.targets ?? [];
      const allocations = targets.map(t => t.skillAllocation);
      const proyectilesAsignados = targets.map(t => t.proyectiles);
      const proyectilesDisponibles = actor.municion?.cargador ?? 0;
      const { errores } = validarDisparoMultiplesObjetivos({ distanciaMedia, allocations, proyectilesAsignados, proyectilesDisponibles });
      reasons.push(...errores);
      break;
    }
    case "DUAL_ATTACK": {
      // CAP03:935-943 -- combate a dos armas. Precondición propia (FUE >=
      // 1.5x fuerza mínima del arma secundaria) + la MISMA división de
      // habilidad de MULTI_ATTACK (CAP03:939, "como en los ataques
      // múltiples") -- se reutiliza validarDivisionAtaques() sin cambios
      // (punto 22 del encargo Fase 5B: "no crear un segundo algoritmo").
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      if (!puedeEmpuñarDosArmas(intent.fuerzaActor ?? 0, intent.fuerzaMinimaSecundaria ?? 0)) reasons.push("INSUFFICIENT_STRENGTH_FOR_OFFHAND");
      const attacks = intent.attacks ?? [];
      if (attacks.length !== 2) reasons.push("DUAL_ATTACK_NEEDS_EXACTLY_TWO_WEAPONS"); // siempre dos armas, nunca más (a diferencia de MULTI_ATTACK genérico)
      const habilidadTotal = intent.habilidadTotal ?? 0;
      const allocations = attacks.map(a => a.skillAllocation);
      const { errores } = validarDivisionAtaques({ habilidadTotal, allocations });
      reasons.push(...errores);
      break;
    }
    case "CLEAR_JAM": {
      // CAP03:1146 -- solo tiene sentido si el arma está realmente encasquillada.
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      if (!intent.armaJammed) reasons.push("NOT_JAMMED");
      break;
    }
    case "REPAIR_WEAPON": {
      // CAP03:1152 -- "Si el personaje tiene Armería >= 50, puede intentar
      // repararla". Solo tiene sentido si el arma está realmente inutilizada.
      if (activation && !activation.finished && !activation.mainActionAvailable) reasons.push("MAIN_ACTION_SPENT");
      if (!intent.armaBroken) reasons.push("WEAPON_NOT_BROKEN");
      if (!puedeIntentarRepararEnCombate(intent.habilidadArmeria ?? 0)) reasons.push("ARMORY_SKILL_TOO_LOW");
      break;
    }
    case "END_ACTIVATION":
      break; // sin precondiciones
    default:
      reasons.push("UNKNOWN_INTENT");
  }
  // Liveness del actor/objetivo NO se comprueba aquí: el runtime actual
  // representa "vivo" de dos formas distintas según sea PJ/compañero
  // (suma de vidaActual.sano+herido+tullido > 0, gameState.js) o enemigo
  // (enemigo.pv > 0, engine/renderers/combat.js) -- el caller ya filtra
  // con partyVivo()/enemigosVivos() antes de llegar aquí (siguienteTurno()),
  // exactamente igual que antes de esta extracción.
  return { valid: reasons.length === 0, reasons };
}

// resolveIntent(actor, target, intent, context) -> { result, events }
// Única puerta de entrada a la resolución de ATTACK/BURST -- tanto el
// jugador/compañeros (vía UI, con tirada ya resuelta por mostrarTirada())
// como los enemigos (vía modo automático, tirada resuelta aquí mismo) pasan
// por esta misma función. No consume munición ni aplica daño sobre el
// estado real del juego -- eso sigue en gameState.js (consumirMunicion/
// aplicarDanio), para no crear una segunda ruta de persistencia. Solo
// calcula el resultado canónico y emite eventos semánticos.
export function resolveIntent(actor, target, intent, context = {}) {
  const { rng } = context;
  const events = [{ type: "ATTACK_DECLARED", actorId: actor.id, targetId: target?.id }];

  let tiradaResultado;
  if (intent.tiradaYaResuelta) {
    // El jugador ya tiró vía mostrarTirada() (permite gastar Punto Épico
    // DESPUÉS de ver el resultado -- rules/dice.js, comentario de
    // interpretarTirada()) -- no se vuelve a tirar, se reutiliza esa tirada.
    tiradaResultado = intent.tiradaYaResuelta;
  } else {
    tiradaResultado = resolverTirada({
      habilidadBase: intent.habilidadBase,
      dificultad: intent.dificultad ?? 0,
      puntoEpicoGastado: intent.puntoEpicoGastado ?? false,
      rng
    });
  }
  events.push({
    type: "ROLL_RESOLVED", tirada: tiradaResultado.tirada, exito: tiradaResultado.exito,
    esCritico: tiradaResultado.esCritico, esPifia: tiradaResultado.esPifia
  });

  const cadenciaBonus = intent.type === "BURST" ? (intent.cadenciaBonus ?? 0) : 0;
  // Fase 5B, CAP03:860-866 -- Apuntar/Tiro Certero suman al daño base ANTES
  // de la multiplicación por éxitos netos ("el daño base modificado se
  // multiplica por los éxitos netos finales"), igual capa que el bono de
  // FUE de Fase 4B (effectiveBaseDamage) -- no se suman +1 y +2 (Tiro
  // Certero sustituye, nunca se acumula con Apuntar normal).
  const danioBaseConPunteria = (intent.danioBase ?? 1) + bonusDanioPorPunteria({ apuntando: intent.apuntando, tiroCertero: intent.tiroCertero });
  const impactoResultado = resolverImpacto({
    tirada: tiradaResultado.tirada, exito: tiradaResultado.exito, exitos: tiradaResultado.exitos, esCritico: tiradaResultado.esCritico,
    penetracion: intent.penetracion ?? 0, blindajeObjetivo: intent.blindajeObjetivo ?? 0,
    coberturaObjetivo: intent.coberturaObjetivo ?? 0, cadenciaBonus, danioBase: danioBaseConPunteria,
    exitosDefensa: intent.exitosDefensa ?? 0,
    localizacionForzada: intent.apuntando ? intent.localizacionElegida : undefined
  });

  if (!tiradaResultado.exito) {
    events.push({ type: "ATTACK_MISSED", actorId: actor.id, targetId: target?.id });
  } else if (!impactoResultado.impacto) {
    events.push({ type: "ARMOR_STOPPED", actorId: actor.id, targetId: target?.id });
  } else {
    events.push({ type: "ATTACK_HIT", actorId: actor.id, targetId: target?.id, localizacion: impactoResultado.localizacion });
    events.push({ type: "DAMAGE_APPLIED", targetId: target?.id, danio: impactoResultado.danioFinal });
  }

  // Fase 5C, CAP03:947-953 -- combate sin armas: "no letal por defecto".
  // Solo se marca el resultado (esNoLetal); no se toca ningún pipeline de
  // curación/recuperación de PV -- eso es responsabilidad de un sistema de
  // curación que hoy no existe, fuera de alcance de la resolución de
  // ataque (punto 3 del encargo: "no ampliar scope").
  const result = { ...tiradaResultado, ...impactoResultado, esNoLetal: !!(intent.cc && intent.sinArmas) };
  // ACTOR_DOWN no se emite aquí a propósito: si el objetivo cae depende de
  // sus PV reales, que viven en gameState.js/el runtime del renderer, no en
  // este resultado aislado -- el caller (engine/renderers/combat.js) ya
  // decide eso después de restar result.danioFinal, exactamente igual que
  // antes de esta extracción.
  return { result, events };
}

// Reutiliza resolverAtaque() completo (tirada + impacto en una sola llamada)
// para los casos que no necesitan la separación de tiradaYaResuelta --
// expuesto para tests y para cualquier caller que prefiera no montar el
// intent a mano.
export { resolverAtaque };

// ===== Fase 4A: recarga/preparar progresivos, acción menor real, defensa
// activa, movimiento evasivo (docs/COMBAT_PHASE4_RESULT.md) =====

export const TAMANO_ACCIONES = { pequena: 1, mediana: 2, grande: 3 };

export function costeAccionesPorTamano(tamano) {
  return TAMANO_ACCIONES[tamano] ?? 1;
}

// Progreso de una acción prolongada (RELOAD o READY_WEAPON, ambas con el
// mismo esquema 1/2/3 -- AUTHOR_CLARIFICATION, COMBAT_CANON_MATRIX.md
// puntos 4-5). Pura -- no muta el progreso recibido. Vive FUERA de
// activationState a propósito (punto 5 del encargo Fase 4): pertenece al
// arma/actor, lo posee el caller (runtime del combatiente en
// engine/renderers/combat.js), porque activationState se resetea en cada
// actuación nueva y este progreso debe sobrevivir entre actuaciones.
export function avanzarProgreso(progresoActual, required) {
  const progress = Math.min(required, (progresoActual?.progress ?? 0) + 1);
  return { required, progress, completo: progress >= required };
}

// CAP03:555 -- acción menor real: cambiar entre dos armas YA preparadas
// (distinto de READY_WEAPON, que pasa un arma de reposo a lista y cuesta
// 1-3 acciones principales). Sin progreso: es instantáneo dentro de la
// acción menor de la actuación.
export function cambiarArma(minorActionAvailable) {
  return !!minorActionAvailable;
}

// ===== Defensa activa CC (CAP03:1003-1015) =====
// "División de habilidad en defensa": cada parte debe respetar "los mínimos
// existentes" (CAP03:1007) -- CAP03 NO cuantifica ese mínimo aquí (a
// diferencia de la división de ataques múltiples, CAP03:1044-1051, que sí
// exige 50/25 explícitamente). BLOCKED_CANON_QUESTION documentada en
// docs/COMBAT_PHASE4_RESULT.md: esta función solo valida lo que el propio
// texto exige sin ambigüedad (partes positivas, suma ≤ habilidad total).
export function validarDivisionDefensiva({ habilidadTotal, ataque, defensa }) {
  const errores = [];
  if (ataque <= 0 || defensa <= 0) errores.push("SPLIT_MUST_BE_POSITIVE");
  if (ataque + defensa > habilidadTotal) errores.push("SPLIT_EXCEEDS_SKILL");
  return { valido: errores.length === 0, errores };
}

// CAP03:1007 -- "los éxitos de defensa restan los éxitos del ataque cuerpo a
// cuerpo recibido. Si la defensa iguala o supera el ataque, este no causa
// daño." Pura: tira la defensa contra el ataque CC ya resuelto del rival.
export function resolverDefensaDividida({ habilidadDefensa, dificultad = 0, puntoEpicoGastado = false, rng = Math.random }) {
  const tiradaDefensa = resolverTirada({ habilidadBase: habilidadDefensa, dificultad, puntoEpicoGastado, rng });
  return { ...tiradaDefensa, exitosDefensa: tiradaDefensa.exito ? tiradaDefensa.exitos : 0 };
}

// CAP03:1013-1015 -- "Esquiva total": cancela TODO el daño de ese ataque CC
// si tiene éxito, no protege contra disparos/explosiones/área/ambiente.
export function resolverEsquivaTotal({ habilidadEsquivar, dificultad = 0, puntoEpicoGastado = false, rng = Math.random }) {
  const tirada = resolverTirada({ habilidadBase: habilidadEsquivar, dificultad, puntoEpicoGastado, rng });
  return { ...tirada, cancelaDanioCC: tirada.exito };
}

// ===== Movimiento evasivo (CAP03:1017-1036) =====
// modificadorMovimientoEvasivo() ya existía suelta en combat/combat.js
// (0.3.1) sin conectar a ningún intent -- Fase 4 la conecta aquí. Una única
// tirada de Esquivar cubre TODOS los disparos hasta la siguiente actuación
// del actor (semántica "tu turno" ya cerrada, COMBAT_CANON_MATRIX.md punto
// 3 -- nunca se traduce automáticamente a round+1, ver punto 12 del
// encargo). El penalizador resultante lo aplica el caller a la Habilidad
// efectiva de cualquier atacante a distancia contra este actor hasta que su
// próxima actuación empiece (efecto gestionado fuera del Rules Engine, en
// el runtime del combate -- "no crear sistema de buffs genérico enorme",
// punto 14 del encargo).
export function resolverMovimientoEvasivo({ habilidadEsquivar, dificultad = 0, puntoEpicoGastado = false, rng = Math.random }) {
  const tirada = resolverTirada({ habilidadBase: habilidadEsquivar, dificultad, puntoEpicoGastado, rng });
  const penalizadorAtacantes = modificadorMovimientoEvasivo(tirada.exito ? tirada.exitos : 0);
  return { ...tirada, penalizadorAtacantes };
}

// ===== Límite situacional ±20 (CAP03:159) — solo modificadores de
// habilidad, NUNCA Penetración/Blindaje (AUTHOR_CLARIFICATION,
// COMBAT_CANON_MATRIX.md punto 9). Combina flanqueo/sorpresa/múltiples
// adversarios/etc. antes de pasarlos como `dificultad` a resolverTirada. =====
export function limitarModificadorSituacional(valor) {
  return Math.max(-20, Math.min(20, valor));
}

// ===== Fase 4B: CaC/espacial (docs/COMBAT_PHASE4_RESULT.md) =====

// CAP03:872-883 -- "Múltiples adversarios", solo aplica a CC, nunca a
// distancia (ya lo dice el propio texto explícitamente).
export function penalizadorMultiplesAdversarios(numAdversariosCC) {
  if (numAdversariosCC <= 1) return 0;
  if (numAdversariosCC <= 3) return -10;
  if (numAdversariosCC <= 5) return -20;
  return -30; // 6+ (CAP03 permite también "imposible a criterio del DJ" -- no modelado, decisión narrativa)
}

// ===== Flanqueo (AUTHOR_CLARIFICATION + CAP03:997) =====
// Regla de orientación relativa, NO geometría de grid/facing rígido (ver
// docs/COMBAT_RULES_INTERFACE.md, sección "Flanqueo"). `combatContext` lo
// aporta el caller (runtime de combate): a quién encara cada defensor
// (facingTargetId) y qué atacantes están trabados en CC con cada defensor
// (atacantesCC). El Rules Engine solo evalúa la condición, nunca decide
// geometría.
export const FLANQUEO_BONUS = 10;

export function isFlanking(attackerId, defenderId, combatContext) {
  const atacantes = combatContext?.atacantesCC?.[defenderId] ?? [];
  if (atacantes.length < 2) return false;
  if (!atacantes.includes(attackerId)) return false;
  const facing = combatContext?.facingTargetId?.[defenderId];
  if (!facing) return false; // sin encaramiento declarado, no hay forma de saber quién NO está encarado
  return attackerId !== facing;
}

// ===== Fuerza y daño cuerpo a cuerpo (CANON_SOURCE, CAP03:887-919) =====
// No modifica weapon.baseDamage (punto 25 del encargo) -- effectiveBaseDamage
// se calcula por ataque, así la misma arma funciona correctamente con
// usuarios de FUE distinta. No aplica a armas de fuego (CAP03:909).
export function strengthDamageBonus(actorStrength, weaponRequiredStrength) {
  return Math.max(0, Math.floor((actorStrength - weaponRequiredStrength) / 5));
}

export function effectiveBaseDamage(weaponBaseDamage, actorStrength, weaponRequiredStrength, aplicaBonusFuerza = true) {
  if (!aplicaBonusFuerza) return weaponBaseDamage;
  return weaponBaseDamage + strengthDamageBonus(actorStrength, weaponRequiredStrength);
}

// ===== Fase 4C: sorpresa (docs/COMBAT_PHASE4_RESULT.md) =====
// AUTHOR_RULE_CURRENT, COMBAT_CANON_MATRIX.md punto 6 -- +20 al PRIMER
// ataque de un combatiente sorprendido/emboscado, se consume tras aplicarse
// (no es un estado permanente). El estado `surpriseAttackAvailable` lo
// posee el caller sobre el runtime del combatiente (igual criterio que
// reloadProgress/readyProgress -- no vive en activationState).
export const SORPRESA_BONUS = 20;

export function aplicarSorpresaSiDisponible(dificultadBase, surpriseAttackAvailable) {
  return surpriseAttackAvailable ? dificultadBase + SORPRESA_BONUS : dificultadBase;
}

// ===== Fase 5A: división de habilidad, múltiples ataques, disparo a
// varios objetivos (docs/COMBAT_PHASE5A_CANON.md, docs/COMBAT_PHASE5A_RESULT.md) =====
//
// Primitiva compartida por ambas mecánicas (CAP03:1044-1051 para CC,
// CAP03:1067-1078 para disparo a varios objetivos): mismos dos números
// -- mínimo 50 en la habilidad/Distancia Media total para poder dividir,
// mínimo 25 asignados a cada parte. Ninguna de las dos secciones de CAP03
// prohíbe explícitamente asignar MENOS del total (CAP03:1076 dice "no
// puede SUPERAR" la Distancia Media original) -- se adopta esa misma
// lectura permisiva para ambas, ver docs/COMBAT_PHASE5A_CANON.md.
export const DIVISION_HABILIDAD_MIN_TOTAL = 50;
export const DIVISION_HABILIDAD_MIN_PARTE = 25;

// validarDivisionAtaques({habilidadTotal, allocations}) -> {valido, errores}
// CAP03:1044-1051 -- división de habilidad cuerpo a cuerpo. `allocations`
// es un array de números (habilidad asignada a cada ataque) -- CAP03 no
// dice si los ataques van al mismo objetivo o a varios distintos, así que
// esta función no conoce objetivos en absoluto (esa relación vive en
// intent.attacks[].targetId, fuera de esta validación de habilidad).
export function validarDivisionAtaques({ habilidadTotal, allocations }) {
  const errores = [];
  if (!Array.isArray(allocations) || allocations.length < 2) {
    errores.push("NEEDS_AT_LEAST_TWO_PARTS");
    return { valido: false, errores };
  }
  if (habilidadTotal < DIVISION_HABILIDAD_MIN_TOTAL) errores.push("SKILL_BELOW_MINIMUM");
  if (allocations.some(a => a < DIVISION_HABILIDAD_MIN_PARTE)) errores.push("PART_BELOW_MINIMUM");
  const suma = allocations.reduce((a, b) => a + b, 0);
  if (suma > habilidadTotal) errores.push("SPLIT_EXCEEDS_SKILL");
  return { valido: errores.length === 0, errores };
}

// validarDisparoMultiplesObjetivos({distanciaMedia, allocations,
// proyectilesAsignados, proyectilesDisponibles}) -> {valido, errores}
// CAP03:1067-1078 -- disparo a varios objetivos. Dos repartos paralelos
// (habilidad Y proyectiles), cada uno con su propio límite -- "el número
// máximo de objetivos queda limitado por AMBAS distribuciones" (CAP03:1078),
// por eso se validan las dos por separado en vez de una sola suma combinada.
export function validarDisparoMultiplesObjetivos({ distanciaMedia, allocations, proyectilesAsignados, proyectilesDisponibles }) {
  const errores = [];
  if (!Array.isArray(allocations) || allocations.length < 2) {
    errores.push("NEEDS_AT_LEAST_TWO_TARGETS");
    return { valido: false, errores };
  }
  if (distanciaMedia < DIVISION_HABILIDAD_MIN_TOTAL) errores.push("SKILL_BELOW_MINIMUM");
  if (allocations.some(a => a < DIVISION_HABILIDAD_MIN_PARTE)) errores.push("PART_BELOW_MINIMUM");
  const sumaHabilidad = allocations.reduce((a, b) => a + b, 0);
  if (sumaHabilidad > distanciaMedia) errores.push("SPLIT_EXCEEDS_SKILL");

  if (!Array.isArray(proyectilesAsignados) || proyectilesAsignados.length !== allocations.length) {
    errores.push("PROJECTILE_ALLOCATION_MISMATCH");
  } else {
    if (proyectilesAsignados.some(p => p < 1)) errores.push("EACH_TARGET_NEEDS_AT_LEAST_ONE_PROJECTILE");
    const sumaProyectiles = proyectilesAsignados.reduce((a, b) => a + b, 0);
    if (sumaProyectiles > (proyectilesDisponibles ?? 0)) errores.push("NOT_ENOUGH_AMMO");
  }
  return { valido: errores.length === 0, errores };
}

// Tabla de cadencia POR OBJETIVO en fuego repartido (CAP03:1082-1090) --
// DISTINTA de modificadorCadencia() (combat/combat.js), que usa los tres
// modos discretos de un disparo único (tiro a tiro/ráfaga/cargador = 1/3/9
// balas exactas). Aquí se indexa por RANGO de proyectiles asignados a ese
// objetivo concreto dentro de un reparto, con sus propios cortes (1-2/3-8/9+).
// Única fuente de verdad para esta tabla -- ningún otro sitio debe
// reimplementarla (punto 10 del encargo).
export function cadenciaPorProyectilesRepartidos(proyectiles) {
  if (proyectiles >= 9) return 2;
  if (proyectiles >= 3) return 1;
  return 0;
}

// CAP03:1092 -- separación entre objetivos de un disparo repartido: los
// primeros 3m respecto al objetivo PRINCIPAL no penalizan; cada 3m
// adicionales o fracción restan 1 ÉXITO (no habilidad, no dificultad de
// tirada). Verificado contra el ejemplo exacto de CAP03:1137 (7m -> -2).
export function penalizadorSeparacionObjetivos(distanciaAlPrincipal) {
  if (distanciaAlPrincipal <= 3) return 0;
  return -Math.ceil((distanciaAlPrincipal - 3) / 3);
}

// resolveMultiAttack(actor, parts, context) -> {results, events}
// Puerta de entrada única para MULTI_ATTACK (CC) y SPREAD_FIRE (varios
// objetivos a distancia) -- ambas comparten la MISMA ruta de resolución
// por parte (resolverTirada + resolverImpacto, punto 9 del encargo: "no
// crear una fórmula paralela"). Cada `parte` es independiente: su propia
// tirada de d100 (nunca se reutiliza una tirada para varias partes,
// CAP03:1080), su propio penalizador de separación ya incorporado en
// `dificultad` por el caller, su propia cadencia ya resuelta por el
// caller (cadenciaPorProyectilesRepartidos() para SPREAD_FIRE,
// modificadorCadencia() normal para MULTI_ATTACK si aplica). Un fallo en
// una parte no cancela las demás (CAP03:1104).
export function resolveMultiAttack(actor, parts, context = {}) {
  const { rng } = context;
  const events = [{ type: "MULTI_ATTACK_DECLARED", actorId: actor.id, partes: parts.length }];

  const results = parts.map(parte => {
    const tiradaResultado = parte.tiradaYaResuelta ?? resolverTirada({
      habilidadBase: parte.habilidadAsignada,
      dificultad: parte.dificultad ?? 0,
      puntoEpicoGastado: parte.puntoEpicoGastado ?? false,
      rng
    });
    const impactoResultado = resolverImpacto({
      tirada: tiradaResultado.tirada, exito: tiradaResultado.exito, exitos: tiradaResultado.exitos, esCritico: tiradaResultado.esCritico,
      penetracion: parte.penetracion ?? 0, blindajeObjetivo: parte.blindajeObjetivo ?? 0,
      coberturaObjetivo: parte.coberturaObjetivo ?? 0, cadenciaBonus: parte.cadenciaBonus ?? 0,
      danioBase: parte.danioBase ?? 1, exitosDefensa: parte.exitosDefensa ?? 0
    });
    events.push({
      type: "ATTACK_PART_RESOLVED", actorId: actor.id, targetId: parte.targetId,
      exito: tiradaResultado.exito, impacto: impactoResultado.impacto, danio: impactoResultado.danioFinal
    });
    return { targetId: parte.targetId, ...tiradaResultado, ...impactoResultado };
  });

  events.push({ type: "MULTI_TARGET_RESOLVED", actorId: actor.id, objetivos: parts.length });
  return { results, events };
}

// ===== Fase 5B: Apuntar/Tiro Certero, Atravesar, combate a dos armas
// (docs/COMBAT_PHASE5B_CANON.md, docs/COMBAT_PHASE5B_RESULT.md) =====
// Ninguna de las tres depende de Maestrías -- las tres viven en el cuerpo
// de CAP03, no en ANEXO_Meritos_Habilidades_DEFINITIVO.md.

// ===== A. Apuntar / Tiro Certero (CAP03:860-866) =====
export const APUNTAR_BONUS_DANIO = 1;
export const TIRO_CERTERO_BONUS_DANIO = 2;
export const TIRO_CERTERO_DM_MINIMA = 75;

// bonusDanioPorPunteria({apuntando, tiroCertero}) -> number
// "No se suman +1 y +2" (CAP03:866) -- Tiro Certero SUSTITUYE el bono de
// Apuntar normal, nunca se acumulan. Se suma al daño base ANTES de
// multiplicar por éxitos netos (misma capa que effectiveBaseDamage, Fase 4B).
export function bonusDanioPorPunteria({ apuntando, tiroCertero }) {
  if (tiroCertero) return TIRO_CERTERO_BONUS_DANIO;
  if (apuntando) return APUNTAR_BONUS_DANIO;
  return 0;
}

// ===== B. Atravesar (CAP03:833-845) =====
export const ATRAVESAR_PENALIZADOR_SEGUNDO_ATAQUE = -20;

// puedeAtravesar({penetracionTotal, blindajeTotalPrimerObjetivo,
// impactoPrimerObjetivo}) -> boolean
// CAP03:835 -- "Pen total >= 2x Blindaje total activo del objetivo Y el
// ataque causa daño". Caso especial CAP03:843 (recordatorio ya cerrado,
// ver docs/COMBAT_CANON_MATRIX.md "Penetración vs. Blindaje 0"): con
// Blindaje 0 la condición general sería trivial con cualquier Pen -- se
// sobrescribe exigiendo Pen >= 1. Este mínimo es un REQUISITO de
// Atravesar, no un cambio en cómo Blindaje 0 reduce daño (esa regla no se
// toca aquí).
export function puedeAtravesar({ penetracionTotal, blindajeTotalPrimerObjetivo, impactoPrimerObjetivo }) {
  if (!impactoPrimerObjetivo) return false;
  if (blindajeTotalPrimerObjetivo <= 0) return penetracionTotal >= 1;
  return penetracionTotal >= 2 * blindajeTotalPrimerObjetivo;
}

// CAP03:840 -- "Pen residual = Pen total - Blindaje total del primer objetivo".
export function penetracionResidualTrasAtravesar(penetracionTotal, blindajeTotalPrimerObjetivo) {
  return Math.max(0, penetracionTotal - blindajeTotalPrimerObjetivo);
}

// resolveAtravesar(actor, {primero, segundo}, context) -> {primero, segundo, events}
// Orquesta DOS llamadas a resolveIntent() -- la misma puerta de entrada
// que cualquier ATTACK normal (punto 13 del encargo Fase 5B: "no crear
// una ruta de daño paralela"). `primero`/`segundo` llevan los mismos
// campos que un intent ATTACK normal (habilidadBase, dificultad,
// penetracion, blindajeObjetivo, coberturaObjetivo, danioBase,
// tiradaYaResuelta opcional). `segundo` es null/undefined si no hay
// objetivo detrás (decisión narrativa del Narrador -- el motor nunca
// inventa un segundo objetivo, solo resuelve si el caller le da uno).
// Sin gastar munición extra: esta función no toca gameState.js/consumirMunicion
// en absoluto, así que "sin gastar otra bala" (CAP03:839) se cumple por
// construcción -- ver docs/COMBAT_PHASE5B_CANON.md.
export function resolveAtravesar(actor, { primero, segundo }, context = {}) {
  const { rng } = context;
  const resultadoPrimero = resolveIntent(actor, { id: primero.targetId }, {
    type: primero.cadenciaBonus > 0 ? "BURST" : "ATTACK", ...primero
  }, { rng });

  const blindajeTotalPrimerObjetivo = (primero.blindajeObjetivo ?? 0) + (primero.coberturaObjetivo ?? 0);
  const puede = puedeAtravesar({
    penetracionTotal: primero.penetracion ?? 0,
    blindajeTotalPrimerObjetivo,
    impactoPrimerObjetivo: resultadoPrimero.result.impacto
  });

  if (!puede || !segundo) {
    return {
      primero: resultadoPrimero.result, segundo: null,
      events: [...resultadoPrimero.events, { type: "PIERCE_STOPS", actorId: actor.id }]
    };
  }

  const penResidual = penetracionResidualTrasAtravesar(primero.penetracion ?? 0, blindajeTotalPrimerObjetivo);
  const resultadoSegundo = resolveIntent(actor, { id: segundo.targetId }, {
    type: "ATTACK",
    tiradaYaResuelta: segundo.tiradaYaResuelta,
    habilidadBase: segundo.habilidadBase,
    dificultad: (segundo.dificultad ?? 0) + ATRAVESAR_PENALIZADOR_SEGUNDO_ATAQUE,
    penetracion: penResidual,
    blindajeObjetivo: segundo.blindajeObjetivo ?? 0,
    coberturaObjetivo: segundo.coberturaObjetivo ?? 0,
    danioBase: segundo.danioBase ?? primero.danioBase
  }, { rng });

  return {
    primero: resultadoPrimero.result, segundo: resultadoSegundo.result,
    events: [
      ...resultadoPrimero.events,
      { type: "PIERCE_CONTINUES", actorId: actor.id, targetId: segundo.targetId, penetracionResidual: penResidual },
      ...resultadoSegundo.events
    ]
  };
}

// ===== C. Combate a dos armas (CAP03:935-943) =====
export const DOS_ARMAS_FUE_MULTIPLICADOR = 1.5;

// CAP03:937 -- "FUE igual o superior a 1,5x la fuerza mínima del arma
// secundaria". Precondición independiente de la división de habilidad.
export function puedeEmpuñarDosArmas(fuerzaActor, fuerzaMinimaArmaSecundaria) {
  return fuerzaActor >= DOS_ARMAS_FUE_MULTIPLICADOR * fuerzaMinimaArmaSecundaria;
}

// ===== Fase 5C: ataque en grupo, pifias/estado de arma, disparo a melé,
// combate sin armas (docs/COMBAT_PHASE5C_CANON.md, docs/COMBAT_PHASE5C_RESULT.md) =====

// ===== A. Ataque en grupo -- regla opcional (CAP03:957-987) =====
export const TAMANO_UNIDAD_GRUPO = 5;
export const PENETRACION_BASE_GRUPO = { ligera: 0, equipada: 1, elite: 2 };

// CAP03:961 -- "la segunda unidad y siguientes suman +1 a su penetración
// por cada unidad adicional más allá de la primera". indiceUnidad: 0 =
// primera unidad, 1 = segunda, etc.
export function penetracionUnidad(penetracionBase, indiceUnidad) {
  return penetracionBase + indiceUnidad;
}

// resolveGroupAttack(actor, units, context) -> {results, events}
// Cada unidad de 5 tira UNA vez (punto 6 del encargo: cada tirada
// reproducible individualmente, nunca una sola tirada estadística) y pasa
// por el MISMO resolverImpacto() que cualquier ataque normal (punto 23:
// "no crear resoluciones paralelas") -- reutiliza exactamente el mismo
// pipeline que resolveMultiAttack(), con la única diferencia de que aquí
// la Penetración crece por unidad en vez de venir fija por parte. NO se
// wireó contra ningún encuentro productivo (docs/COMBAT_PHASE5C_CANON.md,
// bloque A): agrupar a los enemigos existentes en unidades de 5 sería un
// cambio de comportamiento/balance del combate, fuera de alcance de esta
// fase.
export function resolveGroupAttack(actor, units, context = {}) {
  const { rng } = context;
  const events = [{ type: "GROUP_ATTACK_DECLARED", actorId: actor.id, unidades: units.length }];

  const results = units.map((unidad, indice) => {
    const tiradaResultado = unidad.tiradaYaResuelta ?? resolverTirada({
      habilidadBase: unidad.habilidadBase,
      dificultad: unidad.dificultad ?? 0,
      puntoEpicoGastado: false,
      rng
    });
    const penetracion = penetracionUnidad(unidad.penetracionBase ?? 0, indice);
    const impactoResultado = resolverImpacto({
      tirada: tiradaResultado.tirada, exito: tiradaResultado.exito, exitos: tiradaResultado.exitos, esCritico: tiradaResultado.esCritico,
      penetracion, blindajeObjetivo: unidad.blindajeObjetivo ?? 0, coberturaObjetivo: unidad.coberturaObjetivo ?? 0,
      danioBase: unidad.danioBase ?? 1
    });
    events.push({
      type: "GROUP_PARTICIPANT_RESOLVED", actorId: actor.id, unidadIndice: indice, penetracion,
      impacto: impactoResultado.impacto, danio: impactoResultado.danioFinal
    });
    return { unidadIndice: indice, penetracion, ...tiradaResultado, ...impactoResultado };
  });

  events.push({ type: "GROUP_ATTACK_RESOLVED", actorId: actor.id });
  return { results, events };
}

// ===== B. Pifias en combate -- estado runtime de arma (CAP03:1141-1156) =====
// jammed/broken son ESTADO (cambian durante el combate), nunca definición
// -- no viven en weapons.json ni en las copias embebidas de
// characters.json, viven en el runtime del combatiente (miembro.armaEstado/
// enemigo.armaEstado), mismo criterio que miembro.recarga (Fase 4A).
export function estadoArmaInicial() {
  return { jammed: false, broken: false };
}

// Tabla EXACTA de CAP03:1143-1147 -- no se inventa ninguna consecuencia
// nueva. BLOCKED_CANON_QUESTION en el 97 de fuego ("se cae O
// encasquilla"): se modela solo el subconjunto mecánicamente modelable
// (encasquillamiento) -- ver docs/COMBAT_PHASE5C_CANON.md.
export function consecuenciaPifiaFuego(tirada) {
  if (tirada === 99) return "ARMA_INUTILIZADA_COMBATE";
  if (tirada === 98) return "ENCASQUILLAMIENTO_GRAVE";
  if (tirada === 97) return "ENCASQUILLAMIENTO_O_CAIDA";
  return null;
}

// CC: solo el 99 tiene una consecuencia mecánica clara (rotura/pérdida de
// control, ver resolverRoturaArmaCC()) -- 97/98 son puramente narrativos
// (CAP03 no da número ni estado que modelar), documentados, no inventados.
export function consecuenciaPifiaCC(tirada) {
  if (tirada === 99) return "PERDIDA_TOTAL_CONTROL";
  if (tirada === 98) return "VENTAJA_RIVAL_NARRATIVA";
  if (tirada === 97) return "ARMA_DESPLAZADA_NARRATIVA";
  return null;
}

// CAP03:1151-1155 -- el 99 CC solo rompe el arma si es de material
// estándar; material raro/rúnico no se rompe (pérdida de control
// narrada por el DJ en su lugar). Ninguna arma de los datos actuales
// declara "material" -- se asume "estandar" por defecto (ausencia de
// dato = arma ordinaria, no una invención).
export function resolverRoturaArmaCC(materialArma = "estandar") {
  if (materialArma === "raro" || materialArma === "runica") {
    return { rota: false, consecuencia: "PERDIDA_CONTROL_NARRATIVA" };
  }
  return { rota: true, consecuencia: "ROTURA_ESTRUCTURAL" };
}

// CAP03:1152 -- "Si el personaje tiene Armería >= 50, puede intentar
// repararla (1 acción completa, tirada). Con Armería < 50, inutilizada
// hasta taller."
export const ARMERIA_MINIMA_REPARAR_EN_COMBATE = 50;

export function puedeIntentarRepararEnCombate(habilidadArmeria) {
  return habilidadArmeria >= ARMERIA_MINIMA_REPARAR_EN_COMBATE;
}

export function resolverReparacionArma({ habilidadArmeria, dificultad = 0, puntoEpicoGastado = false, rng = Math.random }) {
  const tirada = resolverTirada({ habilidadBase: habilidadArmeria, dificultad, puntoEpicoGastado, rng });
  return { ...tirada, reparada: tirada.exito };
}

// ===== C. Disparar a una melé (CAP03:827-831) =====
export const PENALIZADOR_DISPARO_A_MELE = -20;

// dificultadDisparoAMele({conSelectorBlanco, objetivoTrabadoEnMele}) -> number
// CAP03:829 -- -20 sin selector de blanco contra un objetivo trabado en
// CC; el selector elimina el penalizador (CAP03:821). Se combina con el
// resto de modificadores situacionales del caller antes de pasar por
// limitarModificadorSituacional() (Fase 4B), igual que flanqueo/sorpresa.
export function dificultadDisparoAMele({ conSelectorBlanco, objetivoTrabadoEnMele }) {
  if (!objetivoTrabadoEnMele) return 0;
  if (conSelectorBlanco) return 0;
  return PENALIZADOR_DISPARO_A_MELE;
}

// elegirObjetivoDesviado(meleeParticipantIds, excluirId, rng) -> id | null
// CAP03:829 -- "el Narrador PUEDE hacer que el disparo alcance
// aleatoriamente a otro participante" tras una pifia SIN selector de
// blanco. Explícitamente discrecional ("puede", no "debe") -- esta
// función representa la decisión YA TOMADA del Narrador de aplicar el
// desvío (el caller decide si la invoca); nunca se dispara sola dentro de
// resolveIntent(). `meleeParticipantIds` es contexto semántico puro (sin
// geometría, sin Phaser -- punto 16 del encargo), aportado por el
// renderer/caller.
export function elegirObjetivoDesviado(meleeParticipantIds, excluirId, rng = Math.random) {
  const candidatos = (meleeParticipantIds ?? []).filter(id => id !== excluirId);
  if (candidatos.length === 0) return null;
  const indice = Math.floor(rng() * candidatos.length);
  return candidatos[indice];
}

// ===== Cobertura como posicionamiento (AUTHOR_CLARIFICATION_2026-08-20,
// docs/PREDATOR_COVER_MOVEMENT_MODEL.md) =====
//
// "La cobertura es consecuencia de la POSICIÓN. Si existe una cobertura
// alcanzable dentro del movimiento restante de la actuación, el personaje
// puede moverse hasta ella y quedar cubierto sin gastar una acción
// principal o menor adicional. La cobertura se mantiene mientras el
// personaje permanezca en una posición que la proporcione."
//
// Renderer-agnóstico a propósito (punto 5/6 del encargo): no hay grid, no
// hay coordenadas reales -- `spatialState` es una abstracción semántica
// mínima (`{cover, distanceToCover}`) que cualquier renderer (el actual,
// sin sistema espacial real, o un Phaser futuro con uno de verdad) puede
// alimentar a través de su propio adaptador espacial sin que estas
// funciones necesiten saberlo. Entrar en cobertura NO es un intent nuevo
// -- consume movimiento normal (MOVE, ya existente desde Fase 3), nunca
// una acción principal/menor aparte.
export function coberturaAlcanzableConMovimiento(distanceToCover, movementRemaining) {
  if (distanceToCover == null) return false; // sin cobertura conocida -- null NO es "a 0 metros"
  return distanceToCover <= movementRemaining;
}

// moverHaciaCobertura(spatialState, movementRemaining) -> {spatialState, movimientoUsado}
// Si ya está en cobertura (distanceToCover<=0) no gasta nada. Si la
// cobertura buscada no es alcanzable con el movimiento restante, no
// teletransporta (punto 25 del encargo) -- devuelve el spatialState sin
// cambios y movimientoUsado 0; el caller decide si acercarse parcialmente
// tiene sentido para su propio modelo (esta función no lo asume).
export function moverHaciaCobertura(spatialState, movementRemaining) {
  if (spatialState.cover !== "none" && (spatialState.distanceToCover ?? 0) <= 0) {
    return { spatialState, movimientoUsado: 0 };
  }
  if (!coberturaAlcanzableConMovimiento(spatialState.distanceToCover, movementRemaining)) {
    return { spatialState, movimientoUsado: 0 };
  }
  return {
    spatialState: { ...spatialState, distanceToCover: 0 },
    movimientoUsado: spatialState.distanceToCover
  };
}

// abandonarCobertura(spatialState) -> spatialState
// "La cobertura se pierde cuando abandona esa posición" -- el caller la
// invoca cuando decide mover al actor fuera de la posición protegida. No
// se dispara automáticamente al atacar (a diferencia del
// RENDERER_LEGACY_COVER_PRESENTATION del renderer productivo actual, que
// sigue con el modelo antiguo -- ver docs/PREDATOR_COVER_MODEL_AUDIT.md).
export function abandonarCobertura(spatialState) {
  return { ...spatialState, cover: "none", distanceToCover: null };
}
