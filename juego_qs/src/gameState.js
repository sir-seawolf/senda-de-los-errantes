import { moduloIdActivo, manifiestoActivo, MODULE_ID_MIGRACION_GUARDADO_ANTIGUO } from "./engine/moduleLoader.js";
import { sincronizarRuntimeImportado } from "./data/characterVault.js";

// Estado central del motor. Un único objeto mutable + suscriptores simples.
//
// Refactor de arquitectura (iteración 2): el estado ya no asume un único
// "personaje" — mantiene un grupo (`partyMembers`) de copias runtime mutables
// sobre los datos base de `characters.json`. Los datos base (atributos, retrato,
// nombre, rol, arma, armadura) NUNCA se duplican ni se mutan: solo se referencian
// desde `base`. Lo único que vive como copia mutable por miembro es lo que puede
// cambiar durante la partida: habilidades (progresión), vida, inventario, Puntos
// Épicos y disponibilidad.
// Prefijo específico y no genérico a propósito: el sitio publicado
// (sir-seawolf.github.io) sirve varios proyectos bajo el mismo origen, y
// localStorage se comparte por origen, no por subcarpeta — una clave como
// "save_v2" podría chocar con cualquier otra página del sitio que también
// use localStorage. Ver docs/PUBLISHING.md.
//
// Iteración 5: el motor ahora carga módulos de contenido — el guardado debe
// distinguir cuál (dos módulos jugados en el mismo navegador no deben
// pisarse el guardado entre sí). Una clave POR MÓDULO, no un contenedor
// único con todos dentro: así escribir el guardado de un módulo nunca
// obliga a releer/reescribir el de los demás. Ver docs/SAVE_MIGRATION.md
// para la clave antigua (anterior a los módulos) y cómo se migra.
const STORAGE_KEY_ANTIGUA = "la_senda_errantes_juego_qs_save_v1";
function claveGuardado(moduleId) {
  return `la_senda_module_${moduleId}_save_v1`;
}

// Dos canales de notificación separados a propósito:
//   - `listenersEscena`: SOLO navegación (cambiarEscena/iniciarPartida). Provoca
//     un remount completo de #scenario. Debe ser rara.
//   - `listenersFicha`: cualquier otra mutación (inventario, flags, vida, PE,
//     progreso). Solo refresca la ficha lateral, NUNCA #scenario — de lo
//     contrario un combate o una persecución en curso (con su propio bucle de
//     requestAnimationFrame y estado local en closures) se desmontaría a mitad
//     de ejecución cada vez que algo tan trivial como coger un objeto disparase
//     un cambio de estado.
const listenersEscena = new Set();
const listenersFicha = new Set();

export const state = {
  moduloId: null,           // id del módulo activo — ver src/engine/moduleLoader.js
  moduloVersion: null,
  playerCharacterId: null,
  partyMembers: {},        // id -> runtime (ver crearRuntimeDesdeBase)
  posicion: "callejon",
  escena: "module_select",
  entrySpawnId: null,       // punto de llegada solicitado al cambiar entre localizaciones Tiled
  flags: {},                // banderas genéricas que leen/escriben las escenas JSON
  enemigosActivos: [],
  objetosDescubiertos: [],
  pistasDescubiertas: [],
  decisiones: [],
  resources: {},            // contadores narrativos declarativos (PC, tiempo, favores...)
  historialTiradas: [],     // log de tiradas — ver registrarTirada()
  mapaDescubierto: {},      // fog-of-war del minimapa: { "x,y": true }
  progresoEscenas: {},      // estado reanudable propio de renderers: { escenaId: datos JSON-safe }
  estadoPersecucion: null,
  estadoCombate: null,
  finalTipo: null
};

// Munición (Combat UX & Resources 0.2): cargador/reserva separados, solo
// para armas a distancia que declaren magazineSize en su base — un arma
// cuerpo a cuerpo (o un actor sin arma a distancia) no tiene concepto de
// munición y `municion` se queda en null (ver docs/AMMO_SYSTEM.md, "armas
// sin munición" — nunca un hack por módulo, el motor ya lo distingue por
// dato). ammoReserve ausente cuenta como 0, nunca como "infinita".
function municionInicialDesdeArma(arma) {
  if (!arma || arma.magazineSize === undefined) return null;
  return { cargador: arma.magazineSize, reserva: arma.ammoReserve ?? 0 };
}

