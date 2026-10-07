// Adaptador puro entre un mapa Tiled panorámico y el contrato de escena de
// JUEGO_QS. Tiled aporta geometría, identidad y referencias. Las reglas, los
// textos, los estados visuales y los recursos propios del tema permanecen en
// el JSON de contenido de la escena.

const CLASES_PILOTO = new Set([
  "", "WalkableRegion", "Occluder", "Door", "Interactable",
  "Spawn", "Exit", "EncounterTrigger"
]);

const PROPIEDADES_PROHIBIDAS = new Set([
  "difficulty", "difficultyLabel", "roll", "skill", "fallbackSkill",
  "damage", "cadence", "penetration", "epicPointCost", "peCost",
  "states", "defaultState", "activeState", "label", "contactShadow",
  "flipX", "anchorOffsetX"
]);

export function tiledClass(object = {}) {
  // Tiled 1.10+ vuelve a exportar la clase de los objetos como `type`, pero
  // 1.9 la guardaba como `class`. Se normaliza una sola vez aquí.
  return object.class || object.type || "";
}

export function tiledProps(object = {}) {
  return Object.fromEntries((object.properties || []).map(p => [p.name, p.value]));
}

function objetosDelMapa(map) {
  return (map.layers || [])
    .filter(layer => layer.type === "objectgroup")
    .flatMap(layer => layer.objects || []);
}

function rutaRecursoTiled(referencia, mapUrl) {
  if (!referencia || !mapUrl) return referencia;
  try {
    return new URL(referencia, mapUrl).href;
  } catch {
    return referencia;
  }
}

export function validarTiledPanoramicMap(map) {
  const errores = [];
  const fallo = mensaje => errores.push(mensaje);

  if (!map || map.type !== "map") return ["el documento no es un mapa Tiled"];
  if (map.orientation !== "orthogonal") fallo(`orientation debe ser "orthogonal", no ${JSON.stringify(map.orientation)}`);
  if (!(map.width > 0 && map.height > 0 && map.tilewidth > 0 && map.tileheight > 0)) {
    fallo("width, height, tilewidth y tileheight deben ser números positivos");
  }

  const masters = (map.layers || []).filter(layer =>
    layer.type === "imagelayer" && (layer.class === "Master" || layer.name === "Master")
  );
  if (masters.length !== 1) fallo(`debe existir exactamente una capa de imagen Master (hay ${masters.length})`);
  else if (!masters[0].image) fallo("la capa Master no declara image");

  const objects = objetosDelMapa(map);
  const ids = new Set();
  const names = new Set();
  const byId = new Map();
  for (const object of objects) {
    if (!Number.isInteger(object.id) || ids.has(object.id)) fallo(`id de objeto ausente o duplicado: ${JSON.stringify(object.id)}`);
    else { ids.add(object.id); byId.set(object.id, object); }
    if (object.name) {
      if (names.has(object.name)) fallo(`nombre de objeto duplicado: "${object.name}"`);
      names.add(object.name);
    }
    const clase = tiledClass(object);
    if (!CLASES_PILOTO.has(clase)) fallo(`clase no admitida en el piloto: "${clase}" (${object.name || object.id})`);
    for (const propiedad of object.properties || []) {
      if (PROPIEDADES_PROHIBIDAS.has(propiedad.name)) {
        fallo(`"${object.name || object.id}" contiene ${propiedad.name}: esa información pertenece al contenido, motor o tema`);
      }
    }
  }

  const walkables = objects.filter(o => tiledClass(o) === "WalkableRegion");
  if (walkables.length !== 1) fallo(`debe existir exactamente un WalkableRegion (hay ${walkables.length})`);
  else if (!Array.isArray(walkables[0].polygon) || walkables[0].polygon.length < 3) {
    fallo("WalkableRegion debe ser un polígono con al menos tres puntos");
  }

  const spawns = objects.filter(o => tiledClass(o) === "Spawn");
  if (spawns.length < 1) fallo("debe existir al menos un Spawn");
  const spawnIds = new Set();
  for (const spawn of spawns) {
    const spawnId = tiledProps(spawn).spawnId;
    if (!spawnId) continue;
    if (spawnIds.has(spawnId)) fallo(`spawnId duplicado: "${spawnId}"`);
    spawnIds.add(spawnId);
  }

  for (const object of objects) {
    const clase = tiledClass(object);
    const p = tiledProps(object);
    if (["Door", "Interactable", "Occluder"].includes(clase) && p.interactionId) {
      if (!p.approachPoint) fallo(`"${object.name}" no referencia approachPoint`);
      else {
        const approach = byId.get(p.approachPoint);
        if (!approach) fallo(`"${object.name}" referencia approachPoint inexistente: ${p.approachPoint}`);
        else if (!approach.point) fallo(`approachPoint de "${object.name}" debe referenciar un objeto punto`);
      }
    }
    if (["Door", "Interactable", "Occluder"].includes(clase) && (!(object.width > 0) || !(object.height > 0))) {
      fallo(`"${object.name}" debe declarar width y height positivos`);
    }
    if (clase === "Door") {
      for (const required of ["stateId", "initialState", "doorProfileId", "interactionId"]) {
        if (!p[required]) fallo(`Door "${object.name}" no declara ${required}`);
      }
    }
    if (clase === "Interactable" && !p.interactionId) fallo(`Interactable "${object.name}" no declara interactionId`);
    if (clase === "Spawn" && !p.spawnId) fallo(`Spawn "${object.name}" no declara spawnId`);
    if (clase === "Exit" && (!p.targetScene || !p.targetSpawnId)) {
      fallo(`Exit "${object.name}" debe declarar targetScene y targetSpawnId`);
    }
    if (clase === "Exit" && (!(object.width > 0) || !(object.height > 0))) {
      fallo(`Exit "${object.name}" debe declarar width y height positivos`);
    }
    if (clase === "EncounterTrigger" && !p.encounterId) {
      fallo(`EncounterTrigger "${object.name}" no declara encounterId`);
    }
  }

  return errores;
}

