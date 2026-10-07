// Preferencias de interfaz que no son de audio (Iteración 0.3, punto 8 del
// encargo): por ahora solo si la ficha lateral está plegada o expandida.
// Clave propia, separada de la configuración de audio a propósito — son dos
// sistemas de preferencia con ciclos de vida distintos (audio ya tenía su
// propio módulo, `src/ui/audioSettings.js`; mezclar aquí habría acoplado dos
// cosas sin relación solo por compartir el mismo prefijo de localStorage).
const CLAVE = "la_senda_ui_settings_v1";

function leer() {
  try {
    const raw = localStorage.getItem(CLAVE);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function escribir(datos) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
  } catch (e) {
    // localStorage puede no estar disponible (file://) — no bloquear el prototipo por esto.
  }
}

// `layout` distingue el estado plegado/expandido según cómo se presenta la
// ficha: "docked" (columna fija de #app, el comportamiento de siempre) vs
// "overlay" (cajón superpuesto que no reserva ancho del escenario — piloto
// de Localización C, ver docs/CONTRATO_VISUAL_PREDATOR.md). Es la MISMA
// preferencia persistida, solo con una clave y un valor por defecto propios
// por layout: en "docked" arrancar expandida no roba nada (siempre hubo
// columna reservada); en "overlay" arrancar expandida taparía la escena
// panorámica sin que el jugador lo haya pedido, así que su valor por
// defecto es plegada (el escenario ocupa todo el ancho al entrar).
function claveColapsada(layout) {
  return layout === "overlay" ? "fichaColapsadaOverlay" : "fichaColapsada";
}
function porDefecto(layout) {
  return true;
}

export function fichaColapsada(layout = "docked") {
  const valor = leer()[claveColapsada(layout)];
  return valor === undefined ? porDefecto(layout) : !!valor;
}

export function establecerFichaColapsada(valor, layout = "docked") {
  const datos = leer();
  datos[claveColapsada(layout)] = !!valor;
  escribir(datos);
}