function crearRuntimeDesdeBase(base) {
  const inventario = [...base.equipo];
  const inventarioRefs = inventario.map((_, indice) => base.equipoIds?.[indice] ?? null);
  const inventarioInstancias = inventario.map((_, indice) => `${base.id}:${indice}:${inventarioRefs[indice] ?? "item"}`);
  return {
    baseId: base.id,
    base,                                       // referencia de solo lectura a characters.json
    habilidades: { ...base.habilidades },        // copia mutable: aquí escribe la progresión
    vidaActual: { ...base.niveles },
    puntosEpicosActuales: base.puntosEpicos,
    inventario,
    // Identificador de definición alineado por instancia con `inventario`.
    // El texto sigue siendo presentación; las reglas solo podrán enlazar un
    // objeto cuando el módulo declare este id estable de forma explícita.
    inventarioRefs,
    inventarioInstancias,
    recursosEquipo: {},
    equipoEstados: inventario.map(item => estadoInicialDeEquipo(base, item)),
    estadoDisponibilidad: "disponible",          // disponible | separado | herido | inconsciente | ocupado | ausente
    municion: municionInicialDesdeArma(base.arma),
    cobertura: 0                                 // nivel de cobertura activo (src/rules/cover.js) — por combatiente, no un booleano global de la escena (ver docs/COMBAT_UX.md)
  };
}

const ESTADOS_EQUIPO = new Set(["equipado", "guardado", "en_uso"]);

function estadoInicialDeEquipo(base, item) {
  const nombre = String(item).toLocaleLowerCase("es");
  const referencias = [base?.arma?.nombre, base?.armaCC?.nombre, base?.armadura?.nombre]
    .filter(Boolean).map(valor => String(valor).toLocaleLowerCase("es"));
  return referencias.some(ref => ref !== "sin arma" && nombre.includes(ref)) ? "equipado" : "guardado";
}

function asegurarEquipoEstado(miembro) {
  const inventario = miembro.inventario || [];
  if (!Array.isArray(miembro.equipoEstados)) {
    const legado = miembro.equipoEstado || {};
    miembro.equipoEstados = inventario.map(item => ESTADOS_EQUIPO.has(legado[item]) ? legado[item] : estadoInicialDeEquipo(miembro.base, item));
    delete miembro.equipoEstado;
  }
  while (miembro.equipoEstados.length < inventario.length) {
    const indice = miembro.equipoEstados.length;
    miembro.equipoEstados.push(estadoInicialDeEquipo(miembro.base, inventario[indice]));
  }
  miembro.equipoEstados.length = inventario.length;

  if (!Array.isArray(miembro.inventarioRefs)) miembro.inventarioRefs = [];
  while (miembro.inventarioRefs.length < inventario.length) miembro.inventarioRefs.push(null);
  miembro.inventarioRefs.length = inventario.length;
  if (!Array.isArray(miembro.inventarioInstancias)) miembro.inventarioInstancias = [];
  while (miembro.inventarioInstancias.length < inventario.length) {
    const indice = miembro.inventarioInstancias.length;
    miembro.inventarioInstancias.push(`legacy:${miembro.baseId}:${indice}:${miembro.inventarioRefs[indice] ?? "item"}`);
  }
  miembro.inventarioInstancias.length = inventario.length;
  miembro.recursosEquipo ||= {};
}

// Migración de saves anteriores a esta iteración (punto 26 del encargo):
// una partida guardada antes de que existiera `municion`/`cobertura` en el
// runtime no los tiene — Object.assign(state, datos) en cargar() sobrescribe
// state.partyMembers entero con lo guardado, así que hay que rellenarlos
// después de cargar, nunca antes. Nunca revienta una partida antigua: si al
// personaje ya guardado le falta municion, se le da una carga completa
// nueva (no hay munición "gastada" que preservar de antes de que el sistema
// existiera) a partir de la propia arma que el save ya tenía serializada.
function migrarRecursosCombateSiFalta() {
  Object.values(state.partyMembers).forEach(m => {
    if (m.municion === undefined) m.municion = municionInicialDesdeArma(m.base?.arma);
    if (m.cobertura === undefined) m.cobertura = 0;
    asegurarEquipoEstado(m);
  });
}

