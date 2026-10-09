import { normalizeCharacter } from "./adapters/characterImport.js";

const STORAGE_KEY = "la_senda_personajes_importados_v1";
const SCHEMA_VERSION = 1;

function storageDisponible(storage) {
  return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function";
}

function escribirPersonajes(personajes, storage) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, characters: personajes }));
}

export function listarPersonajesImportados(storage = globalThis.localStorage) {
  if (!storageDisponible(storage)) return [];
  try {
    const datos = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    const personajes = Array.isArray(datos) ? datos : datos?.schemaVersion === SCHEMA_VERSION ? datos.characters : [];
    if (!Array.isArray(personajes)) return [];
    return personajes.flatMap(personaje => {
      try {
        return [normalizeCharacter(personaje)];
      } catch (_error) {
        return [];
      }
    });
  } catch (_error) {
    return [];
  }
}

export function guardarPersonajeImportado(personaje, storage = globalThis.localStorage) {
  if (!storageDisponible(storage) || !personaje?.id || personaje.origen !== "importado") return false;
  try {
    const personajes = listarPersonajesImportados(storage);
    const copia = normalizeCharacter(personaje);
    const indice = personajes.findIndex(p => p.id === copia.id);
    if (indice >= 0) personajes[indice] = copia;
    else personajes.push(copia);
    escribirPersonajes(personajes, storage);
    return true;
  } catch (_error) {
    return false;
  }
}

export function eliminarPersonajeImportado(id, storage = globalThis.localStorage) {
  if (!storageDisponible(storage) || typeof id !== "string") return false;
  try {
    const personajes = listarPersonajesImportados(storage);
    const restantes = personajes.filter(personaje => personaje.id !== id);
    if (restantes.length === personajes.length) return false;
    escribirPersonajes(restantes, storage);
    return true;
  } catch (_error) {
    return false;
  }
}

export function renombrarPersonajeImportado(id, nombre, storage = globalThis.localStorage) {
  if (!storageDisponible(storage) || typeof id !== "string" || typeof nombre !== "string") return false;
  try {
    const personajes = listarPersonajesImportados(storage);
    const indice = personajes.findIndex(personaje => personaje.id === id);
    if (indice < 0) return false;
    // El id es la identidad estable usada por partidas guardadas. Renombrar
    // solo cambia la etiqueta visible para no dejar referencias huérfanas.
    personajes[indice] = normalizeCharacter({ ...personajes[indice], nombre: nombre.trim() });
    escribirPersonajes(personajes, storage);
    return true;
  } catch (_error) {
    return false;
  }
}

export function serializarPersonajeImportado(id, storage = globalThis.localStorage) {
  if (typeof id !== "string") return null;
  const personaje = listarPersonajesImportados(storage).find(candidato => candidato.id === id);
  if (!personaje) return null;
  return JSON.stringify({
    ...personaje,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString()
  }, null, 2);
}

export function sincronizarRuntimeImportado(miembroRuntime, storage = globalThis.localStorage) {
  if (miembroRuntime?.base?.origen !== "importado") return false;
  return guardarPersonajeImportado({
    ...miembroRuntime.base,
    habilidades: { ...miembroRuntime.habilidades }
  }, storage);
}
