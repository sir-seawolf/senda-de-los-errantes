// Contrato puro y agnóstico de módulo para estado reanudable de renderers.
// El contenido de `data` pertenece al renderer; el motor solo garantiza que
// sea JSON-safe, esté versionado y no pueda abrirlo otro tipo de renderer.
export const SCENE_RUNTIME_SCHEMA_VERSION = 1;

function textoId(valor) {
  return typeof valor === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(valor);
}

export function crearRuntimeEscena(renderer, data) {
  if (!textoId(renderer)) throw new TypeError("El tipo de renderer del runtime de escena no es válido.");
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("El runtime de escena debe ser un objeto.");
  let copia;
  try {
    copia = JSON.parse(JSON.stringify(data));
  } catch (_error) {
    throw new TypeError("El runtime de escena debe poder serializarse como JSON.");
  }
  return { schemaVersion: SCENE_RUNTIME_SCHEMA_VERSION, renderer, data: copia };
}

export function leerRuntimeEscena(entrada, renderer) {
  if (!entrada || entrada.schemaVersion !== SCENE_RUNTIME_SCHEMA_VERSION || entrada.renderer !== renderer) return null;
  if (!entrada.data || typeof entrada.data !== "object" || Array.isArray(entrada.data)) return null;
  return structuredClone(entrada.data);
}

export function esRuntimeEscena(entrada) {
  return !!entrada && entrada.schemaVersion === SCENE_RUNTIME_SCHEMA_VERSION
    && textoId(entrada.renderer) && !!entrada.data && typeof entrada.data === "object" && !Array.isArray(entrada.data);
}