// Arranca una partida nueva: crea runtime para TODOS los pregenerados (barato, son
// 5 objetos de datos) y marca cuál pilota el jugador. Qué otros miembros están
// presentes en cada escena lo decide el JSON de la escena (`availableParty`), no
// este arranque — "no asumir que los cinco están siempre juntos".
export function iniciarPartida(pregenerados, playerBaseId) {
  const manifest = manifiestoActivo();
  state.moduloId = moduloIdActivo();
  state.moduloVersion = manifest?.version ?? null;
  state.partyMembers = {};
  pregenerados.forEach(base => {
    state.partyMembers[base.id] = crearRuntimeDesdeBase(base);
  });
  state.playerCharacterId = playerBaseId;
  state.flags = {};
  state.objetosDescubiertos = [];
  state.pistasDescubiertas = [];
  state.decisiones = [];
  state.resources = {};
  state.historialTiradas = [];
  state.mapaDescubierto = {};
  state.progresoEscenas = {};
  state.entrySpawnId = null;
  state.finalTipo = null;
  notificarEscena();
}

export function obtenerJugador() {
  return state.partyMembers[state.playerCharacterId] || null;
}

export function obtenerMiembro(id) {
  if (id === "player") return obtenerJugador();
  return state.partyMembers[id] || null;
}

export function estadoEquipoDe(miembroId, item, indice = -1) {
  const miembro = obtenerMiembro(miembroId);
  if (!miembro || !miembro.inventario.includes(item)) return null;
  asegurarEquipoEstado(miembro);
  const posicion = indice >= 0 && miembro.inventario[indice] === item ? indice : miembro.inventario.indexOf(item);
  return miembro.equipoEstados[posicion] ?? null;
}

export function referenciaEquipoDe(miembroId, item, indice = -1) {
  const miembro = obtenerMiembro(miembroId);
  if (!miembro || !miembro.inventario.includes(item)) return null;
  asegurarEquipoEstado(miembro);
  const posicion = indice >= 0 && miembro.inventario[indice] === item ? indice : miembro.inventario.indexOf(item);
  return miembro.inventarioRefs[posicion] ?? null;
}

export function equipamientoActivoDe(miembroId, prefijo) {
  const miembro = obtenerMiembro(miembroId);
  if (!miembro) return [];
  asegurarEquipoEstado(miembro);
  return miembro.inventario.flatMap((item, indice) => {
    const referencia = miembro.inventarioRefs[indice];
    const estado = miembro.equipoEstados[indice];
    if (!referencia?.startsWith(`${prefijo}:`) || !["equipado", "en_uso"].includes(estado)) return [];
    const instanciaId = miembro.inventarioInstancias[indice];
    return [{ item, indice, referencia, estado, instanciaId, recursos: miembro.recursosEquipo[instanciaId] ?? null }];
  });
}

export function actualizarRecursosEquipo(miembroId, instanciaId, recursos) {
  const miembro = obtenerMiembro(miembroId);
  if (!miembro || !instanciaId || !miembro.inventarioInstancias?.includes(instanciaId) || !recursos || typeof recursos !== "object") return false;
  asegurarEquipoEstado(miembro);
  miembro.recursosEquipo[instanciaId] = structuredClone(recursos);
  const referencia = miembro.inventarioRefs[miembro.inventarioInstancias.indexOf(instanciaId)];
  const mismaDefinicionBase = referencia?.split(":")[1] === miembro.base?.arma?.equipoId?.split(":")[1];
  if (mismaDefinicionBase && recursos.municion) {
    miembro.municion = { ...recursos.municion };
  }
  notificarFicha();
  guardar();
  return true;
}

export function establecerEstadoEquipo(miembroId, item, estado, indice = -1) {
  const miembro = obtenerMiembro(miembroId);
  if (!miembro || !miembro.inventario.includes(item) || !ESTADOS_EQUIPO.has(estado)) return false;
  asegurarEquipoEstado(miembro);
  const posicion = indice >= 0 && miembro.inventario[indice] === item ? indice : miembro.inventario.indexOf(item);
  const referencia = miembro.inventarioRefs[posicion];
  if (["equipado", "en_uso"].includes(estado) && referencia) {
    const categoria = referencia.split(":", 1)[0];
    if (["ranged", "melee", "armor"].includes(categoria)) {
      miembro.inventarioRefs.forEach((otraReferencia, otraPosicion) => {
        if (otraPosicion !== posicion && otraReferencia?.startsWith(`${categoria}:`) && ["equipado", "en_uso"].includes(miembro.equipoEstados[otraPosicion])) {
          miembro.equipoEstados[otraPosicion] = "guardado";
        }
      });
    }
  }
  miembro.equipoEstados[posicion] = estado;
  notificarFicha();
  guardar();
  return true;
}

