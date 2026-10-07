// Motor de carga de módulos de contenido (iteración 5). Un módulo es una
// carpeta bajo modules/<id>/ con un module.json que describe dónde está cada
// cosa (escenas, mapas, personajes, enemigos, armas, encuentros, assets).
// Este archivo NO conoce ningún módulo por id — la única excepción
// documentada es MODULE_ID_MIGRACION más abajo, usada solo para migrar el
// guardado de la iteración 4 (que no tenía concepto de módulo). Ver
// docs/MODULE_ARCHITECTURE.md.

// SOURCE_OVERRIDE: ninguno — esto es arquitectura del prototipo, no una regla
// de La Senda de los Errantes.
import { audioManager } from "./audioManager.js";
//
// Excepción de migración documentada (ver docs/SAVE_MIGRATION.md): el único
// guardado que existía antes de que el motor tuviera módulos era el de
// Predator N-5.2 (el único contenido que existía). Migrarlo requiere saber a
// qué módulo asignarlo — no hay forma de inferirlo de datos que no incluían
// un moduleId. Este es el único sitio de todo `src/` que menciona
// "predator_n52" fuera de los propios datos del módulo.
export const MODULE_ID_MIGRACION_GUARDADO_ANTIGUO = "predator_n52";

let moduloActual = null; // { id, manifest, base } | null

function esRutaAbsoluta(ruta) {
  return /^([a-z]+:)?\/\//i.test(ruta) || ruta.startsWith("/");
}

// Resuelve una ruta declarada en datos de un módulo (relativa a la carpeta
// del módulo) contra la carpeta real de ese módulo en disco/servidor. Rutas
// ya absolutas (http(s)://, //, /) se devuelven tal cual, para no impedir
// que un módulo referencie un recurso externo si alguna vez hiciera falta.
export function rutaModulo(rutaRelativa, modulo = moduloActual) {
  if (!rutaRelativa) return rutaRelativa;
  if (esRutaAbsoluta(rutaRelativa)) return rutaRelativa;
  if (!modulo) throw new Error("rutaModulo(): ningún módulo cargado todavía");
  return modulo.base + rutaRelativa;
}

// Azúcar sobre rutaModulo() para assets: junta paths.assets + la ruta que ya
// traían los datos (characters.json → retrato, escenas → background...),
// que siguen escribiéndose relativas a la carpeta del módulo tal y como se
// escribían antes de esta iteración (p.ej. "assets/characters/kova.png") —
// así mover un módulo de sitio no obliga a reescribir ningún string dentro
// de sus JSON.
export function rutaAsset(rutaRelativa, modulo = moduloActual) {
  return rutaModulo(rutaRelativa, modulo);
}

// El manifiesto de audio, igual que fondos y sprites, declara rutas relativas
// a la carpeta del módulo. Se resuelven al registrar el ámbito para que el
// gestor común no necesite conocer la estructura `modules/<id>/`.
export function resolverManifiestoAudio(manifiestoAudio, modulo = moduloActual) {
  const sonidos = manifiestoAudio?.sounds || manifiestoAudio || {};
  return {
    sounds: Object.fromEntries(Object.entries(sonidos).map(([id, entrada]) => {
      if (typeof entrada === "string") return [id, rutaModulo(entrada, modulo)];
      if (!entrada || typeof entrada !== "object" || !entrada.src) return [id, entrada];
      return [id, { ...entrada, src: rutaModulo(entrada.src, modulo) }];
    }))
  };
}

export function moduloActivo() {
  return moduloActual;
}

export function manifiestoActivo() {
  return moduloActual?.manifest ?? null;
}

export function moduloIdActivo() {
  return moduloActual?.id ?? null;
}

// paths[clave] es relativo a la carpeta del módulo; devuelve la URL final
// lista para fetch(). Lanza si el módulo activo no declara esa clave —
// mejor un error explícito en desarrollo que un 404 silencioso.
export function rutaDeManifiesto(clave, modulo = moduloActual) {
  if (!modulo) throw new Error("rutaDeManifiesto(): ningún módulo cargado todavía");
  const rel = modulo.manifest.paths?.[clave];
  if (!rel) throw new Error(`El módulo "${modulo.id}" no declara paths.${clave} en su module.json`);
  return rutaModulo(rel, modulo);
}

