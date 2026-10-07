import Phaser from "../../vendor/phaser/phaser.esm.min.js";
import { loadTacticalEncounter } from "../core/TacticalEncounterLoader.js";
import { construirTacticalResult } from "../core/result.js";
import { crearEscala } from "./scale.js";
import { createSpatialCombatAdapter } from "../spatial/SpatialCoverAdapter.js";
import {
  createActivation, movementRemaining, actuacionAgotada, nivelHeridaDe, ordenDeActuacion
} from "../bridge/qsRulesBridge.js";
import { armaActivaDe, municionArmaActivaDe } from "../bridge/qsDataAdapter.js";
import { decidirAccion } from "../ai/tacticalAI.js";
import { resolverPerfilIA } from "../ai/aiProfiles.js";
import { detectaTouch } from "./responsive.js";
import { crearControladorAcciones } from "./tacticalActionController.js";
import { construirSnapshotUI } from "./tacticalUIState.js";
import { montarInterfazResponsive } from "./tacticalResponsiveUI.js";
import { config } from "../../config.js";
import { rutaAsset } from "../../engine/moduleLoader.js";

const LIMITE_RONDAS = 30; // salvaguarda -- evita bucle infinito si nadie puede ya herir a nadie (unresolved)
const SALVAGUARDA_DECISIONES_IA = 8; // igual límite que ejecutarActuacionParty() en tools/predatorBalanceSimPost5c.mjs (JUEGO_QS)
const NIVEL_COLOR = { none: 0x5c6b5c, partial: 0xffe27a, solid: 0xff9d4d, total: 0xff4d4d };

// TacticalScene -- motor táctico GENÉRICO (encargo TACTICAL_ENGINE_MODULE_CONTRACT).
// Extraído de PredatorTacticalScene.js (docs/TACTICAL_ENGINE_EXTRACTION_AUDIT.md):
// la lógica en sí ya era genérica -- lo que se extrajo fue el ACOPLAMIENTO a
// datos concretos de Predator (imports directos, condición de fin de
// combate escrita como código, nombres de personajes en strings de UI).
//
// Recibe TODO lo que necesita vía `scene.start("TacticalScene",
// { definition })` -- ver docs/TACTICAL_ENCOUNTER_CONTRACT.md. No conoce
// Predator, ni ningún otro módulo, ni nombres de personajes concretos:
// itera sobre `session.party`/`session.enemies` (arrays de tamaño
// arbitrario) y sobre `session.obstacles` (definidos por el encuentro).
//
// Reparto de responsabilidades sin cambios respecto al Vertical Slice
// (docs/SHARED_RULES_BRIDGE.md, docs/SPATIAL_COVER_ADAPTER.md): el
// Spatial Adapter solo clasifica espacio, el bridge solo re-exporta
// reglas reales, esta escena solo orquesta input/representación y
// bookkeeping de runtime (vía TacticalSession) -- nunca reimplementa una
// fórmula de reglas.
export class TacticalScene extends Phaser.Scene {
  constructor() {
    super("TacticalScene");
  }

  // Phaser scene.init(data) -- recibido de scene.start("TacticalScene", { definition })
  init(data) {
    this._definitionEntrante = data?.definition;
    this._cadenciaDataEntrante = data?.cadenciaData ?? {};
  }

  preload() {
    const battlefield = this._definitionEntrante?.assets?.battlefield;
    if (battlefield) this.load.image("tactical-battlefield", rutaAsset(battlefield));
    const sceneAssets = this._definitionEntrante?.assets?.scene ?? {};
    if (sceneAssets.floor) this.load.image("tactical-scene-floor", rutaAsset(sceneAssets.floor));
    for (const category of ["walls", "props", "terrain"]) {
      for (const [assetId, archivo] of Object.entries(sceneAssets[category] ?? {})) {
        this.load.image(`tactical-scene-${category}-${assetId}`, rutaAsset(archivo));
      }
    }
    for (const [exitId, states] of Object.entries(sceneAssets.exits ?? {})) {
      for (const [stateId, archivo] of Object.entries(states ?? {})) {
        this.load.image(`tactical-scene-exit-${exitId}-${stateId}`, rutaAsset(archivo));
      }
    }
    for (const [actorId, recurso] of Object.entries(this._definitionEntrante?.assets?.actors ?? {})) {
      const states = typeof recurso === "string" ? { idle: recurso } : recurso;
      for (const [stateId, archivo] of Object.entries(states ?? {})) {
        this.load.image(`tactical-actor-${actorId}-${stateId}`, rutaAsset(archivo));
      }
    }
  }