export function transferirEquipo(origenId, destinoId, item, indiceOrigen = -1) {
  const origen = obtenerMiembro(origenId);
  const destino = obtenerMiembro(destinoId);
  const indice = indiceOrigen >= 0 && origen?.inventario[indiceOrigen] === item ? indiceOrigen : (origen?.inventario.indexOf(item) ?? -1);
  if (!origen || !destino || origen === destino || indice < 0) return false;
  asegurarEquipoEstado(origen);
  asegurarEquipoEstado(destino);
  origen.inventario.splice(indice, 1);
  origen.equipoEstados.splice(indice, 1);
  const referencia = origen.inventarioRefs.splice(indice, 1)[0] ?? null;
  const instanciaId = origen.inventarioInstancias.splice(indice, 1)[0];
  const recursos = instanciaId ? origen.recursosEquipo[instanciaId] : null;
  if (instanciaId) delete origen.recursosEquipo[instanciaId];
  destino.inventario.push(item);
  destino.equipoEstados.push("guardado");
  destino.inventarioRefs.push(referencia);
  destino.inventarioInstancias.push(instanciaId ?? `transfer:${destino.baseId}:${destino.inventario.length - 1}:${referencia ?? "item"}`);
  if (recursos) destino.recursosEquipo[destino.inventarioInstancias.at(-1)] = recursos;
  notificarFicha();
  guardar();
  return true;
}

// Estados que impiden delegar una acción en ese miembro. "herido" queda FUERA
// a propósito: en el QS, Herido es un penalizador de −10 a las habilidades
// (CAP03 / QUICKSTART línea 230), no una incapacitación — un compañero herido
// sigue pudiendo actuar, solo que peor. Los estados narrativos de verdad
// ausente son los que bloquean la delegación.
const ESTADOS_NO_DELEGABLES = new Set(["inconsciente", "ausente", "separado", "ocupado"]);

// Miembros presentes en la escena actual (según su lista `availableParty`,
// deduplicada — "player" se resuelve al elegido) y mecánicamente disponibles
// para ejecutar o recibir una acción delegada.
export function miembrosDisponibles(idsListaEscena = []) {
  const idsResueltos = [...new Set(idsListaEscena.map(id => (id === "player" ? state.playerCharacterId : id)))];
  return idsResueltos
    .map(id => state.partyMembers[id])
    .filter(m => m && !ESTADOS_NO_DELEGABLES.has(m.estadoDisponibilidad));
}

export function establecerDisponibilidad(miembroId, estado) {
  const m = obtenerMiembro(miembroId);
  if (!m) return;
  m.estadoDisponibilidad = estado;
  notificarFicha();
  guardar();
}

export function esJugador(id) {
  return id === "player" || id === state.playerCharacterId;
}

export function nombreVisible(miembroRuntime) {
  return miembroRuntime.base.nombre;
}

export function registrarDecision(texto) {
  state.decisiones.push(texto);
  guardar();
}

export function descubrirObjeto(nombre) {
  if (!state.objetosDescubiertos.includes(nombre)) state.objetosDescubiertos.push(nombre);
  guardar();
}

export function descubrirPista(texto) {
  if (!state.pistasDescubiertas.includes(texto)) state.pistasDescubiertas.push(texto);
  guardar();
}

export function establecerFlag(nombre, valor = true) {
  state.flags[nombre] = valor;
}

export function tieneFlag(nombre) {
  return !!state.flags[nombre];
}

export function obtenerProgresoEscena(escenaId) {
  return state.progresoEscenas?.[escenaId] ?? null;
}

export function guardarProgresoEscena(escenaId, progreso) {
  state.progresoEscenas ||= {};
  state.progresoEscenas[escenaId] = structuredClone(progreso);
  guardar();
}

export function limpiarProgresoEscena(escenaId) {
  if (!state.progresoEscenas?.[escenaId]) return;
  delete state.progresoEscenas[escenaId];
  guardar();
}

// Munición (Combat UX & Resources 0.2) — mutaciones centralizadas aquí,
// igual que gastarPuntoEpico/aplicarDanio, para que combat.js solo orqueste
// turnos y nunca toque el estado del combatiente directamente.
export function tieneMunicionPara(miembroId, cantidad) {
  const m = obtenerMiembro(miembroId);
  return !!(m?.municion && m.municion.cargador >= cantidad);
}

