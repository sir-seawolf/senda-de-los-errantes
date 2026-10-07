// Contrato de un encuentro táctico (encargo TACTICAL_ENGINE_MODULE_CONTRACT,
// punto 7/41-43/56-58). Ver docs/TACTICAL_ENCOUNTER_CONTRACT.md para la
// documentación completa con ejemplo mínimo -- este archivo es la
// VALIDACIÓN ejecutable de ese contrato, no solo su descripción.
//
// Principio: fail-fast (punto 43) -- un encuentro inválido debe fallar
// ANTES de arrancar Phaser, con un mensaje que señale encounterId + campo
// + problema (punto 57), nunca a mitad de combate.

export const SCHEMA_VERSION_ACTUAL = 1;

const TIPOS_OBSTACULO = new Set(["partial", "solid", "total"]);

function esNumero(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function validarArma(arma, ruta, errores, { requierePenetracion = true } = {}) {
  if (!arma || typeof arma !== "object") { errores.push(`${ruta}: falta o no es un objeto`); return; }
  if (typeof arma.nombre !== "string" || !arma.nombre) errores.push(`${ruta}.nombre: falta`);
  if (!esNumero(arma.danioBase)) errores.push(`${ruta}.danioBase: falta o no es número`);
  if (requierePenetracion && !esNumero(arma.penetracion)) errores.push(`${ruta}.penetracion: falta o no es número`);
}

function validarActor(actor, ruta, errores) {
  if (!actor || typeof actor !== "object") { errores.push(`${ruta}: falta o no es un objeto`); return; }
  if (typeof actor.id !== "string" || !actor.id) errores.push(`${ruta}.id: falta`);
  if (typeof actor.nombre !== "string" || !actor.nombre) errores.push(`${ruta}.nombre: falta`);
  if (!esNumero(actor.x) || !esNumero(actor.y)) errores.push(`${ruta}.position: falta o no es numérica (x/y)`);
  if (!esNumero(actor.habilidadDisparo)) errores.push(`${ruta}.habilidadDisparo: falta o no es número`);
  if (!esNumero(actor.habilidadCC)) errores.push(`${ruta}.habilidadCC: falta o no es número`);
  // habilidadEsquivar es OPCIONAL a propósito (Production Integration
  // Phase 3.5, docs/TACTICAL_PRODUCTION_PHASE35.md): no todo actor tiene
  // un dato canónico de esquiva/dodge (p.ej. un NPC genérico cuya ficha
  // fuente nunca declaró esa habilidad). Ausencia = capacidad
  // inexistente, no un valor por defecto inventado -- ver
  // src/tactical/ai/tacticalAI.js, que ya respeta esta ausencia sin
  // ofrecer EVASIVE_MOVEMENT a un actor sin este dato. Si SE declara,
  // debe ser numérico.
  if (actor.habilidadEsquivar !== undefined && !esNumero(actor.habilidadEsquivar)) errores.push(`${ruta}.habilidadEsquivar: si se declara, debe ser número`);
  if (!esNumero(actor.blindaje)) errores.push(`${ruta}.blindaje: falta o no es número`);
  validarArma(actor.armaPrimaria, `${ruta}.armaPrimaria`, errores);
  if (actor.armaSecundaria) validarArma(actor.armaSecundaria, `${ruta}.armaSecundaria`, errores);
  validarArma(actor.armaCC, `${ruta}.armaCC`, errores, { requierePenetracion: false });

  if (!actor.municion || typeof actor.municion !== "object") {
    errores.push(`${ruta}.municion: falta`);
  } else {
    if (!actor.municion.primaria || !esNumero(actor.municion.primaria.cargador) || !esNumero(actor.municion.primaria.reserva)) {
      errores.push(`${ruta}.municion.primaria: falta cargador/reserva numéricos`);
    }
    if (actor.armaSecundaria && (!actor.municion.secundaria || !esNumero(actor.municion.secundaria.cargador) || !esNumero(actor.municion.secundaria.reserva))) {
      errores.push(`${ruta}.municion.secundaria: el actor declara armaSecundaria pero falta su munición`);
    }
  }

  if (!actor.vidaActual || !esNumero(actor.vidaActual.sano) || !esNumero(actor.vidaActual.herido) || !esNumero(actor.vidaActual.tullido)) {
    errores.push(`${ruta}.vidaActual: falta sano/herido/tullido numéricos`);
  }
  if (!actor.base || !actor.base.niveles || !esNumero(actor.base.niveles.tullido)) {
    errores.push(`${ruta}.base.niveles.tullido: falta (requerido por nivelHeridaDe() real)`);
  }
}

function validarObstaculo(obstaculo, ruta, errores) {
  if (!obstaculo || typeof obstaculo !== "object") { errores.push(`${ruta}: falta o no es un objeto`); return; }
  if (typeof obstaculo.id !== "string" || !obstaculo.id) errores.push(`${ruta}.id: falta`);
  if (!TIPOS_OBSTACULO.has(obstaculo.type)) errores.push(`${ruta}.type: debe ser "partial"|"solid"|"total", recibido "${obstaculo.type}"`);
  if (!esNumero(obstaculo.x) || !esNumero(obstaculo.y)) errores.push(`${ruta}.position: falta o no es numérica (x/y)`);
  if (!esNumero(obstaculo.width) || !esNumero(obstaculo.height)) errores.push(`${ruta}.size: falta o no es numérico (width/height)`);
}

function validarZonaTerreno(zona, ruta, errores) {
  if (!zona || typeof zona !== "object") { errores.push(`${ruta}: falta o no es un objeto`); return; }
  if (typeof zona.id !== "string" || !zona.id) errores.push(`${ruta}.id: falta`);
  if (!esNumero(zona.x) || !esNumero(zona.y)) errores.push(`${ruta}.position: falta o no es numérica (x/y)`);
  if (!esNumero(zona.width) || zona.width <= 0 || !esNumero(zona.height) || zona.height <= 0) errores.push(`${ruta}.size: width/height deben ser positivos`);
  if (zona.movementMultiplier !== undefined && (!esNumero(zona.movementMultiplier) || zona.movementMultiplier < 1)) errores.push(`${ruta}.movementMultiplier: debe ser un número >= 1`);
  if (zona.elevationMeters !== undefined && (!esNumero(zona.elevationMeters) || zona.elevationMeters < 0)) errores.push(`${ruta}.elevationMeters: debe ser un número >= 0`);
  if (zona.asset !== undefined && (typeof zona.asset !== "string" || !zona.asset)) errores.push(`${ruta}.asset: debe ser un identificador no vacío`);
  if (zona.structureId !== undefined && (typeof zona.structureId !== "string" || !zona.structureId)) errores.push(`${ruta}.structureId: debe ser un identificador no vacío`);
  if (zona.attachedToExitId !== undefined && (typeof zona.attachedToExitId !== "string" || !zona.attachedToExitId)) errores.push(`${ruta}.attachedToExitId: debe ser un identificador no vacío`);
  if (zona.occupantIds !== undefined && (!Array.isArray(zona.occupantIds) || zona.occupantIds.some(id => typeof id !== "string" || !id))) errores.push(`${ruta}.occupantIds: debe ser un array de identificadores no vacíos`);
}

function validarComposicionEscena(def, p, errores) {
  const visuals = def.battlefield?.visuals;
  if (!visuals) return;
  const walls = Array.isArray(visuals.walls) ? visuals.walls : [];
  const exits = Array.isArray(visuals.exits) ? visuals.exits : [];
  const terrain = Array.isArray(def.battlefield.terrainZones) ? def.battlefield.terrainZones : [];
  const actorIds = new Set([...(def.actors?.party ?? []), ...(def.actors?.enemies ?? [])].map(actor => actor.id));
  const exitIds = new Set(exits.map(exit => exit.id));
  const structureIds = new Set([...walls, ...exits].map(entry => entry.structureId).filter(Boolean));

  for (const [i, zona] of terrain.entries()) {
    const ruta = p(`battlefield.terrainZones[${i}]`);
    if (zona.structureId && !structureIds.has(zona.structureId)) errores.push(`${ruta}.structureId: no referencia ninguna pared o salida`);
    if (zona.attachedToExitId && !exitIds.has(zona.attachedToExitId)) errores.push(`${ruta}.attachedToExitId: salida inexistente "${zona.attachedToExitId}"`);
    for (const actorId of zona.occupantIds ?? []) {
      if (!actorIds.has(actorId)) errores.push(`${ruta}.occupantIds: actor inexistente "${actorId}"`);
    }
  }
}

const TIPOS_OBJETIVO_SOPORTADOS = new Set(["eliminateEnemies", "allPartyDown"]);

function validarObjetivo(objetivo, ruta, errores) {
  if (!objetivo || typeof objetivo !== "object") { errores.push(`${ruta}: falta`); return; }
  if (!TIPOS_OBJETIVO_SOPORTADOS.has(objetivo.type)) {
    errores.push(`${ruta}.type: "${objetivo.type}" no soportado todavía (soportados: ${[...TIPOS_OBJETIVO_SOPORTADOS].join(", ")}) -- ver docs/TACTICAL_ENCOUNTER_CONTRACT.md, "Objetivos"`);
  }
}

/**
 * Valida un TacticalEncounterDefinition completo. Devuelve
 * {valid, errors} -- nunca lanza (el caller decide si convertir en
 * excepción, ver TacticalEncounterLoader.js, punto 43: fail-fast antes
 * de arrancar Phaser).
 */
export function validateEncounterDefinition(def) {
  const errores = [];
  if (!def || typeof def !== "object") return { valid: false, errors: ["encounterDefinition: falta o no es un objeto"] };

  const id = typeof def.id === "string" && def.id ? def.id : "(sin id)";
  const p = (sufijo) => `${id}.${sufijo}`;

  if (typeof def.id !== "string" || !def.id) errores.push(`${id}.id: falta`);
  if (def.schemaVersion !== SCHEMA_VERSION_ACTUAL) errores.push(`${p("schemaVersion")}: esperado ${SCHEMA_VERSION_ACTUAL}, recibido ${JSON.stringify(def.schemaVersion)}`);

  if (!def.battlefield || typeof def.battlefield !== "object") {
    errores.push(`${p("battlefield")}: falta`);
  } else {
    if (!esNumero(def.battlefield.widthMeters) || def.battlefield.widthMeters <= 0) errores.push(`${p("battlefield.widthMeters")}: falta o no es positivo`);
    if (!esNumero(def.battlefield.heightMeters) || def.battlefield.heightMeters <= 0) errores.push(`${p("battlefield.heightMeters")}: falta o no es positivo`);
    if (!Array.isArray(def.battlefield.obstacles)) {
      errores.push(`${p("battlefield.obstacles")}: falta o no es un array`);
    } else {
      def.battlefield.obstacles.forEach((o, i) => validarObstaculo(o, p(`battlefield.obstacles[${i}]`), errores));
    }
    if (def.battlefield.terrainZones !== undefined) {
      if (!Array.isArray(def.battlefield.terrainZones)) errores.push(`${p("battlefield.terrainZones")}: debe ser un array`);
      else def.battlefield.terrainZones.forEach((zona, i) => validarZonaTerreno(zona, p(`battlefield.terrainZones[${i}]`), errores));
    }
  }

  if (!def.actors || typeof def.actors !== "object") {
    errores.push(`${p("actors")}: falta`);
  } else {
    if (!Array.isArray(def.actors.party) || def.actors.party.length === 0) {
      errores.push(`${p("actors.party")}: falta o está vacío (al menos 1 PJ)`);
    } else {
      def.actors.party.forEach((a, i) => validarActor(a, p(`actors.party[${i}]`), errores));
    }
    if (!Array.isArray(def.actors.enemies)) {
      errores.push(`${p("actors.enemies")}: falta o no es un array (puede ser [] si el encuentro no tiene enemigos todavía)`);
    } else {
      def.actors.enemies.forEach((a, i) => validarActor(a, p(`actors.enemies[${i}]`), errores));
    }
  }

  if (!def.objectives || typeof def.objectives !== "object") {
    errores.push(`${p("objectives")}: falta`);
  } else {
    validarObjetivo(def.objectives.victory, p("objectives.victory"), errores);
    validarObjetivo(def.objectives.defeat, p("objectives.defeat"), errores);
  }

  if (def.playerActorSlotId !== undefined) {
    if (typeof def.playerActorSlotId !== "string" || !def.playerActorSlotId) {
      errores.push(`${p("playerActorSlotId")}: debe ser un identificador no vacío`);
    } else if (!def.actors?.party?.some(actor => actor.id === def.playerActorSlotId)) {
      errores.push(`${p("playerActorSlotId")}: no referencia ningún actor de actors.party`);
    }
  }

  validarComposicionEscena(def, p, errores);

  if (def.transitions !== undefined) {
    if (typeof def.transitions !== "object" || def.transitions === null) {
      errores.push(`${p("transitions")}: si se declara, debe ser un objeto {victory, defeat, flee}`);
    } else {
      // Production Integration Phase 3.5 (docs/TACTICAL_PRODUCTION_PHASE35.md):
      // cada transición puede ser un id de escena (string), null (sin
      // transición conocida todavía), o {resolver:"module"} -- una
      // delegación DECLARATIVA (nunca una función, sigue siendo
      // JSON-safe) que le dice al módulo consumidor "resuelve tú esta
      // transición con tu propio estado narrativo, el motor no tiene
      // datos suficientes para decidirlo" (p.ej. un final condicional a
      // si se gastó un Punto Épico). "flee" es un tercer outcome de
      // encuentro, independiente de victory/defeat -- no todo módulo lo
      // usa (opcional, con default null, ver conDefaults()).
      for (const clave of ["victory", "defeat", "flee"]) {
        const v = def.transitions[clave];
        const esValida = v === undefined || v === null || typeof v === "string" || (typeof v === "object" && v !== null && typeof v.resolver === "string");
        if (!esValida) errores.push(`${p(`transitions.${clave}`)}: debe ser string, null, o {resolver:"module"}`);
      }
    }
  }

  return { valid: errores.length === 0, errors: errores };
}

/**
 * Aplica defaults SOLO a propiedades realmente opcionales (punto 42: "no
 * esconder errores de módulo") -- nunca rellena `id`, `actors`,
 * `battlefield` ni `objectives`, que son obligatorios y deben fallar la
 * validación si faltan.
 */
export function conDefaults(def) {
  return {
    renderer: "phaser-tactical",
    ai: { enemies: "cautious", companions: "cautious" },
    assets: { moduleRoot: null, battlefield: null, actors: {}, fxProfile: "generic" },
    ...def,
    battlefield: {
      coverRadiusMeters: 2.2,
      metersToPx: 40,
      background: null,
      ...def.battlefield,
      obstacles: def.battlefield?.obstacles ?? [],
      terrainZones: def.battlefield?.terrainZones ?? [],
      terrainConfig: { costeAscensoPorMetro: 0.5, ...def.battlefield?.terrainConfig }
    },
    // Merge profundo (no reemplazo total) para que fixtures antiguas que
    // solo declaran {victory, defeat} (P2, antes de que "flee" existiera)
    // sigan recibiendo flee:null por defecto, en vez de perder la clave.
    transitions: { victory: null, defeat: null, flee: null, ...def.transitions }
  };
}