  create() {
    const { definition, session } = loadTacticalEncounter(this._definitionEntrante);
    this.definition = definition;
    this.session = session;
    this._inicializarSistemaCoordenadas(definition, session);

    this.physics.world.setBounds(0, 0, this.mundoPx.width, this.mundoPx.height);
    this.cameras.main.setBounds(0, 0, this.mundoPx.width, this.mundoPx.height);
    this.cameras.main.setBackgroundColor("#101014");
    this.cameras.main.setZoom(1);
    this.cameras.main.centerOn(this.mundoPx.width / 2, this.mundoPx.height / 2);

    this.rng = Math.random; // RNG inyectable real (docs/SHARED_RULES_BRIDGE.md, "RNG") -- tests/Playwright lo sobrescriben
    this._debugSpatial = config.debug.showTacticalSpatial;
    this.touch = detectaTouch();
    this._modoMover = false;
    this._debugUltimoAtaque = null;
    this._pausado = false;
    this._limiteRondasExtra = 0; // ver reanudarTrasLimiteRondas()

    this.adapter = createSpatialCombatAdapter({
      actors: [...session.party, ...session.enemies].map(a => ({ id: a.id, ...session.positions[a.id] })),
      obstacles: session.obstacles,
      coverRadius: session.coverRadiusMeters
    });

    // Controlador de acciones compartido (Production Integration Phase 6B,
    // docs/TACTICAL_PRODUCTION_PHASE6_AUDIT.md §5) -- única ruta de
    // mutación de la simulación; TacticalScene solo decide qué pintar en
    // respuesta. `rng` se envuelve (no se pasa this.rng directamente) para
    // que los overrides de tests/Playwright hechos DESPUÉS de create()
    // (this.rng = fn) sigan surtiendo efecto.
    this.controlador = crearControladorAcciones({
      session: this.session, adapter: this.adapter, rng: (...args) => this.rng(...args),
      cadenciaData: this._cadenciaDataEntrante,
      terrainZones: definition.battlefield.terrainZones,
      terrainConfig: definition.battlefield.terrainConfig,
      callbacks: {
        log: (msg) => this._log(msg),
        onAtaqueResuelto: (detalle) => {
          this._debugUltimoAtaque = detalle;
          this._fxDisparo(detalle.attacker, detalle.target, detalle.impacto, detalle);
        },
        onRechazo: (detalle) => {
          this._debugUltimoAtaque = { ...detalle, rechazado: true };
          this._fxRechazo(detalle.target);
          this._redibujarOverlay();
        },
        onEstadoCambiado: () => this._sincronizarPresentacion()
      }
    });

    this._grid();
    this._pintarObstaculos();
    this._pintarActores();
    this._crearInput();
    this._crearHud();
    this._crearPanelAcciones();
    this._crearOverlayDebug();
    this._crearSelectorModo();
    if (config.tactical.responsiveUI) this._montarInterfazResponsive();

    this.game.registry.set("sceneName", "TacticalScene");
    this.game.registry.set("tacticalEncounterId", session.encounterId);
    // Production Integration Phase 5 (docs/TACTICAL_PRODUCTION_PHASE5.md,
    // punto 12): TacticalScene NUNCA navega por su cuenta -- ni
    // cargarEscena(), ni aplicarConsecuencias(), ni saltos a otra escena
    // Phaser. Se quitó el atajo ESC->MenuScene del sandbox (MenuScene era
    // navegación de desarrollo, no existe en producción). Solo el
    // debug toggle (tecla C) sobrevive -- no navega, solo redibuja.
    this.input.keyboard.on("keydown-C", () => { this._debugSpatial = !this._debugSpatial; this._redibujarOverlay(); });

    // Lifecycle (punto 24): limpieza explícita al destruir la escena --
    // Phaser ya destruye GameObjects/tweens propios de la escena solo,
    // pero los listeners de teclado y cualquier referencia cruzada
    // (this.adapter, this.session) se liberan aquí explícitamente para no
    // dejar closures colgando entre encuentros sucesivos.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._destruirEncuentro());

    this._log("Elige un modo de control para empezar el combate.");
  }

  // Punto de extensión (Production Integration Phase 6C,
  // docs/TACTICAL_PRODUCTION_PHASE6C_SPIKE.md): TacticalSceneOblicua
  // sobreescribe SOLO este método (más los de presentación pura de más
  // abajo) para sustituir la proyección cenital lineal por la
  // isométrica -- ninguna otra línea de create() cambia entre ambos
  // renderers.
  _inicializarSistemaCoordenadas(definition, session) {
    this.escala = crearEscala(definition.battlefield.metersToPx);
    this.mundoPx = { width: this.escala.px(session.battlefieldMeters.width), height: this.escala.px(session.battlefieldMeters.height) };
  }

  // ===== Lifecycle (punto 24) =====

  pausarEncuentro() {
    this._pausado = true;
    this._actualizarPanelAcciones();
  }

  reanudarEncuentro() {
    this._pausado = false;
    this._actualizarPanelAcciones();
  }

  _destruirEncuentro() {
    this.input.keyboard.removeAllListeners();
    this.tweens.killAll();
    this.time.removeAllEvents();
    this._interfazResponsiveHandle?.destroy();
    this._interfazResponsiveHandle = null;
    this.adapter = null;
    this.session = null;
    this.definition = null;
  }

  // ===== Interfaz DOM responsive (Production Integration Phase 6B,
  // docs/TACTICAL_PRODUCTION_PHASE6_AUDIT.md §5) -- bandera de desarrollo,
  // `config.tactical.responsiveUI`. Se monta como hermana del <canvas> de
  // Phaser (mismo #tactical-root), nunca dibuja sobre el canvas ni compite
  // por su input. =====

  _montarInterfazResponsive() {
    const rootEl = this.game.canvas?.parentElement;
    if (!rootEl) return; // sin DOM real (entorno de test sin canvas) -- no monta nada, no falla
    this._interfazResponsiveHandle = montarInterfazResponsive(rootEl, this);
  }

  // Puente mínimo para la UI DOM (no reimplementa reglas, solo alterna el
  // mismo flag que ya usaba el botón [Mover] de Phaser).
  alternarModoMover() {
    this._modoMover = !this._modoMover;
    this._intencionVisual = null;
    this._actualizarRejillaMovimiento?.();
    this._log(this._modoMover ? "Modo mover activo -- toca una casilla del tablero." : "Modo mover desactivado.");
    this._actualizarPanelAcciones();
    this._emitirEstadoUI();
  }

