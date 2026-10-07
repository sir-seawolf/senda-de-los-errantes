// Acceso directo de revisión para módulos que todavía no deben aparecer en
// el selector público. La URL nunca es autoridad por sí sola: el id debe
// tener formato seguro, existir en modules.json, estar habilitado y usar un
// estado que represente contenido realmente presente en disco.
const ESTADOS_REVISABLES = new Set(["playable", "development", "in_review"]);
const ID_SEGURO = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function resolverModuloRevision(search, registro = []) {
  const params = new URLSearchParams(search || "");
  if (params.get("review") !== "1") return null;

  const moduleId = params.get("module") || "";
  if (!ID_SEGURO.test(moduleId)) return null;

  const entrada = registro.find(modulo => modulo?.id === moduleId);
  if (!entrada?.enabled || !ESTADOS_REVISABLES.has(entrada.status)) return null;
  return moduleId;
}

// Entrada directa a una experiencia revisable. Solo admite escenas que el
// propio manifiesto haya publicado como devEntryPoints: la URL no puede
// inventar rutas ni saltar a contenido interno arbitrario.
export function resolverEscenaRevision(search, manifest = {}) {
  const params = new URLSearchParams(search || "");
  if (params.get("review") !== "1") return null;
  const sceneId = params.get("scene") || "";
  if (!ID_SEGURO.test(sceneId)) return null;
  return (manifest.devEntryPoints || []).some(entry => entry?.id === sceneId) ? sceneId : null;
}
