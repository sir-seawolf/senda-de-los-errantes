// Configuración global del prototipo: flags de efectos visuales baratos y
// accesibilidad. Todo desactivable; nada aquí depende de librerías externas.
export const config = {
  visualEffects: {
    fog: true,          // oscurecimiento adicional por distancia en el raycaster
    vignette: true,      // viñeta CSS en los bordes de la vista 2.5D
    headBob: true,       // leve balanceo de cámara al moverse
    screenShake: true,   // sacudida breve al recibir daño / ser alcanzado
    rain: true,           // overlay de lluvia (CSS puro, sin coste de dibujo por frame) — activado en 0.2 visual (pasada 2) para la atmósfera húmeda/noir de Predator
    muzzleFlash: true,    // destello breve al disparar
    impactFlash: true,    // destello breve al impactar/recibir un impacto
    sceneFade: true,       // fundido breve al cambiar de escena
    panoramicLighting: true // halo de farola + luz de suelo en escenas panorámicas (Localización C) — puramente decorativo, ningún hotspot/pista depende de que esté activo
  },
  accessibility: {
    reduceMotion: false,  // desactiva headBob y suaviza el screenShake
    largeUI: false         // aumenta el tamaño de fuente base de la interfaz
  },
  input: {
    // "auto": se muestran solo si el dispositivo declara soporte táctil
    // (navigator.maxTouchPoints/ontouchstart — nunca solo por user-agent) o,
    // si ni eso lo detecta, en cuanto llega el primer touchstart real.
    // "left"/"right": fuerza el joystick a ese lado (INTERACTUAR va al
    // contrario). "off": nunca se muestran. Nunca sustituye WASD/flechas en
    // escritorio — ver src/engine/renderers/raycast.js.
    touchControls: "auto"
  },
  tactical: {
    // TACTICAL_PHASER_ENABLED (docs/TACTICAL_PRODUCTION_PHASE1.md). Con
    // `false` (default), una escena `type: "tactical-phaser"` cae siempre
    // al renderer de combate actual (src/engine/renderers/combat.js) sin
    // que Phaser participe en absoluto -- Fase 1 no activa nada por
    // defecto, ni para Predator ni para ningún otro módulo. Activar esto a
    // `true` en desarrollo NO integra el Tactical Engine real todavía (eso
    // es Fase 2) -- solo permite ejercitar el stub de
    // src/tactical/tacticalPhaserRenderer.js.
    // Activado para la demo jugable de playtest (encargo de sesión,
    // 2026-08-21): el encuentro táctico real de Predator
    // (predator_combate_inicial_tactical) ya declara su propio
    // `renderer:"phaser-tactical-isometric"` -- sin este flag en `true`
    // el juego seguiría cayendo siempre al combate legacy y nunca se
    // vería. Ningún otro módulo ni encuentro se ve afectado por este
    // cambio de default (todos los demás siguen sin declarar una
    // definición táctica real, ver tacticalPhaserRenderer.js).
    phaserEnabled: true,
    // Production Integration Phase 6B (docs/TACTICAL_PRODUCTION_PHASE6_AUDIT.md
    // §5). Con `false` (default), TacticalScene sigue mostrando su HUD/panel
    // de Phaser GameObjects de siempre (sin cambios). Con `true`, monta
    // ADEMÁS la capa de interfaz DOM/CSS responsive (resumen contextual,
    // ficha completa, tres familias de acciones) como hermana del canvas.
    // Activada para la demo de playtest (encargo de sesión, 2026-08-21):
    // sustituye en la demo pública el panel clásico de 8 botones por la
    // interfaz responsive de 6B (TacticalScene._crearHud()/
    // _crearPanelAcciones() ocultan e inhabilitan el panel clásico
    // cuando este flag es true -- nunca dos juegos de controles a la
    // vez). El renderer cenital y el spike oblicuo no se ven afectados.
    responsiveUI: true
  },
  // Ayudas visibles solo para desarrollo/QA del piloto de Localización C
  // (docs/CONTRATO_VISUAL_PREDATOR.md) -- ambas en `false` por defecto porque
  // ninguna debe ocupar espacio ni distraer en una presentación jugable real.
  debug: {
    // Círculos/radio y rótulo permanentes de cada hotspot (en vez de la
    // indicación contextual por proximidad/foco). Solo para verificar áreas
    // interactivas durante el desarrollo.
    showHotspotAreas: false,
    // Nota técnica del piloto ("no sustituye a la escena real..."). Nunca en
    // una escena jugable real -- ver panoramic.js.
    showPanoramicDevNote: false,
    // Líneas, fórmulas y detalle del último ataque sobre el tablero táctico.
    // Se activa manualmente con C durante QA; nunca nace visible en producción.
    showTacticalSpatial: false,
    // Cuadrícula del mundo, banda caminable, línea de pies, cajas de
    // objetos/anclajes/hotspots (docs/CALIBRACION_GEOMETRICA_CALLEJON_
    // PREDATOR.md, punto 1). Genérica -- sirve para cualquier escena
    // "panoramic", no solo el callejón. Ver panoramicCalibration.js.
    showPanoramicCalibration: false
  }
};

export function aplicarAccesibilidad() {
  document.documentElement.classList.toggle("reduce-motion", config.accessibility.reduceMotion);
  document.documentElement.classList.toggle("large-ui", config.accessibility.largeUI);
  if (config.accessibility.reduceMotion) {
    config.visualEffects.headBob = false;
  }
}
