// Ensamblador puro de módulos: no depende de DOM, Phaser ni contenido concreto.
const CONSEQUENCE_KEYS = new Set(["onAlways","onSuccess","onFailure","onVictory","onFlee","onDeath","onDeathWithEpicPoint","consequence","onSuccessConsequence","onFailureConsequence"]);

function walk(value, visit, path = "") {
  if (!value || typeof value !== "object") return;
  visit(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, `${path}[${i}]`));
  else Object.entries(value).forEach(([k, v]) => walk(v, visit, path ? `${path}.${k}` : k));
}

export function assembleModuleGraph(manifest, scenes, { resources = new Set() } = {}) {
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  const edges = new Map(scenes.map(scene => [scene.id, new Set()]));
  const producedFlags = new Map();
  const consumedFlags = new Map();
  const missingResources = [];
  const repeatedRolls = [];
  const fakeClosures = [];
  const errors = [];
  const warnings = [];

  const noteFlag = (map, flag, id) => {
    if (!map.has(flag)) map.set(flag, new Set());
    map.get(flag).add(id);
  };

  for (const scene of scenes) {
    if (!scene?.id) continue;
    for (const target of scene.externalTransitions || []) edges.get(scene.id).add(target);
    walk(scene, (node, path) => {
      if (typeof node.transition === "string") edges.get(scene.id).add(node.transition);
      for (const flag of node.setFlags || []) noteFlag(producedFlags, flag, scene.id);
      for (const flag of [...(node.requiresFlags || []), ...(node.blockedByFlags || [])]) noteFlag(consumedFlags, flag, scene.id);
      if (node.roll && node.oncePerActor !== true && /forzar|descifrar|rastrear|hack|abrir/i.test(node.roll.label || "")) {
        repeatedRolls.push({ scene: scene.id, path, label: node.roll.label });
      }
    });
    if (scene.type === "ending") {
      for (const [id, ending] of Object.entries(scene.endings || {})) {
        if (ending.continuacion) edges.get(scene.id).add(ending.continuacion);
        if (id.startsWith("checkpoint_") || /continuar[aá]/i.test(ending.titulo + " " + ending.texto)) fakeClosures.push({ scene: scene.id, ending: id });
      }
    }
    for (const field of ["background","tiledMap"]) {
      const resource = scene[field];
      if (resource && resources.size && !resources.has(resource)) missingResources.push({ scene: scene.id, field, resource });
    }
  }

  for (const [from, targets] of edges) for (const to of targets) {
    if (!byId.has(to)) errors.push({ code:"BROKEN_LINK", from, to });
  }

  const reachable = new Set();
  const queue = manifest.startScene ? [manifest.startScene] : [];
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id) || !byId.has(id)) continue;
    reachable.add(id);
    edges.get(id)?.forEach(next => queue.push(next));
  }
  const unreachable = [...byId.keys()].filter(id => !reachable.has(id));
  const accidentalDeadEnds = [...reachable].filter(id => {
    const scene = byId.get(id);
    return scene.type !== "ending" && (edges.get(id)?.size || 0) === 0;
  });
  const unusedFlags = [...producedFlags.keys()].filter(flag => !consumedFlags.has(flag));
  unreachable.forEach(scene => warnings.push({ code:"UNREACHABLE_SCENE", scene }));
  accidentalDeadEnds.forEach(scene => errors.push({ code:"ACCIDENTAL_DEAD_END", scene }));
  fakeClosures.forEach(item => errors.push({ code:"FALSE_CLOSURE", ...item }));
  missingResources.forEach(item => warnings.push({ code:"MISSING_RESOURCE", ...item }));
  unusedFlags.forEach(flag => warnings.push({ code:"UNCONSUMED_STATE", flag, producers:[...producedFlags.get(flag)] }));
  repeatedRolls.forEach(item => warnings.push({ code:"POSSIBLY_REPEATABLE_ROLL", ...item }));

  return {
    moduleId: manifest.id, startScene: manifest.startScene,
    counts:{ scenes:scenes.length, reachable:reachable.size, edges:[...edges.values()].reduce((n,s)=>n+s.size,0) },
    renderPlan:Object.fromEntries(scenes.map(scene => [scene.id, scene.renderer || scene.type || "narrative"])),
    errors, warnings, unreachable, accidentalDeadEnds, fakeClosures, missingResources, unusedFlags
  };
}
