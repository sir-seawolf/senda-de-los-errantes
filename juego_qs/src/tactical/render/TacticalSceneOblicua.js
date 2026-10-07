// TacticalSceneOblicua -- spike de cámara oblicua (Production
// Integration Phase 6C, docs/TACTICAL_PRODUCTION_PHASE6C_SPIKE.md).
//
// PRINCIPIO DE DISEÑO (obligatorio, ver el audit de 6A §3.6 y el
// encargo 6C): la rejilla lógica y la simulación no cambian ni un bit
// -- solo cambia CÓMO se proyecta esa rejilla sobre la pantalla y cómo
// se invierte el puntero. Por eso esta clase EXTIENDE TacticalScene en
// vez de reimplementar nada: hereda sin tocar el controlador de
// acciones, el motor de turnos, la IA, el HUD/panel, el selector de
// modo y el montaje de la interfaz DOM 6B -- todo eso son los métodos
// "compartidos" del audit §3.6, byte a byte los mismos que usa el
// renderer cenital. Solo se sobreescriben los métodos de PRESENTACIÓN
// PURA (dibujar rejilla/obstáculos/actores, FX, overlay de debug,
// hit-testing del puntero) -- exactamente la lista que el audit marcó
// como "intercambiable sin tocar la simulación".
//
// Verificación de que esto es cierto y no una promesa: ver
// tests/tacticalSceneOblicua.test.mjs, que compara
// `TacticalSceneOblicua.prototype._accionX === TacticalScene.prototype._accionX`
// (misma referencia de función, no una copia) para cada acción
// compartida.
import { TacticalScene } from "./TacticalScene.js";
import { crearEscalaIsometrica } from "./scaleIsometric.js";
import { movementRemaining } from "../bridge/qsRulesBridge.js";
import { resolverAnclajeVisual, resolverTamanoVisual, profundidadVisual } from "./visualPlacement.js";
import { costeMovimientoEntre, elevacionEn, puntoAlcanzable, terrenoEn } from "../spatial/terrainZones.js";
import { celdasMovimientoAlcanzables, etiquetaCobertura, probabilidadObjetivo } from "./tacticalSpatialPresentation.js";

const NIVEL_COLOR = { none: 0x5c6b5c, partial: 0xffe27a, solid: 0xff9d4d, total: 0xff4d4d };
const COLOR_POR_TIPO = { partial: 0xb08b3a, solid: 0x8a6d3a, total: 0x555b66 };
const ALPHA_POR_TIPO = { partial: 0.75, solid: 0.85, total: 0.92 };
const ALPHA_OCLUSION = 0.3; // pared "total" que taparía a un actor -- se vuelve casi transparente
const ALPHA_VISTA_CLARA = 0.15;

export class TacticalSceneOblicua extends TacticalScene {
  // CORRECCIÓN (verificación Playwright de 6C, ver
  // docs/TACTICAL_PRODUCTION_PHASE6C_SPIKE.md §5): sin este constructor,
  // TacticalSceneOblicua hereda el de TacticalScene tal cual, que llama
  // a `super("TacticalScene")` -- Phaser.Scene fija su key definitiva EN
  // el constructor, no a partir del parámetro de game.scene.add(). Con
  // las dos escenas reclamando la key interna "TacticalScene", el
  // SceneManager no logra resolver game.scene.getScene("TacticalSceneOblicua")
  // (confirmado empíricamente: el bug pasaba inadvertido en los tests
  // estáticos porque ninguno instancia Phaser de verdad).
  constructor() {
    super();
    this.sys.settings.key = "TacticalSceneOblicua";
  }

  // Suelo decorativo (encargo de sesión, 2026-08-21: "aproxima también
  // su jerarquía... suelo... provisionales procedentes de los recursos
  // CC0 disponibles" -- no se busca ningún recurso nuevo, se REUTILIZA
  // la textura ya integrada y con licencia verificada en la Fase 6D,
  // ver docs/PREDATOR_VISUAL_RESOURCES_MANIFEST_6D.md). `preload()` es
  // un método de ciclo de vida de Phaser.Scene que TacticalScene.js no
  // usaba hasta ahora (nunca cargó ninguna imagen) -- Phaser lo llama
  // automáticamente ANTES de create(), así que la textura ya está
  // disponible cuando `_grid()` la usa más abajo. Puramente decorativo:
  // no toca `_inicializarSistemaCoordenadas()` ni ningún cálculo de
  // proyección/hit-testing.
  preload() {
    super.preload();
    this.load.image("tactical_floor_texture", "assets/shared/tactical/textures/concrete_floor_1k.jpg");
  }

  create() {
    super.create();
    this.game.registry.set("sceneName", "TacticalSceneOblicua");
    this._movimientoReducido = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this._crearAtmosfera();
    this._crearControlVistaClara();
  }