export function consumirMunicion(miembroId, cantidad) {
  const m = obtenerMiembro(miembroId);
  if (!m?.municion || m.municion.cargador < cantidad) return false;
  m.municion.cargador -= cantidad;
  notificarFicha();
  guardar();
  return true;
}

// Nunca crea munición: solo mueve reserva -> cargador hasta el máximo del
// arma. Devuelve cuánto se transfirió realmente (0 si no había nada que
// recargar, para que la UI pueda decir "no hace falta"/"sin reserva").
export function recargarArma(miembroId) {
  const m = obtenerMiembro(miembroId);
  if (!m?.municion) return 0;
  const magazineSize = m.base?.arma?.magazineSize ?? m.municion.cargador;
  const hueco = Math.max(0, magazineSize - m.municion.cargador);
  const transferido = Math.min(hueco, m.municion.reserva);
  m.municion.cargador += transferido;
  m.municion.reserva -= transferido;
  notificarFicha();
  guardar();
  return transferido;
}

export function establecerCobertura(miembroId, nivel) {
  const m = obtenerMiembro(miembroId);
  if (!m) return;
  m.cobertura = nivel;
  notificarFicha();
  guardar();
}

export function gastarPuntoEpico(miembroId = "player") {
  const m = obtenerMiembro(miembroId);
  if (!m || m.puntosEpicosActuales <= 0) return false;
  m.puntosEpicosActuales -= 1;
  notificarFicha();
  guardar();
  return true;
}

// Registra una tirada en el historial. `entrada` ya trae los campos calculados
// por rules/dice.js más contexto (escena, actor, habilidad, progreso).
export function registrarTirada(entrada) {
  state.historialTiradas.push({ orden: state.historialTiradas.length + 1, ...entrada });
  // Una tirada con progresión ya ha mutado las habilidades runtime antes de
  // llegar aquí. Refrescar la ficha ahora hace visible el nuevo valor sin
  // esperar a otra acción o cambio de escena.
  if (entrada.progreso) notificarFicha();
  guardar();
}

export function aplicarDanio(miembroId, localizacion, danioFinal) {
  const m = obtenerMiembro(miembroId);
  if (!m || !Number.isFinite(danioFinal) || danioFinal <= 0) return false;
  let restante = danioFinal;
  for (const nivel of ["sano", "herido", "tullido"]) {
    if (restante <= 0) break;
    const disponible = m.vidaActual[nivel];
    const consumido = Math.min(disponible, restante);
    m.vidaActual[nivel] -= consumido;
    restante -= consumido;
  }
  if (nivelHeridaDe(m) !== "sano") m.estadoDisponibilidad = m.estadoDisponibilidad === "disponible" ? "herido" : m.estadoDisponibilidad;
  notificarFicha();
  guardar();
  const vidaRestante = m.vidaActual.sano + m.vidaActual.herido + m.vidaActual.tullido;
  return restante > 0 || vidaRestante <= 0; // true = golpe mortal (Tullido a 0 o daño sobrante)
}

export function nivelHeridaDe(miembroRuntime) {
  const v = miembroRuntime.vidaActual;
  const base = miembroRuntime.base.niveles;
  if (v.sano === 0 && v.herido === 0 && v.tullido < base.tullido) return "tullido";
  if (v.sano === 0) return "herido";
  return "sano";
}

// Compatibilidad: la mayoría de pantallas solo necesitan el nivel del jugador.
export function nivelHeridaActual() {
  const j = obtenerJugador();
  return j ? nivelHeridaDe(j) : "sano";
}

export function cambiarEscena(nombre, { spawnId = null } = {}) {
  state.escena = nombre;
  // Las escenas que no declaran destino limpian cualquier llegada anterior.
  // Así una transición narrativa normal nunca hereda por accidente el spawn
  // de una localización panorámica visitada antes.
  state.entrySpawnId = spawnId;
  notificarEscena();
  guardar();
}

// Fuerza un refresco de SOLO la ficha lateral + guardado tras mutar el estado
// directamente (p.ej. empujar al inventario o marcar un flag). Nunca remonta
// la escena en curso — ver comentario junto a los sets de listeners arriba.
export function actualizar() {
  notificarFicha();
  guardar();
}

