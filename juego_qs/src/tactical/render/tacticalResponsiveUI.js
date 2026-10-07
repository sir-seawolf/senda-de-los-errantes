// Interfaz táctica DOM responsive -- Production Integration Phase 6B
// (docs/TACTICAL_PRODUCTION_PHASE6_AUDIT.md §5,
// docs/PROPUESTA_UI_TACTICA_RESPONSIVE_PREDATOR.md).
//
// Capa HTML/CSS montada como hermana del <canvas> de Phaser dentro de
// `#tactical-root` -- NUNCA dibuja sobre el canvas ni compite por su
// input de tablero (clics de movimiento/selección de objetivo siguen
// siendo responsabilidad de TacticalScene, sin cambios). Esta capa
// SOLO: (a) muestra el snapshot que emite `tactical-ui-state`, (b)
// traduce clics/toques/teclado en llamadas al controlador de acciones
// compartido (tacticalActionController.js, vía `scene.controlador`) o
// al puente mínimo `scene.alternarModoMover()`. Cero lógica de reglas
// aquí -- si una acción es legal o no ya viene decidido en el snapshot
// (tacticalActionCatalog.js).
//
// Detrás de `config.tactical.responsiveUI` (dev flag, default false) --
// ver TacticalScene.js `_montarInterfazResponsive()`.
import { construirSnapshotUI } from "./tacticalUIState.js";
import { rutaAsset } from "../../engine/moduleLoader.js";
import { etiquetaCobertura, probabilidadObjetivo } from "./tacticalSpatialPresentation.js";

const ESTILOS_ID = "tactical-responsive-ui-styles";