export function adaptTiledPanoramicMap(map, { mapUrl } = {}) {
  const errores = validarTiledPanoramicMap(map);
  if (errores.length) throw new Error(`Mapa Tiled panorámico inválido:\n- ${errores.join("\n- ")}`);

  const objects = objetosDelMapa(map);
  const byId = new Map(objects.map(o => [o.id, o]));
  const image = (map.layers || []).find(layer =>
    layer.type === "imagelayer" && (layer.class === "Master" || layer.name === "Master")
  );
  const walkableObject = objects.find(o => tiledClass(o) === "WalkableRegion");
  const polygon = walkableObject.polygon.map(point => ({
    x: (walkableObject.x || 0) + point.x,
    y: (walkableObject.y || 0) + point.y
  }));
  const xValues = polygon.map(p => p.x);
  const yValues = polygon.map(p => p.y);
  const spawnObjects = objects.filter(o => tiledClass(o) === "Spawn");
  const spawnObject = spawnObjects[0];
  const semanticObjects = objects.filter(o => ["Door", "Interactable", "Occluder"].includes(tiledClass(o)));

  const geometry = semanticObjects.map(object => {
    const p = tiledProps(object);
    const approach = byId.get(p.approachPoint);
    return {
      id: object.name,
      class: tiledClass(object),
      box: { x: object.x, y: object.y, width: object.width, height: object.height },
      anchor: { x: object.x + object.width / 2, y: object.y + object.height },
      width: object.width,
      height: object.height,
      interactionId: p.interactionId || null,
      approachPoint: approach?.name || null,
      stateId: p.stateId || null,
      initialState: p.initialState || null,
      doorProfileId: p.doorProfileId || null,
      occlusionProfileId: p.occlusionProfileId || null
    };
  });

  return {
    master: {
      file: rutaRecursoTiled(image.image, mapUrl),
      width: map.width * map.tilewidth,
      height: map.height * map.tileheight
    },
    walkablePolygon: polygon,
    walkable: {
      y: spawnObject.y,
      xMin: Math.min(...xValues),
      xMax: Math.max(...xValues),
      band: [Math.min(...yValues), Math.max(...yValues)]
    },
    spawn: {
      id: tiledProps(spawnObject).spawnId || spawnObject.name,
      x: spawnObject.x,
      y: spawnObject.y
    },
    spawns: spawnObjects.map(object => ({
      id: tiledProps(object).spawnId || object.name,
      x: object.x,
      y: object.y
    })),
    objects: geometry,
    approachPoints: Object.fromEntries(
      objects.filter(o => o.point && o.name).map(o => [o.name, { x: o.x, y: o.y }])
    ),
    exits: objects.filter(o => tiledClass(o) === "Exit").map(o => ({
      id: o.name,
      box: { x: o.x, y: o.y, width: o.width || 0, height: o.height || 0 },
      ...tiledProps(o)
    })),
    encounterTriggers: objects.filter(o => tiledClass(o) === "EncounterTrigger").map(o => ({ id: o.name, ...tiledProps(o) }))
  };
}

export function mergeTiledPanoramicScene(scene, tiled, { spawnId } = {}) {
  const geometryById = new Map(tiled.objects.map(object => [object.id, object]));
  const sceneObjectIds = new Set((scene.objects || []).map(object => object.id));
  const missingGeometry = [...sceneObjectIds].filter(id => !geometryById.has(id));
  if (missingGeometry.length) {
    throw new Error(`El mapa Tiled no contiene geometría para: ${missingGeometry.join(", ")}`);
  }

  const objects = (scene.objects || []).map(object => {
    const geometry = geometryById.get(object.id);
    const offsetX = object.anchorOffsetX || 0;
    return {
      ...object,
      // La caja dibujada en Tiled es la autoridad. Si el PNG declara un
      // anchorOffsetX (farola con brazo lateral), se recupera el anclaje que
      // producirá exactamente esa misma caja al pasar por cajaDeObjeto().
      anchor: {
        x: geometry.box.x + geometry.box.width / 2 - offsetX,
        y: geometry.box.y + geometry.box.height
      },
      width: geometry.width,
      height: geometry.height,
      approachPoint: geometry.approachPoint
    };
  });

  const spawnSeleccionado = spawnId
    ? tiled.spawns.find(spawn => spawn.id === spawnId)
    : tiled.spawn;
  if (spawnId && !spawnSeleccionado) {
    throw new Error(`El mapa Tiled no contiene el spawn de llegada: ${spawnId}`);
  }

  return {
    ...scene,
    master: { ...scene.master, ...tiled.master },
    walkablePolygon: tiled.walkablePolygon,
    walkable: tiled.walkable,
    player: { ...scene.player, startX: spawnSeleccionado.x },
    objects,
    tiledRuntime: {
      spawn: spawnSeleccionado,
      spawns: tiled.spawns,
      approachPoints: tiled.approachPoints,
      exits: tiled.exits,
      encounterTriggers: tiled.encounterTriggers
    }
  };
}

export async function loadTiledPanoramicMap(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo cargar el mapa Tiled: ${url} (${response.status})`);
  const mapUrl = response.url || (typeof document !== "undefined" ? new URL(url, document.baseURI).href : url);
  return adaptTiledPanoramicMap(await response.json(), { mapUrl });
}