  // Resultado serializable del encuentro -- nunca incluye objetos Phaser.
  // Disponible en cualquier momento; `outcome` es null mientras el
  // combate sigue en curso. Production Integration Phase 5 (ADAPT, ver
  // docs/TACTICAL_PRODUCTION_PHASE5_AUDIT.md): el sandbox traducía
  // resultado->outcome/transition con una tabla inline propia, escrita
  // antes de que existiera el modelo de outcome genérico de Phase 3.5
  // (que además de victory/defeat/flee sabe resolver `{resolver:"module"}`
  // sin decidir la consecuencia). Se sustituye por construirTacticalResult()
  // (src/tactical/core/result.js, P3.5, sin reimplementar) para no tener
  // dos traducciones de outcome divergentes en producción.
  obtenerResultadoEncuentro() {
    return construirTacticalResult(this.session, this.definition.transitions);
  }

  // ===== Selector de modo (genérico -- nombres de actores leídos de session, no hardcoded) =====

  _crearSelectorModo() {
    if (config.tactical.responsiveUI) return;
    // CORRECCIÓN (verificación E2E de playtest, 2026-08-21): este grupo
    // es scrollFactor(0) -- pantalla fija, sus coordenadas son las del
    // VIEWPORT de la cámara, no las del mundo. Usar `mundoPx` (tamaño
    // del mundo lógico) en vez de `cameras.main.width/height` (tamaño
    // real del viewport) solo coincidía por casualidad cuando ambos
    // números eran iguales -- deja de serlo en cuanto el mundo es más
    // grande o pequeño que el canvas real (típico en móvil, y en el
    // renderer oblicuo con su proporción 2:1). Mismo criterio aplicado
    // en _crearHud()/_crearPanelAcciones() más abajo.
    const anchoViewport = this.cameras.main.width, altoViewport = this.cameras.main.height;
    const cx = anchoViewport / 2, cy = altoViewport / 2;
    const nombresParty = this.session.party.map(p => p.nombre).join(", ");
    const pj = this.session.party.find(p => p.esPJ) ?? this.session.party[0];

    // CORRECCIÓN (encargo de cierre vertical, 2026-08-22 -- diagnóstico
    // real de playtest): un modal de tamaño fijo (560×260) se recortaba
    // en viewports móviles estrechos (390px), dejando la opción "PJ
    // MANUAL" -- la que corrige el Hallazgo 1 -- parcialmente fuera de
    // pantalla e ilegible. Ancho clamp al viewport real, texto con
    // `wordWrap` (puede envolver a varias líneas en móvil) y el modal
    // se apila con la altura REAL medida de cada línea, no un paso fijo
    // -- mismo criterio ya usado en HUD/panel/acciones de esta escena.
    const anchoModal = Math.min(560, anchoViewport - 24);
    const anchoTexto = anchoModal - 24;
    const fontSize = anchoViewport < 420 ? "12px" : "14px";

    this._selectorGroup = this.add.container(0, 0).setDepth(100).setScrollFactor(0);
    const titulo = this.add.text(cx, 0, "MODO DE CONTROL", { fontFamily: "monospace", fontSize: "18px", color: "#e8e8e8", align: "center" }).setOrigin(0.5, 0);

    const opciones = [
      { modo: "manual", label: `[ MANUAL — controlas a ${nombresParty} ]` },
      { modo: "pj_manual", label: `[ PJ MANUAL — solo ${pj.nombre}; resto en automático ]` },
      { modo: "auto", label: "[ AUTOMÁTICO — todo el party en automático ]" }
    ];
    const textos = opciones.map(o => {
      const texto = this.add.text(cx, 0, o.label, {
        fontFamily: "monospace", fontSize, color: "#9fffb0", backgroundColor: "#111318",
        padding: { x: 12, y: 6 }, align: "center", wordWrap: { width: anchoTexto - 24 }
      }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      texto.on("pointerover", () => texto.setColor("#ffe27a"));
      texto.on("pointerout", () => texto.setColor("#9fffb0"));
      texto.on("pointerdown", () => this._iniciarCombate(o.modo));
      return texto;
    });

    const gap = 14;
    let alturaContenido = titulo.height + gap;
    for (const t of textos) alturaContenido += t.height + gap;
    const altoModal = Math.min(alturaContenido + 30, altoViewport - 24);
    const fondo = this.add.rectangle(cx, cy, anchoModal, altoModal, 0x0a0a0c, 0.92).setStrokeStyle(2, 0x3a3f4a);

    let y = cy - altoModal / 2 + 16;
    titulo.setPosition(cx, y); y += titulo.height + gap;
    for (const t of textos) { t.setPosition(cx, y); y += t.height + gap; }

    this._selectorGroup.add([fondo, titulo, ...textos]);
  }

  _iniciarCombate(modo) {
    this.session.controlMode = modo;
    this._selectorGroup?.destroy();
    this._log(`Modo: ${modo}. Comienza el combate.`);
    this._generarOrden();
    this._avanzarTurno();
  }

  // ===== Representación =====

  _grid() {
    const g = this.add.graphics().setDepth(0);
    g.lineStyle(1, 0x22252b, 1);
    const { width: wM, height: hM } = this.session.battlefieldMeters;
    for (let x = 0; x <= wM; x += 1) g.lineBetween(this.escala.px(x), 0, this.escala.px(x), this.mundoPx.height);
    for (let y = 0; y <= hM; y += 1) g.lineBetween(0, this.escala.px(y), this.mundoPx.width, this.escala.px(y));
  }

  _pintarObstaculos() {
    this.obstacleGraphics = this.add.graphics().setDepth(3);
    const colorPorTipo = { partial: 0xb08b3a, solid: 0x8a6d3a, total: 0x555b66 };
    for (const o of this.session.obstacles) {
      this.obstacleGraphics.fillStyle(colorPorTipo[o.type], o.type === "total" ? 0.95 : 0.75);
      this.obstacleGraphics.fillRect(this.escala.px(o.x), this.escala.px(o.y), this.escala.px(o.width), this.escala.px(o.height));
      this.obstacleGraphics.lineStyle(2, 0x000000, 0.6);
      this.obstacleGraphics.strokeRect(this.escala.px(o.x), this.escala.px(o.y), this.escala.px(o.width), this.escala.px(o.height));
      const cx = this.escala.px(o.x + o.width / 2), cy = this.escala.px(o.y + o.height / 2);
      this.add.text(cx, cy, `${o.nombre ?? o.id}\n[${o.type}]`, { fontFamily: "monospace", fontSize: "11px", color: "#e8e8e8", align: "center" }).setOrigin(0.5).setDepth(4);
    }
  }

  _pintarActores() {
    this.actorSprites = new Map();
    for (const a of [...this.session.party, ...this.session.enemies]) {
      const esEnemigo = !this.session.esParty(a.id);
      const pos = this.session.positions[a.id];
      const circle = this.add.circle(this.escala.px(pos.x), this.escala.px(pos.y), 12, a.color ?? (esEnemigo ? 0xff6b6b : 0x9fffb0)).setDepth(10).setInteractive({ useHandCursor: true });
      circle.setStrokeStyle(2, esEnemigo ? 0x3a0d0d : 0x0d3a1a);
      const estadosTextura = { idle: `tactical-actor-${a.id}-idle`, hurt: `tactical-actor-${a.id}-hurt`, down: `tactical-actor-${a.id}-down` };
      const claveTextura = Object.values(estadosTextura).find(key => this.textures.exists(key));
      const token = claveTextura ? this.add.image(this.escala.px(pos.x), this.escala.px(pos.y) + 5, claveTextura).setDisplaySize(38, 48).setOrigin(.5, .85).setDepth(10) : null;
      if (token) circle.setFillStyle(a.color ?? (esEnemigo ? 0xff6b6b : 0x9fffb0), .18).setDepth(9);
      const label = this.add.text(this.escala.px(pos.x), this.escala.px(pos.y) - 22, a.nombre, { fontFamily: "monospace", fontSize: "11px", color: esEnemigo ? "#ff9d9d" : "#dfffe4" }).setOrigin(0.5).setDepth(11);
      const vida = this.add.text(this.escala.px(pos.x), this.escala.px(pos.y) + 16, "", { fontFamily: "monospace", fontSize: "9px", color: "#cccccc" }).setOrigin(0.5).setDepth(11);
      circle.on("pointerdown", () => this._onActorClicked(a.id));
      this.actorSprites.set(a.id, { circle, token, label, vida, esEnemigo, estadosTextura });
    }
    this._actualizarSpritesVida();
  }

  _reposicionarSprite(actorId) {
    const pos = this.session.positions[actorId];
    const { circle, token, label, vida } = this.actorSprites.get(actorId);
    circle.setPosition(this.escala.px(pos.x), this.escala.px(pos.y));
    token?.setPosition(this.escala.px(pos.x), this.escala.px(pos.y) + 5);
    label.setPosition(this.escala.px(pos.x), this.escala.px(pos.y) - 22);
    vida.setPosition(this.escala.px(pos.x), this.escala.px(pos.y) + 16);
  }

  _actualizarSpritesVida() {
    for (const a of [...this.session.party, ...this.session.enemies]) {
      const sprite = this.actorSprites.get(a.id);
      const abajo = a.estadoDisponibilidad !== "disponible";
      sprite.circle.setAlpha(abajo ? 0.3 : 1);
      if (sprite.token && sprite.estadosTextura) {
        const estadoVisual = abajo ? "down" : nivelHeridaDe(a) === "sano" ? "idle" : "hurt";
        const key = sprite.estadosTextura[estadoVisual];
        if (key && this.textures.exists(key)) sprite.token.setTexture(key);
      }
      sprite.token?.setAlpha(abajo ? 0.28 : 1);
      sprite.label.setAlpha(abajo ? 0.4 : 1);
      const nivel = nivelHeridaDe(a);
      const vidaVisible = sprite.esEnemigo ? a.vidaActual.sano : a.vidaActual[nivel];
      sprite.vida.setText(abajo ? "ABAJO" : `${vidaVisible} PV · ${nivel.toUpperCase()}`);
      sprite.vida.setColor(nivel === "tullido" ? "#ff4d4d" : nivel === "herido" ? "#ffe27a" : "#cccccc");
    }
  }

  // ===== Input =====

  _crearInput() {
    this.input.on("pointerdown", (pointer) => {
      if (pointer.y < 150) return; // zona reservada al HUD/panel superior
      const objetivo = this.input.hitTestPointer(pointer)[0];
      if (objetivo) return; // los actores se gestionan en _onActorClicked
      if (this._modoMover) this._accionMoverA(this.escala.metros(pointer.worldX), this.escala.metros(pointer.worldY));
    });
  }

  _onActorClicked(actorId) {
    if (actorId === this.session.currentActorId && this.session.esParty(actorId) && this.session.esControladoPorJugador(actorId)) {
      // El canvas cierra menús al terminar cualquier pointerdown. Abrir en
      // microtarea hace que el clic contextual gane después de ese cierre.
      queueMicrotask(() => this._interfazResponsiveHandle?.openActions());
      return;
    }
    this.seleccionarObjetivo(actorId);
  }

  seleccionarObjetivo(actorId) {
    if (this._pausado || !this.session.currentActorId || !this.session.esControladoPorJugador(this.session.currentActorId)) return;
    const actor = this.session.configDe(actorId);
    if (actor.estadoDisponibilidad !== "disponible") return;
    if (this.session.esParty(actorId)) return; // no se "selecciona" a otro compañero -- el turno ya fija el actor activo
    this.session.targetActorId = actorId;
    this._log(`Objetivo: ${actorId}.`);
    this._redibujarOverlay();
    this._actualizarHud();
    this._actualizarPanelAcciones();
    this._emitirEstadoUI();
  }

  // Estado efímero de presentación. La UI comunica qué acción prepara para
  // que el tablero haga visibles sus relaciones espaciales. Nunca se
  // serializa ni interviene en validateIntent()/Rules Engine.
  actualizarIntencionVisual(intencion) {
    this._intencionVisual = intencion ? structuredClone(intencion) : null;
    this._redibujarOverlay();
  }

  // ===== Turnos =====

  _generarOrden() {
    const s = this.session;
    s.round += 1;
    const combatientes = [
      ...s.vivos(s.party).map(m => ({ id: m.id, iniciativa: m.habilidadDisparo })),
      ...s.vivos(s.enemies).map(e => ({ id: e.id, iniciativa: e.habilidadDisparo }))
    ];
    s.orden = ordenDeActuacion(combatientes);
    this._log(`Ronda ${s.round}. Orden de actuación generado (${s.orden.length} eventos).`);
  }

  _avanzarTurno() {
    const s = this.session;
    if (s.resultado) return;
    if (s.comprobarFinDeCombate()) { this._mostrarResultado(); return; }
    // CORRECCIÓN (encargo de sesión, 2026-08-21): el límite de rondas es
    // una SALVAGUARDA de simulación (evita que auto-vs-auto se quede
    // dando vueltas para siempre), no un final. `_limiteRondasExtra` se
    // amplía desde reanudarTrasLimiteRondas() cuando el jugador elige
    // "resolver 30 rondas más" -- nunca se reinicia `s.round` ni ningún
    // otro dato de la sesión. Se excluye el modo manual: si ya hay un
    // jugador real al mando (tras elegir "Continuar manualmente"), la
    // salvaguarda no debe reactivarse ronda a ronda -- si lo hiciera,
    // el aviso de pausa reaparecería de inmediato en cuanto se reanuda,
    // porque `s.round` sigue por encima del límite y nada lo baja.
    if (s.controlMode !== "manual" && s.round > LIMITE_RONDAS + this._limiteRondasExtra) { s.resultado = "unresolved"; this._mostrarResultado(); return; }

    if (s.orden.length === 0) { this._generarOrden(); if (s.orden.length === 0) { s.resultado = "unresolved"; this._mostrarResultado(); return; } }

    const evento = s.orden.shift();
    const actor = s.configDe(evento.id);
    if (!actor || actor.estadoDisponibilidad !== "disponible") { this._avanzarTurno(); return; }

    s.currentActorId = actor.id;
    s.targetActorId = null;
    this._modoMover = false;
    this._actualizarRejillaMovimiento?.();
    actor.efectoEvasivo = null; // expira al empezar la siguiente actuación del propio actor
    s.activations.set(actor.id, createActivation({ actorId: actor.id, round: s.round, activationIndex: s.round }));

    if (s.esControladoPorJugador(actor.id)) {
      this._log(`Turno de ${actor.nombre} (manual). Elige una acción.`);
      this._actualizarPanelAcciones();
      this._actualizarHud();
      this._redibujarOverlay();
      this._emitirEstadoUI();
    } else {
      this._log(`Turno de ${actor.nombre} (IA)...`);
      this._procesarActuacionIA(actor);
      this._avanzarTurno();
    }
  }

  _perfilIAPara(actor) {
    const rol = this.session.esParty(actor.id) ? "companions" : "enemies";
    return resolverPerfilIA(this.session.aiDef[rol]);
  }

  _procesarActuacionIA(actor) {
    const s = this.session;
    let salvaguarda = 0;
    while (!actuacionAgotada(s.activations.get(actor.id)) && salvaguarda < SALVAGUARDA_DECISIONES_IA) {
      salvaguarda += 1;
      const activation = s.activations.get(actor.id);
      const opuestos = s.esParty(actor.id) ? s.vivos(s.enemies) : s.vivos(s.party);
      const decision = decidirAccion({
        actor, activation, movementRemaining: movementRemaining(activation),
        nivelHerida: nivelHeridaDe(actor), candidatosVivos: opuestos, spatialAdapter: this.adapter,
        perfil: this._perfilIAPara(actor)
      });
      if (decision.type === "END") break;
      this._ejecutarDecisionIA(actor, decision);
    }
  }

  _ejecutarDecisionIA(actor, decision) {
    this.session.currentActorId = actor.id; // asegura que las acciones compartidas operen sobre el actor correcto
    switch (decision.type) {
      case "MOVE_TO_COVER": {
        actor._posicionado = true;
        const destino = this.adapter.puntoDeAcercamiento(actor.id, decision.obstacleId);
        this._accionMoverA(destino.x, destino.y);
        break;
      }
      case "EVASIVE_MOVEMENT": this._accionEvasion(); break;
      case "CHANGE_WEAPON": this._accionCambiarArma(); break;
      case "ATTACK": this.session.targetActorId = decision.targetId; this._accionAtacar(decision.targetId, { cc: false }); break;
      case "ATTACK_CC": this.session.targetActorId = decision.targetId; this._accionAtacar(decision.targetId, { cc: true }); break;
      case "RELOAD": this._accionRecargar(); break;
      default: break;
    }
  }

  // Rotulado visual del resultado (ADAPT, Phase 5): el sandbox solo
  // conocía "victoria"/"derrota" (anterior a Phase 3.5) -- se añade
  // "huida" sin tocar el vocabulario interno de TacticalSession
  // (sigue siendo español, mismo que objectives.js/declararHuida()).
  _mostrarResultado() {
    const s = this.session;
    const TEXTOS = { victoria: "VICTORIA", derrota: "DERROTA", huida: "HUIDA" };
    const COLORES = { victoria: "#9fffb0", derrota: "#ff4d4d", huida: "#ffe27a" };
    const texto = TEXTOS[s.resultado] ?? "COMBATE PAUSADO (30 rondas automáticas sin resolverse)";
    const color = COLORES[s.resultado] ?? "#ffe27a";
    // Referencias guardadas -- si el combate sigue "sin resolver"
    // (s.resultado==="unresolved"), reanudarTrasLimiteRondas() las
    // retira al reanudar (nunca queda un rótulo de pausa fantasma
    // encima del tablero tras continuar). Para un final real
    // (victoria/derrota/huida) el motor se destruye justo después, así
    // que no hace falta limpiarlas -- se descartan con el resto.
    const rect = this.add.rectangle(this.mundoPx.width / 2, this.mundoPx.height / 2, 420, 100, 0x000000, 0.85).setDepth(200);
    const label = this.add.text(this.mundoPx.width / 2, this.mundoPx.height / 2, texto, { fontFamily: "monospace", fontSize: "22px", color }).setOrigin(0.5).setDepth(201);
    this._overlayResultado = { rect, label };
    this._log(`Combate terminado: ${texto}`);
    this._actualizarPanelAcciones();
    this._emitirEstadoUI();
    // Production Integration Phase 5 (punto 11 del encargo, "esperar
    // outcome"): única señal que el renderer necesita para saber que el
    // combate terminó -- se emite SIEMPRE que se llega aquí, incluido el
    // caso "unresolved" (límite de rondas), cuyo TacticalResult tendrá
    // outcome=null (ningún outcome de negocio real que resolver, ver
    // construirTacticalResult()) para que el renderer no se quede
    // esperando indefinidamente.
    this.events.emit("tactical-encounter-result", this.obtenerResultadoEncuentro());
  }

  // Reanuda un combate pausado por el límite de rondas (encargo de
  // sesión, 2026-08-21: "outcome===null... no es un final narrativo,
  // significa únicamente que el combate automático sigue sin
  // resolverse"). Llamado por tacticalPhaserRenderer.js DESPUÉS de que
  // el jugador elige "continuar manualmente" o "resolver 30 rondas
  // más" en el aviso no definitivo -- nunca se llama sin esa decisión
  // explícita. No reinicia nada: combatientes, heridas, posiciones,
  // munición y ronda quedan exactamente como estaban; solo se retira el
  // rótulo de pausa, se limpia `s.resultado` y (si aplica) se amplía el
  // margen de rondas antes de reanudar el mismo bucle de turnos de
  // siempre (_avanzarTurno(), sin lógica nueva).
  reanudarTrasLimiteRondas({ modo }) {
    const s = this.session;
    if (s.resultado !== "unresolved") return; // guard -- solo aplica al caso pausado, nunca a un final real
    this._overlayResultado?.rect.destroy();
    this._overlayResultado?.label.destroy();
    this._overlayResultado = null;
    s.resultado = null;
    if (modo === "mas_rondas") this._limiteRondasExtra += LIMITE_RONDAS;
    if (modo === "manual") s.controlMode = "manual"; // devuelve el control real al jugador
    this._actualizarPanelAcciones();
    this._actualizarHud();
    this._emitirEstadoUI();
    this._avanzarTurno();
  }

  // ===== Acciones compartidas (manual y IA llaman a las MISMAS funciones --
  // única ruta de ejecución, sin lógica duplicada entre jugador y IA).
  // Production Integration Phase 6B: la lógica en sí vive ahora en
  // tacticalActionController.js (compartida con la futura UI DOM y el
  // renderer oblicuo 6C) -- estos métodos son wrappers finos que delegan
  // y deciden únicamente la orquestación propia de Phaser (mostrar
  // resultado, avanzar turno). Cero reglas reimplementadas aquí. =====

  _sincronizarPresentacion() {
    const actorId = this.session.currentActorId;
    if (actorId) this._reposicionarSprite(actorId);
    this._actualizarSpritesVida();
    this._redibujarOverlay();
    this._actualizarHud();
    this._actualizarPanelAcciones();
    this._emitirEstadoUI();
  }

  _emitirEstadoUI() {
    if (!this.session) return;
    this.events.emit("tactical-ui-state", construirSnapshotUI(this.session, this.adapter, this.session.currentActorId, { modoMoverActivo: this._modoMover, cadenciaData: this._cadenciaDataEntrante }));
  }

  _accionMoverA(xMetros, yMetros) {
    this.controlador.moverA(xMetros, yMetros);
  }

  _accionAtacar(targetId, { cc = false, modoFuego = "tiroATiro" } = {}) {
    const resultado = this.controlador.atacar(targetId, { cc, modoFuego });
    if (resultado.ok && resultado.terminado) this._mostrarResultado();
  }

  _accionRecargar() {
    this.controlador.recargar();
  }

  _accionCambiarArma() {
    this.controlador.cambiarArma();
  }

  // ADAPT (Phase 5, ver docs/TACTICAL_PRODUCTION_PHASE5_AUDIT.md): guard
  // de ausencia de habilidadEsquivar (Phase 3.5) -- vive en el
  // controlador compartido (tacticalActionController.js), no aquí.
  _accionEvasion() {
    this.controlador.evadir();
  }

  _accionDefensa() {
    this.controlador.defender();
  }

  _accionTerminarActuacion() {
    this.controlador.terminarActuacion();
    this._avanzarTurno();
  }

  // ===== FX genéricos (punto 32: muzzle flash/impact -- compartidos, sin
  // identidad de módulo) =====

  _fxDisparo(attackerId, targetId, impacto) {
    const a = this.adapter.posicionDe(attackerId), t = this.adapter.posicionDe(targetId);
    const linea = this.add.line(0, 0, this.escala.px(a.x), this.escala.px(a.y), this.escala.px(t.x), this.escala.px(t.y), 0xffe27a, 0.9).setOrigin(0, 0).setLineWidth(2).setDepth(20);
    const flash = this.add.circle(this.escala.px(a.x), this.escala.px(a.y), 6, 0xffffff, 0.9).setDepth(21);
    const marca = this.add.circle(this.escala.px(t.x), this.escala.px(t.y), 8, impacto ? 0xff4d4d : 0x8a8a8a, 0.85).setDepth(21);
    this.tweens.add({ targets: [linea, flash, marca], alpha: 0, duration: 260, onComplete: () => { linea.destroy(); flash.destroy(); marca.destroy(); } });
  }

  _fxRechazo(targetId) {
    const t = this.adapter.posicionDe(targetId);
    const x = this.add.text(this.escala.px(t.x), this.escala.px(t.y) - 40, "BLOQUEADO", { fontFamily: "monospace", fontSize: "12px", color: "#ff4d4d" }).setOrigin(0.5).setDepth(21);
    this.tweens.add({ targets: x, y: x.y - 16, alpha: 0, duration: 700, onComplete: () => x.destroy() });
  }

  // ===== Overlay debug espacial =====

  _crearOverlayDebug() {
    this.debugGraphics = this.add.graphics().setDepth(15);
    this.debugText = this.add.text(0, 0, "", { fontFamily: "monospace", fontSize: "11px", color: "#ffffff", backgroundColor: "#000000aa", padding: { x: 4, y: 2 } }).setDepth(16);
  }

  _redibujarOverlay() {
    this.debugGraphics.clear();
    this.debugText.setText("");
    const s = this.session;
    if (!this._debugSpatial || !s.currentActorId || !s.targetActorId) return;
    const cover = this.adapter.getCover(s.currentActorId, s.targetActorId);
    const distancia = this.adapter.getDistance(s.currentActorId, s.targetActorId);
    const a = this.adapter.posicionDe(s.currentActorId), t = this.adapter.posicionDe(s.targetActorId);
    const color = NIVEL_COLOR[cover.level];

    this.debugGraphics.lineStyle(cover.level === "total" ? 3 : 2, color, cover.canAttack ? 0.85 : 0.55);
    if (cover.level === "total") {
      const steps = 14;
      for (let i = 0; i < steps; i += 2) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        this.debugGraphics.lineBetween(this.escala.px(a.x + (t.x - a.x) * t0), this.escala.px(a.y + (t.y - a.y) * t0), this.escala.px(a.x + (t.x - a.x) * t1), this.escala.px(a.y + (t.y - a.y) * t1));
      }
    } else {
      this.debugGraphics.lineBetween(this.escala.px(a.x), this.escala.px(a.y), this.escala.px(t.x), this.escala.px(t.y));
    }
    const midX = this.escala.px((a.x + t.x) / 2), midY = this.escala.px((a.y + t.y) / 2);
    this.debugText.setPosition(midX + 8, midY - 10);
    let texto = `${s.currentActorId} → ${s.targetActorId}\n${cover.level.toUpperCase()} ${cover.canAttack ? "" : "(canAttack=false)"}\n${distancia.toFixed(1)} m${cover.source ? ` · ${cover.source}` : ""}`;
    const u = this._debugUltimoAtaque;
    if (u && u.attacker === s.currentActorId && u.target === s.targetActorId) {
      texto += u.rechazado ? `\nRECHAZADO: ${u.reasons.join(", ")}` : `\ntirada=${u.tirada} ${u.exito ? "éxito" : "fallo"}${u.esCritico ? " CRIT" : ""}${u.esPifia ? " PIFIA" : ""}\n${u.impacto ? `hit ${u.localizacion} dmg=${u.danioFinal}` : "miss/absorbido"}`;
    }
    this.debugText.setText(texto);
  }