let cacheListaModulos = null;
export async function cargarListaModulos() {
  if (cacheListaModulos) return cacheListaModulos;
  const res = await fetch("modules/modules.json");
  if (!res.ok) throw new Error("No se pudo cargar modules/modules.json");
  cacheListaModulos = await res.json();
  return cacheListaModulos;
}

function validarManifiesto(manifest, moduleIdEsperado) {
  const errores = [];
  if (!manifest || typeof manifest !== "object") errores.push("module.json vacío o no es un objeto");
  else {
    if (manifest.id !== moduleIdEsperado) {
      errores.push(`module.json declara id "${manifest.id}", se esperaba "${moduleIdEsperado}" (debe coincidir con el nombre de la carpeta)`);
    }
    if (!manifest.title) errores.push('module.json no declara "title"');
    if (!manifest.startScene) errores.push('module.json no declara "startScene"');
    if (!manifest.system) errores.push('module.json no declara "system"');
  }
  if (errores.length) {
    throw new Error(`module.json inválido para "${moduleIdEsperado}": ${errores.join("; ")}`);
  }
}

const cacheManifiestos = new Map();

// Carga (y activa) un módulo por id. No sabe nada de "predator_n52" ni de
// ningún otro id concreto — cualquier carpeta bajo modules/ con un
// module.json válido sirve, incluido modules/_test_fixture usado solo por
// los tests de aislamiento (ver docs/MODULE_ARCHITECTURE.md).
export async function cargarModulo(moduleId) {
  if (!moduleId || typeof moduleId !== "string") {
    throw new Error("cargarModulo() necesita un moduleId (string)");
  }
  const base = `modules/${moduleId}/`;
  let manifest = cacheManifiestos.get(moduleId);
  if (!manifest) {
    const res = await fetch(`${base}module.json`);
    if (!res.ok) throw new Error(`Módulo no encontrado: "${moduleId}" (${base}module.json → ${res.status})`);
    manifest = await res.json();
    validarManifiesto(manifest, moduleId);
    cacheManifiestos.set(moduleId, manifest);
  }
  moduloActual = { id: moduleId, manifest, base };
  // El título de la pestaña es del módulo cargado, nunca de "la zona de
  // juego" en general — nada anterior a este punto (selector de módulos,
  // gateway en juego.html) debe nombrarse ninguno concreto.
  if (typeof document !== "undefined") document.title = manifest.title;
  // Tema visual del módulo (encargo de sesión, 2026-08-21): campo genérico
  // "theme" en module.json, mismo patrón que "music" justo abajo —
  // moduleLoader no conoce ningún id de tema concreto, solo selecciona el
  // bloque `:root[data-theme="..."]` que theme.css declare para él (ver
  // theme.css). Sin "theme" declarado, cae al tema base de La Senda (el
  // `:root` sin atributo, ya existente).
  if (typeof document !== "undefined") {
    if (manifest.theme) document.documentElement.dataset.theme = manifest.theme;
    else delete document.documentElement.dataset.theme;
  }
  // Mapa musical del módulo (Iteración Audio): campo genérico "music" en
  // module.json, motor-agnóstico — moduleLoader no sabe qué estados declara
  // cada módulo, solo los pasa tal cual al gestor de audio. audioManager es
  // null en Node/tests (no hay `window`), por eso el guard.
  if (audioManager) {
    audioManager.registrarMapaModulo(moduleId, manifest.music || {});
    audioManager.registrarManifiestoAudio(moduleId, resolverManifiestoAudio(manifest.audio || {}, moduloActual));
  }
  return moduloActual;
}

// Solo para tests: limpia el módulo activo y la caché de manifiestos, para
// que un test no herede el módulo cargado por el test anterior.
export function _resetParaTests() {
  moduloActual = null;
  cacheManifiestos.clear();
  cacheListaModulos = null;
}
