// TacticalSession -- estado de combate CANÓNICO de un encuentro (encargo
// TACTICAL_ENGINE_MODULE_CONTRACT, punto 20/23). Deliberadamente separado
// del estado espacial (posiciones, que vive en su propio objeto
// `positions` plano aquí, NO en el SpatialCombatAdapter -- el adapter es
// una vista/servicio derivado, reconstruible desde `session.positions` +
// `session.obstacles`, nunca la fuente de verdad) y del estado de
// render/Phaser (sprites, tweens, texturas -- eso vive solo en
// TacticalScene.js, y nunca se serializa, punto 23).
//
// No es una clase por consistencia con el resto del sandbox
// (createSpatialCoverAdapter, createActivation, etc. son factories, no
// clases) -- un objeto plano con métodos es suficiente y es trivialmente
// serializable (a diferencia de una instancia de clase con prototipo).

import { conDefaults } from "../contracts/TacticalEncounterDefinition.js";
import { evaluarObjetivos } from "./objectives.js";

function clonarActorRuntime(actorDef) {
  return {
    ...structuredClone(actorDef),
    armaActiva: "primaria",
    recargaProgreso: null,
    estadoDisponibilidad: "disponible",
    efectoEvasivo: null,
    exitosDefensaPendiente: 0,
    esquivaTotalActiva: false,
    _posicionado: false
  };
}

/**
 * Crea una TacticalSession NUEVA a partir de una definición YA VALIDADA
 * (ver TacticalEncounterLoader.js -- este módulo no valida, asume que el
 * loader ya lo hizo; fail-fast ocurre antes de llegar aquí).
 */