// Colores Y recurso de panel vía la capa de tema (encargo de sesión,
// 2026-08-21, ver theme.css): esta interfaz genérica ya NO fija su
// propia paleta ni conoce ningún recurso concreto de ningún módulo --
// lee los mismos tokens semánticos que el resto del motor (`--color-*`,
// `--panel-decorado`), seleccionados por `[data-theme]` según el
// módulo activo (moduleLoader.js). Con eso, la estructura de esta
// interfaz no cambia nunca por tema, solo su color/decoración:
// exactamente lo pedido ("la estructura, dimensiones y comportamiento
// de la interfaz no cambian con el tema"). Qué textura (si alguna) usa
// cada tema para `--panel-decorado` -- p.ej. la textura CC0 de hormigón
// del tema predator-urban, ver docs/PREDATOR_VISUAL_RESOURCES_MANIFEST_6D.md
// -- es responsabilidad exclusiva de theme.css, no de este archivo:
// este motor es agnóstico de módulo (ver tests/tacticalCoreHygiene.test.mjs).
// Mapeo semántico (mismo criterio que theme.css): superficie/borde son
// fondo neutro; texto es la información legible; selección es el
// acento de decisión; peligro es el aviso de riesgo; información es el
// acento instrumental, usado con moderación, nunca como color base.
const CSS = `
.tui-root { position: absolute; inset: 0; pointer-events: none; font-family: "Barlow Condensed", sans-serif; color: var(--color-texto); z-index: 500; }
.tui-root * { box-sizing: border-box; }
.tui-root button { font-family: inherit; cursor: pointer; }
.tui-summary { position: absolute; top: 10px; left: 10px; pointer-events: auto; }
.tui-equipment-btn { width: 100%; min-height: 34px; margin-top: 4px; border: 1px solid #344a53; background: rgba(7,14,18,.96); color: var(--color-informacion); text-transform: uppercase; letter-spacing: .1em; font-size: 10px; }
.tui-equipment-btn:hover:not([disabled]) { border-color: var(--color-seleccion); color: var(--color-texto); }
.tui-equipment-btn[disabled] { opacity: .4; cursor: not-allowed; }
.tui-summary-btn {
  display: flex; align-items: center; gap: 10px; min-height: 62px; padding: 6px 14px 6px 6px;
  background: linear-gradient(105deg, rgba(8,14,17,.97), rgba(19,28,32,.92)); border: 1px solid #38515a; color: var(--color-texto); font-size: 12px;
  /* La economía de acciones (Hallazgo 3) alarga el texto de estado --
     se limita el ancho al viewport real y se deja envolver en vez de
     desbordar fuera de pantalla en móvil. */
  max-width: min(360px, calc(100vw - 16px));
}
.tui-summary-estado { white-space: normal; }
.tui-summary-btn:focus-visible, .tui-root button:focus-visible { outline: 2px solid var(--color-seleccion); outline-offset: 2px; }
/* Retrato provisional (encargo de sesión, 2026-08-21): placa
   chaflanada en vez de círculo plano -- lenguaje de "credencial/rango"
   de terminal militar, sin depender de ningún recurso de icono nuevo
   (evita abrir un sourcing CC0 para algo tan pequeño). */
.tui-summary-portrait { width: 48px; height: 48px; flex: none; background-size: cover; background-position: center 20%; filter: saturate(.72) contrast(1.08); clip-path: polygon(12% 0, 100% 0, 100% 88%, 88% 100%, 0 100%, 0 12%); border: 1px solid var(--color-informacion); }
.tui-summary-portrait.abajo { filter: grayscale(1) brightness(.55); }
.tui-summary-nombre { font-weight: bold; letter-spacing: .3px; }
.tui-summary-estado { font-size: 10px; color: var(--color-informacion); }
.tui-summary-estado.herido { color: var(--color-seleccion); }
.tui-summary-estado.tullido { color: var(--color-peligro); }

.tui-sheet {
  position: absolute; pointer-events: auto; border: 1px solid var(--color-borde);
  overflow-y: auto; padding: 14px; font-size: 12px; line-height: 1.6; color: var(--color-texto);
  background-color: var(--color-superficie);
  background-image: var(--panel-decorado, none);
  background-size: cover; background-position: center;
}
.tui-sheet[hidden] { display: none; }
/* Marco industrial discreto (encargo de sesión, 2026-08-21): esquinas
   marcadas en el panel principal, motivo de "placa/terminal" ya
   establecido en el resto de la interfaz -- puramente decorativo
   (.tui-sheet ya es position:absolute, así que estas esquinas se
   posicionan contra ese mismo bloque; no reserva espacio ni desplaza
   ningún hijo). */
.tui-sheet::before, .tui-sheet::after {
  content: ""; position: absolute; width: 14px; height: 14px; pointer-events: none; opacity: .55;
  border-color: var(--color-informacion); border-style: solid; border-width: 0;
}
.tui-sheet::before { top: 6px; left: 6px; border-top-width: 2px; border-left-width: 2px; }
.tui-sheet::after { bottom: 6px; right: 6px; border-bottom-width: 2px; border-right-width: 2px; }
.tui-sheet h3 { margin: 0 0 8px; font-size: 14px; color: var(--color-seleccion); letter-spacing: .5px; }
.tui-sheet .tui-close { position: sticky; top: 0; float: right; min-width: 44px; min-height: 44px; background: var(--color-fondo); border: 1px solid var(--color-borde); color: var(--color-peligro); border-radius: 3px; }
.tui-sheet .tui-close svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.tui-sheet dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; }
.tui-sheet dt { color: var(--color-informacion); }

.tui-actionbar {
  position: absolute; left: 50%; bottom: 8px; width: min(760px, calc(100% - 16px)); transform: translateX(-50%); pointer-events: auto;
  display: grid; grid-template-columns: repeat(3, 1fr) auto; gap: 4px; padding: 5px; background: rgba(7,12,15,.96);
  border: 1px solid #38515a; box-shadow: 0 12px 36px rgba(0,0,0,.62);
}
.tui-actionbar::before {
  content: ""; position: absolute; top: 4px; left: 4px; width: 14px; height: 14px; opacity: .55; pointer-events: none;
  border-top: 2px solid var(--color-informacion); border-left: 2px solid var(--color-informacion);
}
.tui-fam-btn, .tui-contextual-btn {
  min-width: 44px; min-height: 56px; padding: 6px 14px; background: linear-gradient(#192227,#0c1215); border: 1px solid #2c3c43;
  color: var(--color-texto); font-size: 13px; letter-spacing: .08em; text-transform: uppercase; display: flex; align-items: center; justify-content: center; gap: 8px;
}
.tui-fam-btn svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.4; }
/* Acento por familia (MATRIZ_UI_ACCIONES_PREDATOR.md §"Lenguaje visual") --
   el color nunca es el único código: cada botón lleva su etiqueta de
   texto siempre visible, el color solo refuerza. */
.tui-fam-btn[data-familia="ofensivas"][aria-expanded="true"] { border-color: var(--color-peligro); color: var(--color-peligro); }
.tui-fam-btn[data-familia="tacticas"][aria-expanded="true"] { border-color: var(--color-informacion); color: var(--color-informacion); }
.tui-fam-btn[data-familia="defensivas"][aria-expanded="true"] { border-color: var(--color-seleccion); color: var(--color-seleccion); }
.tui-fam-btn.tui-todas-ilegales { opacity: 0.45; }
.tui-contextual-btn { margin-left: auto; color: var(--color-peligro); }
.tui-contextual-btn.tui-activo { border-color: var(--color-seleccion); color: var(--color-seleccion); }

.tui-tray {
  position: absolute; left: 50%; width: min(650px, calc(100% - 20px)); transform: translateX(-50%); bottom: 74px; pointer-events: auto;
  background: rgba(7,12,15,.98); border: 1px solid #38515a; padding: 8px;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 5px; max-height: 42vh; overflow-y: auto;
}
.tui-tray[hidden] { display: none; }
.tui-action-btn {
  min-height: 64px; padding: 8px 10px; text-align: center; background: linear-gradient(#182126,#0b1114); border: 1px solid #2d3d44;
  color: var(--color-texto); font-size: 12px; display: flex; flex-direction: column; justify-content: center; gap: 5px; text-transform: uppercase; letter-spacing: .06em;
}
.tui-mode-selector { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: auto; padding: 16px; background: rgba(2,5,7,.5); backdrop-filter: blur(2px); }
.tui-mode-card { width: min(620px, 96vw); padding: 18px; border: 1px solid #48616a; background: linear-gradient(145deg, rgba(15,24,28,.98), rgba(5,9,11,.98)); box-shadow: 0 22px 70px #000; }
.tui-mode-card small { color: var(--color-informacion); text-transform: uppercase; letter-spacing: .16em; }
.tui-mode-card h2 { margin: 4px 0 14px; text-transform: uppercase; letter-spacing: .08em; }
.tui-mode-options { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; }
.tui-mode-options button { min-height: 88px; padding: 12px; border: 1px solid #2d3d44; background: #0c1316; color: var(--color-texto); text-align: left; }
.tui-mode-options strong, .tui-mode-options span { display: block; }
.tui-mode-options strong { color: var(--color-informacion); text-transform: uppercase; letter-spacing: .08em; }
.tui-mode-options span { margin-top: 5px; color: var(--color-texto-tenue); font-size: .74rem; line-height: 1.35; }
@media (max-width: 620px) { .tui-mode-options { grid-template-columns: 1fr; } .tui-mode-options button { min-height: 62px; } .tui-actionbar { grid-template-columns: repeat(3,1fr); } .tui-contextual-btn { grid-column: 1 / -1; min-height: 44px; } }
.tui-action-btn[disabled] { opacity: 0.4; cursor: not-allowed; color: #999; }
.tui-action-btn .tui-motivo { font-size: 10px; color: var(--color-peligro); }

.tui-flow {
  position: absolute; left: 50%; width: min(760px, calc(100% - 20px)); bottom: 60px; transform: translateX(-50%); pointer-events: auto;
  background: rgba(5,10,13,.96); border: 1px solid #49616b; padding: 10px;
  display: flex; flex-direction: column; gap: 7px; color: var(--color-texto); box-shadow: 0 18px 48px rgba(0,0,0,.68);
}
.tui-flow[hidden] { display: none; }
.tui-flow-botones { display: flex; gap: 8px; }
.tui-flow-botones button { flex: 1; min-height: 36px; border-radius: 3px; border: 1px solid var(--color-borde); font-size: 12px; }
.tui-flow-confirmar { background: rgba(101,183,199,0.15); color: var(--color-informacion); border-color: var(--color-informacion); }
.tui-flow-confirmar[disabled] { opacity: 0.4; cursor: not-allowed; }
.tui-flow-cancelar { background: rgba(184,75,71,0.12); color: var(--color-peligro); border-color: var(--color-peligro); }
.tui-fire-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.tui-fire-head strong { color:#e7eef0; text-transform:uppercase; letter-spacing:.12em; }
.tui-fire-modes { display:flex; gap:4px; }
.tui-fire-mode { min-height:34px; padding:5px 10px; border:1px solid #344a53; background:#0c1519; color:#aebec4; }
.tui-fire-mode[aria-pressed="true"] { border-color:var(--color-seleccion); color:var(--color-seleccion); background:rgba(215,179,92,.1); }
.tui-targets { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; max-height:25vh; overflow:auto; scrollbar-color:#49616b #081014; }
.tui-target { width:100%; min-height:48px; display:grid; grid-template-columns:minmax(120px,1.45fr) auto; grid-template-areas:"name chance" "distance cover"; align-items:center; gap:2px 10px; padding:4px 9px; text-align:left; border:1px solid #273941; background:#0a1216; color:#cfdadd; }
.tui-target:hover:not([disabled]) { border-color:#66818b; background:#101c21; }
.tui-target[aria-pressed="true"] { border-color:var(--color-seleccion); background:rgba(215,179,92,.08); }
.tui-target-name { grid-area:name; color:#edf3f4; text-transform:uppercase; letter-spacing:.06em; }
.tui-target-data { color:#91aab3; font-variant-numeric:tabular-nums; }
.tui-target-distance { grid-area:distance; }
.tui-target-cover { grid-area:cover; text-align:right; }
.tui-target-chance { grid-area:chance; color:var(--color-informacion); text-align:right; font-variant-numeric:tabular-nums; }
.tui-target-chance strong, .tui-target-chance small { display:block; }
.tui-target-chance strong { font-size:16px; line-height:1; }
.tui-target-chance small { margin-top:3px; color:#91aab3; font-size:9px; font-weight:500; white-space:nowrap; text-transform:uppercase; letter-spacing:.04em; }
.tui-target[disabled] { opacity:.48; cursor:not-allowed; }
@media (max-width:620px) { .tui-flow { bottom:54px; } .tui-targets { grid-template-columns:1fr; max-height:30vh; } .tui-target { grid-template-columns:1fr auto; } .tui-target-cover { display:none; } .tui-fire-head { align-items:flex-start; flex-direction:column; } }

/* PC (puntero fino, ancho suficiente): ficha como panel lateral */
@media (min-width: 900px) and (pointer: fine) {
  .tui-sheet { top: 0; right: 0; bottom: 0; width: 320px; border-left: 1px solid var(--color-borde); border-top: none; border-bottom: none; border-right: none; }
}
/* Móvil vertical: ficha como hoja inferior (65-75% alto) */
@media (max-width: 899px), (pointer: coarse) {
  @media (orientation: portrait) {
    .tui-sheet { left: 0; right: 0; bottom: 0; height: 70dvh; border-radius: 12px 12px 0 0; border-top: 1px solid var(--color-borde); border-left: none; border-right: none; border-bottom: none; }
    .tui-sheet-grabber { display: block; width: 40px; height: 4px; background: var(--color-borde); border-radius: 2px; margin: 0 auto 8px; }
  }
  /* Móvil horizontal: ficha como panel lateral 35-40% ancho */
  @media (orientation: landscape) {
    .tui-sheet { top: 0; right: 0; bottom: 0; width: 38%; border-left: 1px solid var(--color-borde); border-top: none; border-bottom: none; border-right: none; }
  }
}
.tui-sheet-grabber { display: none; }

/* Composición táctica de escritorio: el tablero sigue siendo la pieza
   principal y el cromado se apoya en sus bordes sin convertirlo en una
   colección de paneles independientes. */
.tui-root { --tui-panel: rgba(7, 14, 18, .96); --tui-edge: #344a53; --tui-cyan: #72c7dc; }
.tui-stage-label { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); padding: 5px 12px; color: var(--tui-cyan); background: rgba(5, 11, 14, .88); border-bottom: 1px solid var(--tui-edge); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
.tui-summary { top: 10px; left: 10px; }
.tui-summary-btn { position: relative; width: 260px; min-height: 66px; padding: 6px 52px 6px 6px; gap: 9px; border-color: var(--tui-edge); border-radius: 2px; background: var(--tui-panel); box-shadow: 0 8px 24px rgba(0,0,0,.42); text-align: left; }
.tui-summary-portrait { width: 52px; height: 52px; clip-path: none; border: 1px solid #53717c; }
.tui-summary-nombre { display: block; color: #e7eef0; font-size: 13px; letter-spacing: .1em; text-transform: uppercase; }
.tui-summary-estado { display: block; margin-top: 3px; color: var(--tui-cyan); line-height: 1.2; }
.tui-summary-ficha { position: absolute; top: 7px; right: 7px; padding: 3px 6px; border: 1px solid var(--tui-edge); color: var(--tui-cyan); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.tui-sheet { background: var(--tui-panel); border-color: var(--tui-edge); box-shadow: -18px 0 42px rgba(0,0,0,.48); }
.tui-sheet h3 { color: var(--tui-cyan); font-size: 18px; text-transform: uppercase; letter-spacing: .12em; }
.tui-sheet .tui-close { width: auto; min-width: 58px; height: 32px; min-height: 32px; padding: 0 9px; border-radius: 0; color: #c6d5d9; background: #101a1f; text-transform: uppercase; font-size: 10px; letter-spacing: .08em; }
.tui-actionbar { bottom: 8px; width: min(760px, calc(100% - 24px)); min-height: 62px; grid-template-columns: repeat(3, minmax(130px, 1fr)) 86px; gap: 4px; padding: 5px; border-color: var(--tui-edge); border-radius: 2px; background: var(--tui-panel); }
.tui-fam-btn, .tui-contextual-btn { min-height: 50px; border-color: #2a3d45; border-radius: 1px; background: #10191d; color: #aebdc2; }
.tui-fam-btn img { width: 24px; height: 24px; object-fit: contain; filter: grayscale(1) brightness(1.65); opacity: .8; }
.tui-fam-btn[aria-expanded="true"] { background: #13262e; box-shadow: inset 0 0 18px rgba(96,190,214,.12); }
.tui-fam-btn[aria-expanded="true"] img { filter: none; opacity: 1; }
.tui-contextual-btn { margin-left: 0; font-size: 11px; }
.tui-tray { bottom: 74px; width: min(610px, calc(100% - 28px)); min-height: 104px; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 4px; padding: 6px; border-color: var(--tui-edge); border-radius: 2px; background: var(--tui-panel); box-shadow: 0 -14px 34px rgba(0,0,0,.5); }
.tui-tray::after { content: ""; position: absolute; bottom: -7px; left: 50%; width: 12px; height: 12px; transform: translateX(-50%) rotate(45deg); border-right: 1px solid var(--tui-edge); border-bottom: 1px solid var(--tui-edge); background: var(--tui-panel); }
.tui-action-btn { min-height: 90px; padding: 8px; border-color: #2a3d45; border-radius: 1px; background: #111a1f; color: #d1dde0; }
.tui-action-btn img { width: 28px; height: 28px; margin: 0 auto 2px; object-fit: contain; filter: grayscale(.25) brightness(1.2); }
.tui-action-btn:not([disabled]):hover { border-color: var(--tui-cyan); background: #14272f; color: #effcff; }
.tui-mode-selector { background: rgba(1,5,7,.7); backdrop-filter: blur(1px); }
.tui-mode-card { width: min(680px, 96vw); padding: 22px; border-radius: 2px; border-color: var(--tui-edge); background: #081014; }
.tui-mode-card h2 { color: #e6eef0; }
.tui-mode-options button { background: #0e181d; border-color: #30434b; border-radius: 1px; }
.tui-mode-options button:hover { border-color: var(--tui-cyan); background: #13262e; }
@media (max-width: 700px) {
  .tui-stage-label { display: none; }
  .tui-summary-btn { width: min(250px, calc(100vw - 72px)); }
  .tui-actionbar { grid-template-columns: repeat(3, 1fr); }
  .tui-fam-btn { padding: 5px; font-size: 10px; gap: 4px; }
  .tui-fam-btn img { width: 20px; height: 20px; }
  .tui-contextual-btn { grid-column: 1 / -1; min-height: 36px; }
  .tui-tray { bottom: 104px; grid-template-columns: repeat(2, 1fr); max-height: 48vh; }
}
`;