  _crearAtmosfera() {
    const atmosfera = this.definition.battlefield.atmosphere;
    if (!atmosfera) return;
    const haloKey = "tactical-soft-light";
    if (!this.textures.exists(haloKey)) {
      const texture = this.textures.createCanvas(haloKey, 256, 128);
      const ctx = texture.getContext();
      ctx.save();
      ctx.scale(1, .5);
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, "rgba(255,255,255,.9)");
      gradient.addColorStop(.35, "rgba(255,255,255,.42)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
      ctx.restore();
      texture.refresh();
    }
    this.add.rectangle(0, 0, this.mundoPx.width, this.mundoPx.height, atmosfera.ambientTint ?? 0x071116, atmosfera.ambientAlpha ?? .18)
      .setOrigin(0).setDepth(5).setBlendMode("MULTIPLY");
    for (const luz of atmosfera.lights ?? []) {
      const p = this.escalaIso.proyectar(luz.x, luz.y);
      const radio = luz.radiusMeters * this.escalaIso.escalaBase.metersToPx;
      const halo = this.add.image(p.x, p.y, haloKey).setDisplaySize(radio * 2, radio)
        .setTint(luz.color).setAlpha(luz.intensity ?? .12).setDepth(6).setBlendMode("ADD");
      if (!this._movimientoReducido && luz.pulse) {
        this.tweens.add({ targets: halo, alpha: Math.max(.02, (luz.intensity ?? .12) - luz.pulse), scaleX: 1.035, scaleY: 1.035, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      }
    }
    const particulas = atmosfera.particles;
    if (!particulas || this._movimientoReducido) return;
    this._particulasAmbiente = [];
    for (let i = 0; i < (particulas.count ?? 12); i++) {
      const punto = this.add.circle(Math.random() * this.mundoPx.width, Math.random() * this.mundoPx.height, 1 + Math.random(), particulas.color ?? 0xaec4c9, particulas.alpha ?? .12).setDepth(7);
      const duracion = (particulas.durationMs ?? 5000) * (.75 + Math.random() * .5);
      this.tweens.add({ targets: punto, x: punto.x + (particulas.driftPx ?? 20), y: punto.y - (particulas.driftPx ?? 20) * .55, alpha: 0, duration: duracion, repeat: -1, delay: Math.random() * duracion, onRepeat: () => { punto.setPosition(Math.random() * this.mundoPx.width, Math.random() * this.mundoPx.height).setAlpha(particulas.alpha ?? .12); } });
      this._particulasAmbiente.push(punto);
    }
  }

  // ===== Punto de extensión único para el sistema de coordenadas
  // (ver TacticalScene.js `_inicializarSistemaCoordenadas`) =====

  _inicializarSistemaCoordenadas(definition, session) {
    const base = crearEscalaIsometrica(definition.battlefield.metersToPx, {
      anchoMundoMetros: session.battlefieldMeters.width,
      altoMundoMetros: session.battlefieldMeters.height
    });
    // El arte táctico usa el mismo encuadre 16:10 que la referencia. La
    // simulación conserva exactamente sus metros; solo añadimos margen
    // vertical simétrico a la proyección para evitar la franja negra que
    // producía el rombo 2:1 puro en pantallas de escritorio.
    const usaComposicionVisual = definition.assets?.scene?.floor || definition.assets?.battlefield;
    const altoPresentacion = usaComposicionVisual ? base.mundoPx.width / 1.6 : base.mundoPx.height;
    const margenY = Math.max(0, (altoPresentacion - base.mundoPx.height) / 2);
    this.escalaIso = {
      ...base,
      proyectar: (x, y) => { const p = base.proyectar(x, y); return { x: p.x, y: p.y + margenY }; },
      invertir: (x, y) => base.invertir(x, y - margenY),
      mundoPx: { width: base.mundoPx.width, height: base.mundoPx.height + margenY * 2 }
    };
    this.mundoPx = this.escalaIso.mundoPx;
  }

  _profundidadEnPantalla(xMetros, yMetros) {
    // Convención isométrica estándar: cuanto mayor x+y (más "al sur" en
    // la rejilla lógica), más cerca de la cámara -- se dibuja encima.
    // Multiplicado por 10 y con margen suficiente para no chocar con
    // las profundidades fijas del HUD/panel/overlay (30+) ni con las de
    // FX (20-21) definidas en TacticalScene.
    return 40 + Math.round(this.escalaIso.proyectar(xMetros, yMetros).y);
  }

  // ===== "Vista táctica clara" (encargo 6C: botón para reducir/hacer
  // transparente el decorado) =====

  _crearControlVistaClara() {
    this._vistaClaraActiva = false;
    // scrollFactor(0) -- coordenadas de viewport, no de mundo (mismo
    // criterio que la corrección en TacticalScene.js _crearHud()/
    // _crearPanelAcciones()/_crearSelectorModo()).
    const boton = this.add.text(this.cameras.main.width - 10, 10, "VISIÓN · AUTO", {
      fontFamily: "Barlow Condensed", fontSize: "12px", color: "#8fc8d2", backgroundColor: "#0b1114", padding: { x: 10, y: 6 }
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(32).setInteractive({ useHandCursor: true });
    boton.on("pointerdown", () => {
      this._vistaClaraActiva = !this._vistaClaraActiva;
      boton.setColor(this._vistaClaraActiva ? "#d7b35c" : "#8fc8d2");
      boton.setText(this._vistaClaraActiva ? "VISIÓN · ABIERTA" : "VISIÓN · AUTO");
      this._actualizarOcultamientoParedes();
    });
    this._botonVistaClara = boton;
  }

  // ===== Representación (isométrica) =====

  _grid() {
    const { width: wM, height: hM } = this.session.battlefieldMeters;
    if (this.textures.exists("tactical-scene-floor")) {
      this.add.tileSprite(0, 0, this.mundoPx.width, this.mundoPx.height, "tactical-scene-floor")
        .setOrigin(0).setDepth(-3).setTint(0x667276).setTileScale(.72, .72);
    } else if (this.textures.exists("tactical-battlefield")) {
      this.add.image(this.mundoPx.width / 2, this.mundoPx.height / 2, "tactical-battlefield")
        .setDisplaySize(this.mundoPx.width, this.mundoPx.height).setDepth(-2);
    } else if (this.textures.exists("tactical_floor_texture")) {
      // Sin recorte al rombo exacto del campo de batalla a propósito:
      // `GameObject.setMask()` con una máscara de geometría no está
      // soportado en el renderer WebGL de esta versión de Phaser
      // (aviso de consola confirmado en verificación real: "This method
      // is not supported in WebGL. Create a Mask filter instead." --
      // API distinta, fuera de alcance de un recurso decorativo
      // provisional). La textura se pinta a alpha bajo sobre el
      // rectángulo que contiene el rombo -- la rejilla y los actores se
      // dibujan encima y el ligero sobrante en las esquinas del rombo
      // es imperceptible a esa opacidad.
      this.add.image(this.mundoPx.width / 2, this.mundoPx.height / 2, "tactical_floor_texture")
        .setDisplaySize(this.mundoPx.width, this.mundoPx.height).setAlpha(0.4).setDepth(-1);
    }
    const g = this.add.graphics().setDepth(0).setAlpha(0);
    this.gridGraphics = g;
    const tieneCapas = this.textures.exists("tactical-scene-floor");
    const tieneArte = tieneCapas || this.textures.exists("tactical-battlefield");
    const alphaRejilla = this.definition.battlefield.atmosphere?.reducedGridAlpha ?? .2;
    g.lineStyle(1, tieneArte ? 0x6ca8b8 : 0x22252b, tieneArte ? alphaRejilla : 1);
    for (let x = 0; x <= wM; x += 1) {
      const p0 = this.escalaIso.proyectar(x, 0), p1 = this.escalaIso.proyectar(x, hM);
      g.lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
    for (let y = 0; y <= hM; y += 1) {
      const p0 = this.escalaIso.proyectar(0, y), p1 = this.escalaIso.proyectar(wM, y);
      g.lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
    if (tieneCapas) this._pintarCapasEscenario();
  }

  _actualizarRejillaMovimiento() {
    this.gridGraphics?.setAlpha(this._modoMover ? 1 : 0);
    if (!this._modoMover) {
      this._movementIntentGraphics?.clear();
      this._movementIntentText?.setText("");
    }
    this._redibujarOverlay();
  }

  _proyectarActor(xMetros, yMetros) {
    const p = this.escalaIso.proyectar(xMetros, yMetros);
    const elevacion = elevacionEn(this.definition.battlefield.terrainZones, xMetros, yMetros);
    return { x: p.x, y: p.y - elevacion * this.escalaIso.escalaBase.metersToPx };
  }

  _pintarCapasEscenario() {
    const visuals = this.definition.battlefield.visuals ?? {};
    this.sceneLayerSprites = [];
    this.exitLayerSprites = new Map();
    const addPlaced = (entry, textureKey, kind) => {
      if (!this.textures.exists(textureKey)) return;
      const p = resolverAnclajeVisual(entry, {
        world: this.mundoPx,
        project: (x, y) => this.escalaIso.proyectar(x, y),
        obstacles: this.session.obstacles
      });
      // Una referencia rota en el JSON no debe mandar la pieza al origen
      // (0,0), donde parecería un elemento suelto. Fallamos de forma
      // contenida y dejamos el resto de la composición intacto.
      if (!p) return;
      const size = resolverTamanoVisual(entry, {
        naturalWidth: this.textures.get(textureKey).getSourceImage().width,
        naturalHeight: this.textures.get(textureKey).getSourceImage().height,
        world: this.mundoPx,
        metersToPx: this.escalaIso.escalaBase.metersToPx
      });
      const depth = profundidadVisual(entry, p.y);
      const sprite = this.add.image(p.x, p.y, textureKey)
        .setOrigin(entry.originX ?? .5, entry.originY ?? .88)
        .setDepth(depth)
        .setFlipX(!!entry.flipX)
        .setAlpha(entry.alpha ?? 1)
        .setDisplaySize(size.width, size.height);
      const record = { sprite, kind, alphaBase: entry.alpha ?? 1, entry };
      this.sceneLayerSprites.push(record);
      if (kind === "exit" && entry.id) this.exitLayerSprites.set(entry.id, record);
    };
    for (const entry of visuals.walls ?? []) addPlaced(entry, `tactical-scene-walls-${entry.asset}`, "wall");
    for (const entry of visuals.props ?? []) addPlaced(entry, `tactical-scene-props-${entry.asset}`, "prop");
    for (const zona of this.definition.battlefield.terrainZones ?? []) {
      const entry = { ...zona, x: zona.x + zona.width / 2, y: zona.y + zona.height / 2 };
      addPlaced(entry, `tactical-scene-terrain-${zona.asset}`, "terrain");
    }
    for (const entry of visuals.exits ?? []) addPlaced(entry, `tactical-scene-exit-${entry.asset}-${entry.state ?? "closed"}`, "exit");
  }

  establecerEstadoSalida(exitId, state) {
    const record = this.exitLayerSprites?.get(exitId);
    if (!record) return false;
    const key = `tactical-scene-exit-${record.entry.asset}-${state}`;
    if (!this.textures.exists(key)) return false;
    record.sprite.setTexture(key);
    record.entry.state = state;
    return true;
  }

  // Cada obstáculo es su propio GameObject (no un único Graphics
  // compartido) para poder asignarle una profundidad individual y que
  // Phaser lo entrevere correctamente con los sprites de actor -- es lo
  // que hace posible el ocultamiento de "paredes frontales" (encargo
  // 6C) sin tocar el orden de dibujo del resto de la escena.
  _pintarObstaculos() {
    this.obstacleGraphics = new Map();
    const tieneArteEscenario = this.textures.exists("tactical-scene-floor") || this.textures.exists("tactical-battlefield");
    for (const o of this.session.obstacles) {
      const esquinas = [
        this.escalaIso.proyectar(o.x, o.y),
        this.escalaIso.proyectar(o.x + o.width, o.y),
        this.escalaIso.proyectar(o.x + o.width, o.y + o.height),
        this.escalaIso.proyectar(o.x, o.y + o.height)
      ];
      const g = this.add.graphics().setDepth(this._profundidadEnPantalla(o.x + o.width, o.y + o.height) - 1);
      g.fillStyle(COLOR_POR_TIPO[o.type], tieneArteEscenario ? 0.04 : (ALPHA_POR_TIPO[o.type] ?? 0.75));
      g.beginPath();
      g.moveTo(esquinas[0].x, esquinas[0].y);
      for (const p of esquinas.slice(1)) g.lineTo(p.x, p.y);
      g.closePath();
      g.fillPath();
      g.lineStyle(tieneArteEscenario ? 1 : 2, tieneArteEscenario ? 0x6ca8b8 : 0x000000, tieneArteEscenario ? 0.28 : 0.6);
      g.strokePath();

      // Extrusión puramente visual (encargo 6C: "una diferencia de
      // elevación puramente visual, sin efecto mecánico" + paredes
      // "total" con altura perceptible): se dibuja una cara frontal
      // levantando en pantalla las dos esquinas más cercanas a cámara.
      // NUNCA lee ni escribe nada de la simulación -- solo decoración.
      const alturaMetros = tieneArteEscenario ? 0 : (o.alturaVisualMetros ?? (o.type === "total" ? 1.2 : 0));
      if (alturaMetros > 0) {
        const alturaPx = alturaMetros * this.escalaIso.escalaBase.metersToPx * 0.5;
        const base = [esquinas[2], esquinas[3]]; // las dos esquinas "sur" (más cerca de cámara)
        const techo = base.map(p => ({ x: p.x, y: p.y - alturaPx }));
        g.fillStyle(COLOR_POR_TIPO[o.type], (ALPHA_POR_TIPO[o.type] ?? 0.75) * 0.85);
        g.beginPath();
        g.moveTo(base[0].x, base[0].y);
        g.lineTo(base[1].x, base[1].y);
        g.lineTo(techo[1].x, techo[1].y);
        g.lineTo(techo[0].x, techo[0].y);
        g.closePath();
        g.fillPath();
        g.strokePath();
      }

      const centro = this.escalaIso.proyectar(o.x + o.width / 2, o.y + o.height / 2);
      const etiqueta = this.add.text(centro.x, centro.y, tieneArteEscenario ? "" : `${o.nombre ?? o.id}\n[${o.type}]`, {
        fontFamily: "monospace", fontSize: "10px", color: "#e8e8e8", align: "center"
      }).setOrigin(0.5).setDepth(g.depth + 1);

      this.obstacleGraphics.set(o.id, { graphics: g, etiqueta, obstaculo: o, alphaBase: ALPHA_POR_TIPO[o.type] ?? 0.75 });
    }
    this._actualizarOcultamientoParedes();
  }

  // Heurístico de ocultamiento (encargo 6C: "paredes frontales
  // ocultables/recortadas/transparentes cuando bloqueen unidades",
  // "unidades ocultas recuperables vía transparencia/vista clara"). No
  // es raycasting 3D real -- es un spike: una pared "total" cuya caja
  // en pantalla se solapa en X con un actor vivo situado lógicamente
  // "detrás" de ella (x+y mayor, más lejos de cámara en la convención
  // isométrica) se vuelve casi transparente. Puramente visual, no
  // afecta a getCover()/canAttack() reales (SpatialCoverAdapter).
  _actualizarOcultamientoParedes() {
    const idsInteres = [this.session.currentActorId, this.session.targetActorId].filter(Boolean);
    for (const record of this.sceneLayerSprites ?? []) {
      if (record.kind !== "wall") continue;
      const ocultaInteres = idsInteres.some(actorId => {
        const pos = this.session.positions[actorId];
        if (!pos) return false;
        const p = this.escalaIso.proyectar(pos.x, pos.y);
        const bounds = record.sprite.getBounds();
        return record.sprite.depth >= this._profundidadEnPantalla(pos.x, pos.y) - 2
          && p.x >= bounds.left - 8 && p.x <= bounds.right + 8
          && p.y >= bounds.top - 20 && p.y <= bounds.bottom + 12;
      });
      record.sprite.setAlpha(this._vistaClaraActiva ? ALPHA_VISTA_CLARA : (ocultaInteres ? ALPHA_OCLUSION : record.alphaBase));
    }
    if (!this.obstacleGraphics) return;
    const actoresVivos = [...this.session.party, ...this.session.enemies].filter(a => a.estadoDisponibilidad === "disponible");
    for (const [, entry] of this.obstacleGraphics) {
      const { graphics, obstaculo: o, alphaBase } = entry;
      if (this._vistaClaraActiva) { graphics.setAlpha(ALPHA_VISTA_CLARA); continue; }
      if (o.type !== "total") { graphics.setAlpha(1); continue; }
      const profundidadPared = o.x + o.width + (o.y + o.height);
      const xIzq = this.escalaIso.proyectar(o.x, o.y + o.height).x;
      const xDer = this.escalaIso.proyectar(o.x + o.width, o.y).x;
      const [xMin, xMax] = xIzq <= xDer ? [xIzq, xDer] : [xDer, xIzq];
      const oculta = actoresVivos.some(a => {
        const pos = this.session.positions[a.id];
        const profundidadActor = pos.x + pos.y;
        if (profundidadActor <= profundidadPared) return false; // el actor está delante, no lo tapa
        const p = this.escalaIso.proyectar(pos.x, pos.y);
        return p.x >= xMin - 4 && p.x <= xMax + 4;
      });
      graphics.setAlpha(oculta ? ALPHA_OCLUSION : 1);
    }
  }

  _pintarActores() {
    this.actorSprites = new Map();
    for (const a of [...this.session.party, ...this.session.enemies]) {
      const esEnemigo = !this.session.esParty(a.id);
      const pos = this.session.positions[a.id];
      const p = this._proyectarActor(pos.x, pos.y);
      const depth = this._profundidadEnPantalla(pos.x, pos.y);
      // Base/sombra (encargo 6C: "bases/sombras/contornos/marcadores
      // suficientes") -- puramente decorativa, ancla visualmente el
      // actor a su casilla en la rejilla isométrica.
      const sombra = this.add.ellipse(p.x + 8, p.y + 8, esEnemigo ? 42 : 48, esEnemigo ? 14 : 17, 0x000000, .52).setDepth(depth - 2);
      const base = this.add.ellipse(p.x, p.y + 5, 34, 14, esEnemigo ? 0x9e2730 : 0x62b8d0, 0.12).setDepth(depth - 1);
      const circle = this.add.circle(p.x, p.y, 15, a.color ?? (esEnemigo ? 0xcf3945 : 0x78d8ef), 0.1).setDepth(depth).setInteractive({ useHandCursor: true });
      circle.setStrokeStyle(2, esEnemigo ? 0xcf3945 : 0x78d8ef, 0.9);
      const estadosTextura = { idle: `tactical-actor-${a.id}-idle`, hurt: `tactical-actor-${a.id}-hurt`, down: `tactical-actor-${a.id}-down` };
      const claveTextura = Object.values(estadosTextura).find(key => this.textures.exists(key));
      const token = claveTextura ? this.add.image(p.x, p.y + 6, claveTextura).setDisplaySize(esEnemigo ? 62 : 72, esEnemigo ? 84 : 102).setOrigin(.5, .91).setDepth(depth) : null;
      if (token) circle.setFillStyle(a.color ?? (esEnemigo ? 0xff6b6b : 0x9fffb0), .16).setDepth(depth - 1);
      const nombreCorto = a.nombre.replace(/ejecutor corporativo\s*/i, "Ejecutor ").toUpperCase();
      const label = this.add.text(p.x, p.y - 52, nombreCorto, { fontFamily: "Barlow Condensed", fontSize: "10px", color: esEnemigo ? "#ff8e96" : "#a9e9f6", backgroundColor: "#071015dd", padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(depth + 1);
      const vida = this.add.text(p.x, p.y + 16, "", { fontFamily: "Barlow Condensed", fontSize: "9px", color: "#d7e2e5", backgroundColor: "#071015cc", padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(depth + 1);
      circle.on("pointerdown", () => this._onActorClicked(a.id));
      this.actorSprites.set(a.id, { circle, token, label, vida, base, sombra, esEnemigo, estadosTextura });
    }
    this._actualizarSpritesVida();
  }

  _reposicionarSprite(actorId) {
    const pos = this.session.positions[actorId];
    const p = this._proyectarActor(pos.x, pos.y);
    const depth = this._profundidadEnPantalla(pos.x, pos.y);
    const { circle, token, label, vida, base, sombra } = this.actorSprites.get(actorId);
    const yaEsta = Math.abs(circle.x - p.x) < .5 && Math.abs(circle.y - p.y) < .5;
    const mover = (target, x, y, targetDepth) => {
      target.setDepth(targetDepth);
      if (this._movimientoReducido || yaEsta) target.setPosition(x, y);
      else this.tweens.add({ targets: target, x, y, duration: 220, ease: "Expo.out" });
    };
    mover(circle, p.x, p.y, depth);
    if (token) mover(token, p.x, p.y + 6, depth);
    mover(label, p.x, p.y - 52, depth + 1);
    mover(vida, p.x, p.y + 16, depth + 1);
    mover(base, p.x, p.y + 5, depth - 1);
    mover(sombra, p.x + 8, p.y + 8, depth - 2);
    this._actualizarOcultamientoParedes();
  }

  // ===== Input (inversión de puntero isométrica) =====

  _crearInput() {
    this._movementIntentGraphics = this.add.graphics().setDepth(18);
    this._movementIntentText = this.add.text(0, 0, "", {
      fontFamily: "Barlow Condensed", fontSize: "12px", color: "#dcebee",
      backgroundColor: "#071015ee", padding: { x: 7, y: 4 }
    }).setDepth(19);
    this.input.on("pointermove", (pointer) => {
      if (!this._modoMover || pointer.y < 150) return;
      const destino = this.escalaIso.invertir(pointer.worldX, pointer.worldY);
      this._actualizarDestinoMovimiento(destino.x, destino.y);
    });
    this.input.on("pointerdown", (pointer) => {
      if (pointer.y < 150) return;
      const objetivo = this.input.hitTestPointer(pointer)[0];
      if (objetivo) return;
      if (this._modoMover) {
        const { x, y } = this.escalaIso.invertir(pointer.worldX, pointer.worldY);
        this._accionMoverA(x, y);
      }
    });
  }

  _actualizarDestinoMovimiento(xMetros, yMetros) {
    const s = this.session;
    const actorId = s.currentActorId;
    const activation = actorId ? s.activations.get(actorId) : null;
    const origen = actorId ? s.positions[actorId] : null;
    if (!this._modoMover || !activation || !origen) return;
    const destinoSolicitado = {
      x: Math.max(0, Math.min(s.battlefieldMeters.width, xMetros)),
      y: Math.max(0, Math.min(s.battlefieldMeters.height, yMetros))
    };
    const presupuesto = movementRemaining(activation);
    const zonas = this.definition.battlefield.terrainZones ?? [];
    const configTerreno = this.definition.battlefield.terrainConfig ?? {};
    const destino = puntoAlcanzable(origen, destinoSolicitado, presupuesto, zonas, configTerreno);
    const coste = costeMovimientoEntre(origen, destino, zonas, configTerreno);
    const zona = terrenoEn(zonas, destino.x, destino.y);
    const limitado = destino.proporcion < .999;
    const pa = this._proyectarActor(origen.x, origen.y), pd = this._proyectarActor(destino.x, destino.y);
    const color = limitado ? 0xd79a35 : (zona?.movementMultiplier > 1 ? 0xe1b458 : 0x72c7dc);
    this._movementIntentGraphics.clear();
    this._movementIntentGraphics.lineStyle(2, color, .9);
    this._movementIntentGraphics.lineBetween(pa.x, pa.y + 5, pd.x, pd.y + 5);
    this._movementIntentGraphics.fillStyle(color, .2);
    this._movementIntentGraphics.fillCircle(pd.x, pd.y + 5, 10);
    this._movementIntentGraphics.lineStyle(2, color, 1);
    this._movementIntentGraphics.strokeCircle(pd.x, pd.y + 5, 10);
    const detalles = [`${coste.toFixed(1)} / ${presupuesto.toFixed(1)} m`];
    if (zona?.label) detalles.push(`${zona.label}${zona.movementMultiplier > 1 ? ` ×${zona.movementMultiplier}` : ""}`);
    if (zona?.elevationMeters > 0) detalles.push(`altura +${zona.elevationMeters} m`);
    if (limitado) detalles.push("límite de movimiento");
    this._movementIntentText.setText(detalles.join(" · ")).setPosition(pd.x + 14, pd.y - 22);
  }

  // ===== FX (posiciones proyectadas) =====

  _fxDisparo(attackerId, targetId, impacto, detalle = {}) {
    const a = this.adapter.posicionDe(attackerId), t = this.adapter.posicionDe(targetId);
    const pa = this._proyectarActor(a.x, a.y), pt = this._proyectarActor(t.x, t.y);
    const depth = Math.max(this._profundidadEnPantalla(a.x, a.y), this._profundidadEnPantalla(t.x, t.y)) + 5;
    const lineas = [];
    const trazadoras = detalle.modoFuego === "rafaga" ? 3 : 1;
    for (let i = 0; i < trazadoras; i++) {
      const desvio = (i - (trazadoras - 1) / 2) * 3;
      lineas.push(this.add.line(0, 0, pa.x, pa.y + desvio, pt.x, pt.y + desvio, 0xffd27a, .82).setOrigin(0, 0).setLineWidth(i === 1 ? 2 : 1).setDepth(depth));
    }
    const flash = this.add.circle(pa.x, pa.y, 6, 0xffffff, 0.9).setDepth(depth);
    const marca = this.add.circle(pt.x, pt.y, 8, impacto ? 0xff4d4d : 0x8a8a8a, 0.85).setDepth(depth);
    const chispas = Array.from({ length: impacto ? 5 : 2 }, (_, i) => this.add.circle(pt.x, pt.y, 1.5, impacto ? 0xffc56b : 0x9ba8ac, .9).setDepth(depth + 1));
    chispas.forEach((chispa, i) => this.tweens.add({ targets: chispa, x: pt.x + Math.cos(i * 1.7) * (12 + i * 2), y: pt.y + Math.sin(i * 1.7) * (8 + i), alpha: 0, duration: 320, ease: "Quad.out", onComplete: () => chispa.destroy() }));
    if (!this._movimientoReducido) this.cameras.main.shake(detalle.modoFuego === "rafaga" ? 110 : 65, detalle.modoFuego === "rafaga" ? .0018 : .0009);
    this.tweens.add({ targets: [...lineas, flash, marca], alpha: 0, duration: 260, onComplete: () => { lineas.forEach(linea => linea.destroy()); flash.destroy(); marca.destroy(); } });
  }

  _fxRechazo(targetId) {
    const t = this.adapter.posicionDe(targetId);
    const p = this._proyectarActor(t.x, t.y);
    const depth = this._profundidadEnPantalla(t.x, t.y) + 5;
    const x = this.add.text(p.x, p.y - 40, "BLOQUEADO", { fontFamily: "monospace", fontSize: "12px", color: "#ff4d4d" }).setOrigin(0.5).setDepth(depth);
    this.tweens.add({ targets: x, y: x.y - 16, alpha: 0, duration: 700, onComplete: () => x.destroy() });
  }

  // ===== Overlay debug espacial (posiciones proyectadas) =====

  _redibujarOverlay() {
    this.debugGraphics.clear();
    this.debugText.setText("");
    for (const label of this._intentLabels ?? []) label.destroy();
    this._intentLabels = [];
    const s = this.session;
    for (const [actorId, visual] of this.actorSprites ?? []) {
      const seleccionado = actorId === s.targetActorId;
      const activo = actorId === s.currentActorId;
      visual.circle.setStrokeStyle(seleccionado ? 3 : 2, seleccionado ? 0xf0bd58 : (visual.esEnemigo ? 0xcf3945 : 0x78d8ef), seleccionado || activo ? 1 : .72);
      visual.base.setAlpha(seleccionado ? .32 : activo ? .22 : .12);
    }
    this._actualizarOcultamientoParedes();
    if (this._modoMover && s.currentActorId && s.esControladoPorJugador(s.currentActorId)) {
      const activacion = s.activations.get(s.currentActorId);
      const pos = s.positions[s.currentActorId];
      if (activacion && pos) {
        const celdas = celdasMovimientoAlcanzables({
          origen: pos,
          presupuesto: movementRemaining(activacion),
          width: s.battlefieldMeters.width,
          height: s.battlefieldMeters.height,
          terrainZones: this.definition.battlefield.terrainZones,
          terrainConfig: this.definition.battlefield.terrainConfig
        });
        for (const celda of celdas) {
          const color = celda.elevationMeters > 0 ? 0x8bc9d8 : celda.movementMultiplier > 1 ? 0xd5a94e : 0x3cabc8;
          const puntos = [
            this.escalaIso.proyectar(celda.x - .45, celda.y - .45), this.escalaIso.proyectar(celda.x + .45, celda.y - .45),
            this.escalaIso.proyectar(celda.x + .45, celda.y + .45), this.escalaIso.proyectar(celda.x - .45, celda.y + .45)
          ];
          this.debugGraphics.lineStyle(1, color, celda.terrainId ? .62 : .28);
          this.debugGraphics.fillStyle(color, celda.terrainId ? .14 : .055);
          this.debugGraphics.beginPath();
          this.debugGraphics.moveTo(puntos[0].x, puntos[0].y);
          for (const punto of puntos.slice(1)) this.debugGraphics.lineTo(punto.x, punto.y);
          this.debugGraphics.closePath();
          this.debugGraphics.fillPath();
          this.debugGraphics.strokePath();
        }
      }
    }
    const intencionAtaque = this._intencionVisual?.tipo === "ataque" ? this._intencionVisual : null;
    if (intencionAtaque) {
      for (const objetivo of intencionAtaque.objetivos ?? []) {
        const visual = this.actorSprites?.get(objetivo.targetId);
        const pos = s.positions[objetivo.targetId];
        if (!visual || !pos) continue;
        const p = this._proyectarActor(pos.x, pos.y);
        const lectura = probabilidadObjetivo(objetivo, intencionAtaque.modoFuego);
        const color = objetivo.valid ? 0xd79a35 : 0x7c4a4d;
        this.debugGraphics.lineStyle(objetivo.targetId === s.targetActorId ? 3 : 1, color, objetivo.valid ? .9 : .42);
        this.debugGraphics.strokeEllipse(p.x, p.y + 5, 48, 20);
        const label = this.add.text(p.x, p.y - 70, objetivo.valid ? `${lectura.final}%` : "SIN TIRO", {
          fontFamily: "Barlow Condensed", fontSize: "11px", color: objetivo.valid ? "#f0c76b" : "#b78b8e",
          backgroundColor: "#071015e8", padding: { x: 5, y: 2 }
        }).setOrigin(.5).setDepth(this._profundidadEnPantalla(pos.x, pos.y) + 3);
        this._intentLabels.push(label);
      }
    }
    if (!s.currentActorId || !s.targetActorId || (!intencionAtaque && !this._debugSpatial)) return;
    const cover = this.adapter.getCover(s.currentActorId, s.targetActorId);
    const distancia = this.adapter.getDistance(s.currentActorId, s.targetActorId);
    const a = this.adapter.posicionDe(s.currentActorId), t = this.adapter.posicionDe(s.targetActorId);
    const pa = this.escalaIso.proyectar(a.x, a.y), pt = this.escalaIso.proyectar(t.x, t.y);
    const color = NIVEL_COLOR[cover.level];

    this.debugGraphics.lineStyle(cover.level === "total" ? 3 : 2, color, cover.canAttack ? 0.85 : 0.55);
    if (cover.level === "total") {
      const steps = 14;
      for (let i = 0; i < steps; i += 2) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        this.debugGraphics.lineBetween(pa.x + (pt.x - pa.x) * t0, pa.y + (pt.y - pa.y) * t0, pa.x + (pt.x - pa.x) * t1, pa.y + (pt.y - pa.y) * t1);
      }
    } else {
      this.debugGraphics.lineBetween(pa.x, pa.y, pt.x, pt.y);
    }
    // La proyección isométrica es afín (lineal) -- el punto medio
    // proyectado coincide con la proyección del punto medio lógico, no
    // hace falta promediar en pantalla.
    const medio = this.escalaIso.proyectar((a.x + t.x) / 2, (a.y + t.y) / 2);
    this.debugText.setStyle({ fontFamily: "Barlow Condensed", fontSize: "12px", color: "#e2edef", backgroundColor: "#071015ee", padding: { x: 7, y: 4 } });
    this.debugText.setPosition(medio.x + 8, medio.y - 10);
    const objetivoVisual = intencionAtaque?.objetivos?.find(o => o.targetId === s.targetActorId);
    const lectura = probabilidadObjetivo(objetivoVisual, intencionAtaque?.modoFuego);
    let texto = lectura
      ? `${lectura.final}% · ${etiquetaCobertura(cover.level, cover.canAttack)}\n${distancia.toFixed(1)} m · sin cobertura ${lectura.base}%`
      : `${distancia.toFixed(1)} m · ${etiquetaCobertura(cover.level, cover.canAttack)}`;
    if (this._debugSpatial) texto += `\n${s.currentActorId} → ${s.targetActorId}${cover.source ? ` · ${cover.source}` : ""}`;
    const u = this._debugUltimoAtaque;
    if (u && u.attacker === s.currentActorId && u.target === s.targetActorId) {
      texto += u.rechazado ? `\nRECHAZADO: ${u.reasons.join(", ")}` : `\ntirada=${u.tirada} ${u.exito ? "éxito" : "fallo"}${u.esCritico ? " CRIT" : ""}${u.esPifia ? " PIFIA" : ""}\n${u.impacto ? `hit ${u.localizacion} dmg=${u.danioFinal}` : "miss/absorbido"}`;
    }
    this.debugText.setText(texto);
  }
}