export function crearTacticalSession(definicion) {
  const def = conDefaults(definicion);
  const party = def.actors.party.map(clonarActorRuntime);
  const enemies = def.actors.enemies.map(clonarActorRuntime);
  const positions = {};
  for (const a of [...party, ...enemies]) positions[a.id] = { x: a.x, y: a.y };

  return {
    schemaVersion: def.schemaVersion,
    encounterId: def.id,
    objectivesDef: def.objectives,
    transitionsDef: def.transitions,
    aiDef: def.ai,
    battlefieldMeters: { width: def.battlefield.widthMeters, height: def.battlefield.heightMeters },
    coverRadiusMeters: def.battlefield.coverRadiusMeters,
    obstacles: def.battlefield.obstacles,
    party, enemies,
    positions,
    activations: new Map(),
    round: 0,
    orden: [],
    resultado: null,
    controlMode: null,
    currentActorId: null,
    targetActorId: null,

    configDe(actorId) { return [...this.party, ...this.enemies].find(a => a.id === actorId); },
    esParty(actorId) { return this.party.some(p => p.id === actorId); },
    vivos(lista) { return lista.filter(a => a.estadoDisponibilidad === "disponible"); },

    esControladoPorJugador(actorId) {
      if (!this.esParty(actorId)) return false;
      if (this.controlMode === "manual") return true;
      if (this.controlMode === "pj_manual") return this.configDe(actorId).esPJ === true;
      return false; // "auto"
    },

    // Bookkeeping local de pools de vida (sano->herido->tullido) -- ver
    // docs/PHASER_TACTICAL_VERTICAL_SLICE.md, "Reutilización de
    // gameState.js": esto NO es una fórmula QS, es persistencia de
    // runtime propio; nivelHeridaDe()/penalizadorPorNivel() (reales, vía
    // el bridge) siguen siendo la única fuente de verdad sobre qué
    // SIGNIFICA el resultado de estos pools.
    aplicarDanioLocal(actorId, danio) {
      const actor = this.configDe(actorId);
      if (!actor || !Number.isFinite(danio) || danio <= 0) return false;
      let restante = danio;
      for (const nivel of ["sano", "herido", "tullido"]) {
        if (restante <= 0) break;
        const consumido = Math.min(actor.vidaActual[nivel], restante);
        actor.vidaActual[nivel] -= consumido;
        restante -= consumido;
      }
      const vidaRestante = actor.vidaActual.sano + actor.vidaActual.herido + actor.vidaActual.tullido;
      const down = restante > 0 || vidaRestante <= 0;
      if (down) actor.estadoDisponibilidad = this.esParty(actorId) ? "inconsciente" : "muerto";
      return down;
    },

    // Evalúa objectivesDef contra el estado actual y actualiza
    // this.resultado si el encuentro ha terminado. Devuelve true si
    // terminó (igual que _comprobarFinDeCombate() en la escena anterior).
    comprobarFinDeCombate() {
      if (this.resultado) return true; // ya terminado (p.ej. por declararHuida()) -- no se reevalúa
      const resultado = evaluarObjetivos(this, this.objectivesDef);
      if (resultado) this.resultado = resultado;
      return !!resultado;
    },

    moverActor(actorId, x, y) {
      this.positions[actorId] = { x, y };
    },

    // Huida (Production Integration Phase 3.5,
    // docs/TACTICAL_PRODUCTION_PHASE35.md): a diferencia de
    // victory/defeat (evaluados automáticamente por
    // comprobarFinDeCombate() a partir del estado de los actores),
    // "huida" es un outcome DECLARADO -- alguien (jugador o IA) elige
    // huir a mitad de combate, no se deduce de contar supervivientes.
    // Genérico: cualquier encuentro puede llamarlo, ninguna lógica de
    // ningún módulo concreto vive aquí. No sobreescribe un resultado ya
    // fijado (mismo criterio que comprobarFinDeCombate(), que tampoco
    // reevalúa un encuentro ya terminado).
    declararHuida() {
      if (this.resultado) return false;
      this.resultado = "huida";
      return true;
    },

    // ===== Serialización (punto 21/22/23) =====
    // Excluye deliberadamente cualquier cosa relacionada con Phaser
    // (sprites/tweens/texturas) -- esta función nunca ha tenido acceso a
    // eso, vive fuera de TacticalScene.js por diseño.
    serialize() {
      return {
        schemaVersion: this.schemaVersion,
        encounterId: this.encounterId,
        objectivesDef: this.objectivesDef,
        transitionsDef: this.transitionsDef,
        aiDef: this.aiDef,
        battlefieldMeters: this.battlefieldMeters,
        coverRadiusMeters: this.coverRadiusMeters,
        obstacles: this.obstacles,
        party: this.party,
        enemies: this.enemies,
        positions: this.positions,
        activations: Object.fromEntries(this.activations),
        round: this.round,
        orden: this.orden,
        resultado: this.resultado,
        controlMode: this.controlMode,
        currentActorId: this.currentActorId,
        targetActorId: this.targetActorId
      };
    }
  };
}

/**
 * Reconstruye una TacticalSession desde el objeto plano devuelto por
 * serialize() (típicamente tras un JSON.stringify/parse -- punto 22:
 * "sin pérdida relevante"). No revalida contra el contrato (ya se validó
 * al crear la sesión original) -- reconstruye tal cual.
 */
export function deserializeTacticalSession(datos) {
  const session = crearTacticalSession({
    schemaVersion: datos.schemaVersion,
    id: datos.encounterId,
    battlefield: { widthMeters: datos.battlefieldMeters.width, heightMeters: datos.battlefieldMeters.height, coverRadiusMeters: datos.coverRadiusMeters, obstacles: datos.obstacles },
    actors: { party: [], enemies: [] }, // se sobreescriben abajo -- clonarActorRuntime ya no aplica (los runtime ya vienen completos)
    objectives: datos.objectivesDef,
    transitions: datos.transitionsDef,
    ai: datos.aiDef
  });
  session.party = structuredClone(datos.party);
  session.enemies = structuredClone(datos.enemies);
  session.positions = structuredClone(datos.positions);
  session.activations = new Map(Object.entries(datos.activations));
  session.round = datos.round;
  session.orden = structuredClone(datos.orden);
  session.resultado = datos.resultado;
  session.controlMode = datos.controlMode;
  session.currentActorId = datos.currentActorId;
  session.targetActorId = datos.targetActorId;
  return session;
}