function asegurarEstilos() {
  if (document.getElementById(ESTILOS_ID)) return;
  const style = document.createElement("style");
  style.id = ESTILOS_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const LABEL_FAMILIA = { ofensivas: "Ofensivas", tacticas: "Tácticas", defensivas: "Defensivas" };
const MOTIVO_LEGIBLE = {
  NO_AMMO: "sin munición", NO_RESERVE: "sin reserva", MAIN_ACTION_SPENT: "acción ya gastada",
  MINOR_ACTION_SPENT: "acción menor ya gastada", NOT_ENOUGH_MOVEMENT: "sin movimiento suficiente",
  NO_MOVEMENT_REMAINING: "sin movimiento restante", TARGET_FULLY_COVERED: "objetivo sin línea de tiro",
  NO_SECONDARY_WEAPON: "sin arma secundaria", NO_DODGE_CAPABILITY: "sin capacidad de esquiva",
  NO_RANGED_WEAPON: "sin arma a distancia equipada", NO_MELEE_WEAPON: "sin arma cuerpo a cuerpo equipada",
  NO_TARGETS_AVAILABLE: "sin objetivos", WEAPON_ALREADY_READY: "arma ya lista",
  POSITION_OCCUPIED: "posición ocupada por otro actor"
};
function motivoLegible(reasons) {
  if (!reasons?.length) return "";
  return reasons.map(r => MOTIVO_LEGIBLE[r] ?? r).join(", ");
}

/**
 * @param {HTMLElement} rootEl - `#tactical-root`, mismo contenedor del <canvas>
 * @param {import("./TacticalScene.js").TacticalScene} scene
 * @returns {{destroy(): void, openActions(family?: string): void}}
 */
export function montarInterfazResponsive(rootEl, scene) {
  asegurarEstilos();

  const estado = { fichaAbierta: false, familiaAbierta: null, accionPreparada: null, modoFuego: "tiroATiro", hoverTimer: null };

  const root = document.createElement("div");
  root.className = "tui-root";

  const summary = document.createElement("div");
  summary.className = "tui-summary";
  const summaryBtn = document.createElement("button");
  summaryBtn.className = "tui-summary-btn";
  summaryBtn.setAttribute("aria-haspopup", "dialog");
  summaryBtn.innerHTML = `<span class="tui-summary-portrait" aria-hidden="true"></span><span><span class="tui-summary-nombre"></span><span class="tui-summary-estado"></span></span><span class="tui-summary-ficha">Ficha</span>`;
  const equipmentBtn = document.createElement("button");
  equipmentBtn.className = "tui-equipment-btn";
  equipmentBtn.type = "button";
  equipmentBtn.textContent = "Equipo e inventario";
  summary.append(summaryBtn, equipmentBtn);

  const stageLabel = document.createElement("div");
  stageLabel.className = "tui-stage-label";
  stageLabel.textContent = scene.definition.ui?.locationLabel ?? scene.definition.id?.replaceAll("_", " ") ?? "Escenario táctico";

  const sheet = document.createElement("div");
  sheet.className = "tui-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Ficha del personaje");
  sheet.hidden = true;

  const actionbar = document.createElement("div");
  actionbar.className = "tui-actionbar";
  const botonesFamilia = {};
  for (const fam of ["ofensivas", "tacticas", "defensivas"]) {
    const b = document.createElement("button");
    b.className = "tui-fam-btn";
    b.type = "button";
    b.dataset.familia = fam;
    const icono = scene.definition.assets?.ui?.actionFamilies?.[fam];
    b.innerHTML = `${icono ? `<img src="${rutaAsset(icono)}" alt="">` : ""}<span>${LABEL_FAMILIA[fam]}</span>`;
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-haspopup", "true");
    actionbar.appendChild(b);
    botonesFamilia[fam] = b;
  }
  const contextualBtn = document.createElement("button");
  contextualBtn.className = "tui-contextual-btn";
  contextualBtn.type = "button";
  contextualBtn.textContent = "Terminar";
  actionbar.appendChild(contextualBtn);

  const tray = document.createElement("div");
  tray.className = "tui-tray";
  tray.hidden = true;
  tray.setAttribute("role", "menu");

  const flow = document.createElement("div");
  flow.className = "tui-flow";
  flow.hidden = true;

  const selector = document.createElement("div");
  selector.className = "tui-mode-selector";
  const pj = scene.session.party.find(actor => actor.esPJ) ?? scene.session.party[0];
  selector.innerHTML = `<section class="tui-mode-card"><h2>Asignar control</h2><div class="tui-mode-options">
    <button type="button" data-modo="manual"><strong>Grupo manual</strong><span>Control directo de todo el equipo.</span></button>
    <button type="button" data-modo="pj_manual"><strong>${pj?.nombre ?? "PJ"} manual</strong><span>Tu personaje bajo control; aliados automatizados.</span></button>
    <button type="button" data-modo="auto"><strong>Automático</strong><span>Resolución completa por perfiles tácticos.</span></button>
  </div></section>`;
  selector.querySelectorAll("[data-modo]").forEach(btn => btn.addEventListener("click", () => {
    const modo = btn.dataset.modo;
    selector.remove();
    scene._iniciarCombate(modo);
    if (modo !== "auto") window.setTimeout(() => abrirFamilia("tacticas"), 0);
  }));
  root.append(stageLabel, summary, sheet, tray, flow, actionbar, selector);
  rootEl.appendChild(root);

  let ultimoSnapshot = construirSnapshotUI(scene.session, scene.adapter, scene.session.currentActorId, { modoMoverActivo: scene._modoMover, cadenciaData: scene._cadenciaDataEntrante });

  function cerrarTray() { estado.familiaAbierta = null; tray.hidden = true; for (const fam in botonesFamilia) botonesFamilia[fam].setAttribute("aria-expanded", "false"); }
  function cerrarFlow() { estado.accionPreparada = null; flow.hidden = true; scene.actualizarIntencionVisual?.(null); }
  function cerrarFicha() { estado.fichaAbierta = false; sheet.hidden = true; }

  // CORRECCIÓN (verificación de activación 6B, 2026-08-21): la barra de
  // familias puede envolver a más de una fila en un viewport estrecho
  // (4 botones -- 3 familias + Terminar -- no siempre caben en una
  // fila). Un `bottom` fijo en CSS asumía una altura de barra constante
  // y la bandeja/el flujo de confirmación quedaban parcialmente debajo
  // de la barra real cuando esta envolvía. Se posiciona en JS con la
  // altura REAL medida de la barra (mismo criterio que la corrección
  // del menú contextual táctil en narrative.js).
  function ajustarSobreBarra(el) {
    el.style.bottom = `${actionbar.getBoundingClientRect().height + 4}px`;
  }

  function abrirFamilia(fam) {
    cerrarFlow();
    if (estado.familiaAbierta === fam) { cerrarTray(); return; }
    estado.familiaAbierta = fam;
    for (const f in botonesFamilia) botonesFamilia[f].setAttribute("aria-expanded", String(f === fam));
    renderTray();
    ajustarSobreBarra(tray);
    tray.hidden = false;
  }

  function ejecutarAccionSimple(id) {
    const c = scene.controlador;
    if (id === "mover") { scene.alternarModoMover(); cerrarTray(); return; }
    if (id === "recargar") c.recargar();
    else if (id === "cambiarArma") c.cambiarArma();
    else if (id === "defender") c.defender();
    else if (id === "esquivar") c.evadir();
    cerrarTray();
  }

  function prepararAccionConObjetivo(accion) {
    estado.accionPreparada = accion;
    estado.modoFuego = "tiroATiro";
    cerrarTray();
    renderFlow();
    ajustarSobreBarra(flow);
    flow.hidden = false;
  }

  function onAccionElegida(accion) {
    if (!accion.legal) return;
    if (accion.id === "disparar" || accion.id === "cc") prepararAccionConObjetivo(accion);
    else ejecutarAccionSimple(accion.id);
  }

  function renderTray() {
    tray.innerHTML = "";
    const acciones = ultimoSnapshot.catalogo.familias[estado.familiaAbierta] ?? [];
    for (const a of acciones) {
      const btn = document.createElement("button");
      btn.className = "tui-action-btn";
      btn.type = "button";
      btn.disabled = !a.legal;
      btn.setAttribute("role", "menuitem");
      btn.setAttribute("aria-disabled", String(!a.legal));
      const icono = scene.definition.assets?.ui?.actionFamilies?.[estado.familiaAbierta];
      btn.innerHTML = `${icono ? `<img src="${rutaAsset(icono)}" alt="">` : ""}<span>${a.label}</span>${!a.legal ? `<span class="tui-motivo">${motivoLegible(a.reasons)}</span>` : ""}`;
      btn.addEventListener("click", () => onAccionElegida(a));
      tray.appendChild(btn);
    }
  }

  function renderFlow() {
    const preparada = estado.accionPreparada;
    const a = preparada ? Object.values(ultimoSnapshot.catalogo.familias).flat().find(item => item.id === preparada.id) ?? preparada : null;
    if (!a) return;
    const necesitaObjetivo = a.id === "disparar" || a.id === "cc";
    const objetivoListo = !necesitaObjetivo || !!ultimoSnapshot.targetActorId;
    const modos = a.id === "disparar" ? (a.modosFuego ?? []) : [];
    const objetivos = a.objetivos ?? [];
    const modoElegido = modos.find(m => m.id === estado.modoFuego) ?? modos[0];
    scene.actualizarIntencionVisual?.({ tipo: "ataque", accionId: a.id, modoFuego: estado.modoFuego, objetivos });
    flow.innerHTML = `
      <div class="tui-fire-head"><strong>${a.id === "disparar" ? "Consola de tiro" : a.label}</strong>${modos.length ? `<div class="tui-fire-modes">${modos.map(m => `<button type="button" class="tui-fire-mode" data-fire-mode="${m.id}" aria-pressed="${m.id === estado.modoFuego}" ${m.legal ? "" : "disabled"}>${m.label} · ${m.municion} ${m.municion === 1 ? "bala" : "balas"}${m.bonusExitos ? ` · +${m.bonusExitos}` : ""}</button>`).join("")}</div>` : ""}</div>
      <div class="tui-targets" aria-label="Objetivos posibles">${objetivos.map(o => {
        const lectura = probabilidadObjetivo(o, estado.modoFuego);
        const cobertura = etiquetaCobertura(o.cover, o.canAttack);
        const probabilidad = a.id === "disparar" ? `<span class="tui-target-chance"><strong>${lectura.final}%</strong><small>sin cobertura ${lectura.base}%</small></span>` : `<span class="tui-target-chance"><strong>CC</strong></span>`;
        return `<button type="button" class="tui-target" data-target-id="${o.targetId}" aria-pressed="${o.targetId === ultimoSnapshot.targetActorId}" ${o.valid ? "" : "disabled"}><span class="tui-target-name">${o.nombre}</span><span class="tui-target-data tui-target-distance">${o.distance} m</span><span class="tui-target-data tui-target-cover">${cobertura}</span>${probabilidad}</button>`;
      }).join("")}</div>
      <div class="tui-flow-botones">
        <button class="tui-flow-confirmar" type="button" ${objetivoListo && (modoElegido?.legal ?? true) ? "" : "disabled"}>${a.id === "disparar" ? "Abrir fuego" : "Confirmar"}</button>
        <button class="tui-flow-cancelar" type="button">Cancelar</button>
      </div>`;
    flow.querySelectorAll("[data-target-id]").forEach(btn => btn.addEventListener("click", () => scene.seleccionarObjetivo(btn.dataset.targetId)));
    flow.querySelectorAll("[data-fire-mode]").forEach(btn => btn.addEventListener("click", () => { estado.modoFuego = btn.dataset.fireMode; renderFlow(); }));
    flow.querySelector(".tui-flow-confirmar").addEventListener("click", () => {
      if (a.id === "disparar") scene._accionAtacar(ultimoSnapshot.targetActorId, { cc: false, modoFuego: estado.modoFuego });
      else if (a.id === "cc") scene._accionAtacar(ultimoSnapshot.targetActorId, { cc: true });
      cerrarFlow();
    });
    flow.querySelector(".tui-flow-cancelar").addEventListener("click", cerrarFlow);
  }

  function renderSheet() {
    const f = ultimoSnapshot.ficha;
    sheet.innerHTML = `<div class="tui-sheet-grabber"></div><button class="tui-close" type="button">Cerrar</button><h3>${f?.nombre ?? "--"}</h3>`;
    if (f) {
      const dl = document.createElement("dl");
      dl.innerHTML = `
        <dt>Herida</dt><dd>${f.nivelHerida}</dd>
        <dt>PV</dt><dd>${f.vida.sano}/${f.vida.herido}/${f.vida.tullido}</dd>
        <dt>Disparo</dt><dd>${f.habilidadDisparo ?? "--"}</dd>
        <dt>CaC</dt><dd>${f.habilidadCC ?? "--"}</dd>
        <dt>Esquiva</dt><dd>${f.habilidadEsquivar ?? "sin esquiva"}</dd>
        <dt>Arma activa</dt><dd>${f.armaActiva}</dd>`;
      sheet.appendChild(dl);
    }
    sheet.querySelector(".tui-close").addEventListener("click", cerrarFicha);
  }

  function renderResumen() {
    const r = ultimoSnapshot.resumen;
    const portrait = summaryBtn.querySelector(".tui-summary-portrait");
    const nombre = summaryBtn.querySelector(".tui-summary-nombre");
    const estadoEl = summaryBtn.querySelector(".tui-summary-estado");
    if (!r) { nombre.textContent = "Sin actor activo"; estadoEl.textContent = ""; portrait.classList.remove("abajo"); equipmentBtn.disabled = true; return; }
    nombre.textContent = r.nombre;
    const actorResource = scene.definition.assets?.portraits?.[r.actorId] ?? scene.definition.assets?.actors?.[r.actorId];
    const actorAsset = typeof actorResource === "string" ? actorResource : actorResource?.idle;
    portrait.style.backgroundImage = actorAsset ? `url("${rutaAsset(actorAsset)}")` : "none";
    portrait.classList.toggle("abajo", r.abajo);
    estadoEl.className = `tui-summary-estado ${r.nivelHerida}`;
    // "Economía de acciones visible" (Hallazgo 3 del playtest real,
    // encargo de cierre vertical 2026-08-22): acción principal, acción
    // menor y movimiento restante ya los calcula el motor
    // (activation.mainActionAvailable/minorActionAvailable/
    // movementRemaining, ver tacticalUIState.js resumenCompacto) -- antes
    // solo se mostraba el movimiento. No son fórmulas nuevas, solo se
    // exponen las que ya existían.
    const accionTxt = r.accionPrincipalDisponible === null ? "" : ` · acción ${r.accionPrincipalDisponible ? "libre" : "gastada"}`;
    const menorTxt = r.accionMenorDisponible === null ? "" : ` · menor ${r.accionMenorDisponible ? "libre" : "gastada"}`;
    estadoEl.textContent = r.abajo ? "ABAJO" : `${r.nivelHerida} · mov ${r.movimientoRestante}m${accionTxt}${menorTxt} · ${r.arma.nombre} ${r.arma.cargador}/${r.arma.reserva}`;
    equipmentBtn.disabled = !scene.session.esParty(r.actorId);
    equipmentBtn.dataset.actorId = r.actorId;
  }

  function renderContextual() {
    contextualBtn.classList.toggle("tui-activo", ultimoSnapshot.modoMoverActivo);
    const activo = !!ultimoSnapshot.resumen?.esControladoPorJugador && !ultimoSnapshot.resultado;
    for (const fam in botonesFamilia) {
      const acciones = ultimoSnapshot.catalogo.familias[fam] ?? [];
      botonesFamilia[fam].disabled = !activo;
      botonesFamilia[fam].classList.toggle("tui-todas-ilegales", acciones.length > 0 && acciones.every(a => !a.legal));
    }
    contextualBtn.disabled = !activo;
  }

  function onEstado(snapshot) {
    ultimoSnapshot = snapshot;
    renderResumen();
    renderContextual();
    if (estado.fichaAbierta) renderSheet();
    if (estado.familiaAbierta) renderTray();
    if (estado.accionPreparada) renderFlow();
  }

  // ===== Interacción =====
  summaryBtn.addEventListener("click", () => {
    estado.fichaAbierta = !estado.fichaAbierta;
    sheet.hidden = !estado.fichaAbierta;
    if (estado.fichaAbierta) renderSheet();
  });
  equipmentBtn.addEventListener("click", async () => {
    if (equipmentBtn.disabled) return;
    const { mostrarGestorInventario } = await import("../../ui/inventoryManager.js");
    mostrarGestorInventario(equipmentBtn.dataset.actorId);
  });

  for (const fam in botonesFamilia) {
    const btn = botonesFamilia[fam];
    btn.addEventListener("click", () => abrirFamilia(fam));
    // Hover/foco con retardo (solo ratón real -- el hover NUNCA ejecuta,
    // solo previsualiza; PROPUESTA_UI_TACTICA_RESPONSIVE_PREDATOR.md §4).
    btn.addEventListener("mouseenter", () => {
      if (estado.familiaAbierta) return; // ya hay una fijada -- el hover no la reemplaza
      estado.hoverTimer = window.setTimeout(() => { estado.familiaAbierta = fam; renderTray(); ajustarSobreBarra(tray); tray.hidden = false; }, 300);
    });
    btn.addEventListener("mouseleave", () => {
      window.clearTimeout(estado.hoverTimer);
    });
  }

  // CORRECCIÓN (Hallazgo 2 del playtest real, encargo de cierre
  // vertical 2026-08-22): llamar a `scene.controlador.terminarActuacion()`
  // directamente ejecuta el coste de fin de actuación pero NUNCA cede
  // el turno -- `_avanzarTurno()` solo lo llama el método de la
  // ESCENA `_accionTerminarActuacion()` (ver TacticalScene.js, usado
  // por el panel clásico), no el controlador puro. La bandeja 6B
  // llamaba solo al controlador, así que "Terminar" quedaba sin
  // efecto visible: reproducido en vivo ("Turno de Salim (manual)"
  // seguía activo después de pulsar Terminar). Se reutiliza el mismo
  // método de escena que ya usa el panel clásico -- cero lógica nueva.
  contextualBtn.addEventListener("click", () => scene._accionTerminarActuacion());

  document.addEventListener("keydown", onKeydown);
  function onKeydown(e) {
    if (e.key !== "Escape") return;
    if (!flow.hidden) { cerrarFlow(); return; }
    if (!tray.hidden) { cerrarTray(); return; }
    if (estado.fichaAbierta) cerrarFicha();
  }

  function onClickFuera(e) {
    if (root.contains(e.target)) return;
    cerrarTray();
  }
  scene.game.canvas?.addEventListener("pointerdown", onClickFuera);

  // Giro de móvil (encargo: "sin perder acción ni turno"): el estado
  // (familia abierta, acción preparada) ya sobrevive sin más -- vive en
  // `estado`, ajeno al ciclo de vida de Phaser -- pero la POSICIÓN de la
  // bandeja/flujo (dependiente de la altura real de la barra, ver
  // ajustarSobreBarra) sí debe recalcularse si la orientación cambia
  // mientras están abiertos.
  function onResize() {
    if (!tray.hidden) ajustarSobreBarra(tray);
    if (!flow.hidden) ajustarSobreBarra(flow);
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  scene.events.on("tactical-ui-state", onEstado);
  renderResumen();
  renderContextual();

  return {
    openActions(family = estado.familiaAbierta ?? "tacticas") {
      if (!ultimoSnapshot.resumen?.esControladoPorJugador || ultimoSnapshot.resultado) return;
      if (estado.familiaAbierta === family && !tray.hidden) return;
      abrirFamilia(family);
    },
    destroy() {
      scene.events.off("tactical-ui-state", onEstado);
      document.removeEventListener("keydown", onKeydown);
      scene.game.canvas?.removeEventListener("pointerdown", onClickFuera);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.clearTimeout(estado.hoverTimer);
      root.remove();
    }
  };
}