export function suscribirEscena(fn) {
  listenersEscena.add(fn);
  return () => listenersEscena.delete(fn);
}

export function suscribirFicha(fn) {
  listenersFicha.add(fn);
  return () => listenersFicha.delete(fn);
}

function notificarEscena() {
  for (const fn of listenersEscena) fn(state);
}

function notificarFicha() {
  for (const fn of listenersFicha) fn(state);
}

export function guardar() {
  // Sin módulo activo (pantalla de selección de módulos) no hay nada propio
  // de una partida que guardar todavía.
  if (!state.moduloId) return;
  try {
    Object.values(state.partyMembers).forEach(miembro => sincronizarRuntimeImportado(miembro));
    localStorage.setItem(claveGuardado(state.moduloId), JSON.stringify(state));
  } catch (e) {
    // localStorage puede no estar disponible (file://) — no bloquear el prototipo por esto.
  }
}

// Ambas funciones operan sobre el módulo actualmente CARGADO (moduloIdActivo(),
// fijado por moduleLoader.cargarModulo() al entrar desde el selector de
// módulos) — así "Continuar partida" en el menú de un módulo solo ve el
// guardado de ESE módulo, nunca el de otro.
export function hayPartidaGuardada() {
  const moduleId = moduloIdActivo();
  if (!moduleId) return false;
  try {
    return !!localStorage.getItem(claveGuardado(moduleId));
  } catch (e) {
    return false;
  }
}

export function cargar() {
  const moduleId = moduloIdActivo();
  if (!moduleId) return false;
  try {
    const raw = localStorage.getItem(claveGuardado(moduleId));
    if (!raw) return false;
    const datos = JSON.parse(raw);
    Object.assign(state, datos);
    state.progresoEscenas ||= {};
    migrarRecursosCombateSiFalta();
    notificarEscena();
    return true;
  } catch (e) {
    return false;
  }
}

export function borrarGuardado() {
  const moduleId = moduloIdActivo();
  if (!moduleId) return;
  try { localStorage.removeItem(claveGuardado(moduleId)); } catch (e) {}
}

// Cierre atómico de una partida terminada: borra primero el guardado y
// navega sin pasar por cambiarEscena(), porque esa función guarda después de
// notificar. Usarla aquí recrearía inmediatamente un save vacío y haría que
// el menú ofreciese una falsa opción "Continuar partida".
export function cerrarPartidaDefinitiva(destino = "menu") {
  const moduleId = moduloIdActivo() || state.moduloId;
  if (moduleId) {
    try { localStorage.removeItem(claveGuardado(moduleId)); } catch (e) {}
  }
  state.partyMembers = {};
  state.playerCharacterId = null;
  state.finalTipo = null;
  state.escena = destino;
  state.entrySpawnId = null;
  state.moduloId = null;
  state.moduloVersion = null;
  notificarEscena();
}

// Migración del guardado de la iteración 4 (anterior al concepto de módulo,
// ver docs/SAVE_MIGRATION.md). Se ejecuta una sola vez al arrancar la app,
// antes de mostrar cualquier pantalla — si existe la clave antigua y NO
// existe ya la nueva del módulo de migración, copia los datos añadiendo
// moduloId/moduloVersion y BORRA la clave antigua (política documentada:
// no se conserva, para no reintentar la migración en cada arranque ni dejar
// datos duplicados obsoletos). Si la clave nueva ya existe, no hace nada
// (no pisa una partida ya migrada o empezada de cero en el módulo).
export function migrarGuardadoAntiguoSiExiste() {
  try {
    const antiguo = localStorage.getItem(STORAGE_KEY_ANTIGUA);
    if (!antiguo) return false;
    const claveNueva = claveGuardado(MODULE_ID_MIGRACION_GUARDADO_ANTIGUO);
    if (localStorage.getItem(claveNueva)) {
      localStorage.removeItem(STORAGE_KEY_ANTIGUA);
      return false;
    }
    const datos = JSON.parse(antiguo);
    datos.moduloId = MODULE_ID_MIGRACION_GUARDADO_ANTIGUO;
    datos.moduloVersion = datos.moduloVersion ?? "migrado";
    localStorage.setItem(claveNueva, JSON.stringify(datos));
    localStorage.removeItem(STORAGE_KEY_ANTIGUA);
    return true;
  } catch (e) {
    return false;
  }
}