  // ===== HUD + panel de acciones =====

  _crearHud() {
    const HUD_TOP = 30;
    this.hudPanel = this.add.rectangle(0, HUD_TOP, this.cameras.main.width, 60, 0x000000, 0.55).setOrigin(0, 0).setScrollFactor(0).setDepth(30);
    this.hudText = this.add.text(10, HUD_TOP + 6, "", { fontFamily: "monospace", fontSize: "12px", color: "#e8e8e8" }).setScrollFactor(0).setDepth(31);
    this.logText = this.add.text(10, HUD_TOP + 30, "", { fontFamily: "monospace", fontSize: "11px", color: "#9fffb0" }).setScrollFactor(0).setDepth(31);
    // Con la interfaz DOM responsive activa (6B), el resumen contextual ya
    // muestra ronda/actor/movimiento/arma -- este HUD de Phaser quedaría
    // duplicado. Se sigue creando y actualizando siempre (_log()/otros
    // métodos compartidos con el cenital escriben en él sin condicional
    // propio) pero queda invisible -- "un único juego de controles",
    // nunca dos superpuestos.
    if (config.tactical.responsiveUI) { this.hudPanel.setVisible(false); this.hudText.setVisible(false); }
    this._actualizarHud();
  }

  _actualizarHud() {
    const s = this.session;
    if (!s.currentActorId) { this.hudText.setText("Sin actor activo."); return; }
    const actor = s.configDe(s.currentActorId);
    const activation = s.activations.get(s.currentActorId);
    const restante = movementRemaining(activation);
    const arma = armaActivaDe(actor);
    const municion = municionArmaActivaDe(actor);
    let linea = `Ronda ${s.round} · ${actor.nombre} · mov=${restante.toFixed(1)}/${activation.movementTotal}m · acción: ${activation.mainActionAvailable ? "libre" : "gastada"} · ${arma.nombre} ${municion.cargador}/${municion.reserva}`;
    if (s.targetActorId) {
      const cover = this.adapter.getCover(s.currentActorId, s.targetActorId);
      linea += ` · objetivo=${s.targetActorId} (${cover.level})`;
    }
    this.hudText.setText(linea);
  }

  _crearPanelAcciones() {
    const acciones = [
      { id: "mover", label: "[Mover]" },
      { id: "disparar", label: "[Disparar]" },
      { id: "cc", label: "[CaC]" },
      { id: "recargar", label: "[Recargar]" },
      { id: "cambiarArma", label: "[Cambiar arma]" },
      { id: "defender", label: "[Defender]" },
      { id: "esquivar", label: "[Esquivar]" },
      { id: "terminar", label: "[Terminar]" }
    ];
    // CORRECCIÓN (verificación E2E de playtest, 2026-08-21): en un
    // viewport estrecho (móvil) las 8 acciones en una sola fila no caben
    // -- las últimas quedaban fuera del canvas, inaccesibles. Se
    // envuelven en tantas filas como haga falta (ancho real del
    // viewport, no del mundo -- mismo criterio que el resto de esta
    // sección) en vez de fijar un límite arbitrario de botones por fila.
    const anchoDisponible = this.cameras.main.width - 10;
    const ALTO_FILA = 26;
    this.botones = new Map();
    const filaAlturas = [];
    let x = 10, fila = 0;
    for (const a of acciones) {
      const medida = this.add.text(0, 0, a.label, { fontFamily: "monospace", fontSize: "12px", color: "#9fffb0", backgroundColor: "#111318", padding: { x: 6, y: 4 } }).setVisible(false);
      const anchoBoton = medida.width;
      medida.destroy();
      if (x + anchoBoton > anchoDisponible && x > 10) { fila += 1; x = 10; }
      filaAlturas[fila] = true;
      const texto = this.add.text(x, 0, a.label, { fontFamily: "monospace", fontSize: "12px", color: "#9fffb0", backgroundColor: "#111318", padding: { x: 6, y: 4 } })
        .setScrollFactor(0).setDepth(31).setInteractive({ useHandCursor: true });
      texto.on("pointerdown", () => this._onBotonAccion(a.id));
      texto.setData("fila", fila);
      this.botones.set(a.id, texto);
      x += anchoBoton + 8;
    }
    const numFilas = filaAlturas.length;
    const yBase = this.cameras.main.height - 10 - numFilas * ALTO_FILA;
    for (const texto of this.botones.values()) texto.setY(yBase + texto.getData("fila") * ALTO_FILA);
    this.panelBg = this.add.rectangle(0, yBase - 6, this.cameras.main.width, numFilas * ALTO_FILA + 12, 0x000000, 0.7).setOrigin(0, 0).setScrollFactor(0).setDepth(30);
    for (const texto of this.botones.values()) texto.setDepth(31); // por encima del fondo recién creado
    // Con la interfaz DOM responsive activa (6B): oculta e INHABILITA el
    // panel clásico -- no basta con esconderlo visualmente, sigue siendo
    // clicable (setInteractive) si no se desactiva también, lo que
    // rompería "un único juego de controles" (podría robar un toque
    // pensado para la bandeja nueva). _actualizarPanelAcciones() sigue
    // corriendo sin condicional propio (código compartido con el
    // cenital) -- solo deja de tener efecto visible.
    if (config.tactical.responsiveUI) {
      this.panelBg.setVisible(false);
      for (const texto of this.botones.values()) { texto.setVisible(false); texto.disableInteractive(); }
    }
    this._actualizarPanelAcciones();
  }

  _onBotonAccion(id) {
    const s = this.session;
    if (this._pausado || !s.currentActorId || s.resultado) return;
    if (!s.esControladoPorJugador(s.currentActorId)) return;
    switch (id) {
      case "mover": this._modoMover = !this._modoMover; this._log(this._modoMover ? "Clic en el suelo para mover." : "Modo mover desactivado."); break;
      case "disparar": if (s.targetActorId) this._accionAtacar(s.targetActorId, { cc: false }); else this._log("Selecciona un objetivo primero."); break;
      case "cc": if (s.targetActorId) this._accionAtacar(s.targetActorId, { cc: true }); else this._log("Selecciona un objetivo primero."); break;
      case "recargar": this._accionRecargar(); break;
      case "cambiarArma": this._accionCambiarArma(); break;
      case "defender": this._accionDefensa(); break;
      case "esquivar": this._accionEvasion(); break;
      case "terminar": this._accionTerminarActuacion(); break;
      default: break;
    }
  }

  _actualizarPanelAcciones() {
    if (!this.botones) return;
    const s = this.session;
    const activo = !this._pausado && s.currentActorId && !s.resultado && s.esControladoPorJugador(s.currentActorId);
    for (const [, texto] of this.botones) texto.setAlpha(activo ? 1 : 0.35);
    if (this._modoMover) this.botones.get("mover").setColor("#ffe27a"); else if (this.botones.get("mover")) this.botones.get("mover").setColor("#9fffb0");
  }

  _log(msg) {
    this.logText.setText(msg);
    // eslint-disable-next-line no-console
    console.log(`[TacticalScene:${this.session?.encounterId ?? "?"}] ${msg}`);
  }

  update() {
    // Sin loop de física -- el movimiento es discreto (clic/botón = intent),
    // la economía de recursos la conserva el Rules Engine real, no Phaser.
  }
}
