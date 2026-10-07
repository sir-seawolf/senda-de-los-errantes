// Adaptador de importación de personajes — NO acoplado al formato interno del
// motor ni al formato exacto de ninguna ficha externa concreta.
//
// Contexto (ver docs/CHARACTER_IMPORT_SPEC.md para el detalle completo):
// la ficha autocalculada del proyecto
// (SENDA_ERRANTES/06_MODULOS/KIT_DE_INICIO/FICHAS/FICHA_Personaje_Autocalculada_v4_json_preguntas.js)
// ya puede exportar JSON (función `guardarJSON`/`collectData`), pero ese export
// tiene forma de FORMULARIO — `{ version, state, form, exportedAt }`, donde
// `form` son pares `idDeCampoDelDOM -> valor` (p.ej. inputs de Méritos/Defectos,
// checkboxes de runas...), no una ficha semántica de atributos/habilidades.
// Traducir ese formulario 1:1 exige conocer cada id de campo del HTML — trabajo
// deliberadamente fuera de esta iteración (ver instrucción 8 del encargo).
//
// Por eso `normalizeCharacter` aquí NO parsea `form` directamente. Asume una
// forma "semántica" intermedia (`ExternalCharacterJSON`, documentada abajo y en
// el spec) que sí es razonable pedirle a un exportador futuro, y siempre
// devuelve el mismo formato interno que ya usa src/data/characters.json — así
// characters.json y cualquier personaje importado son intercambiables para el
// resto del motor sin que este tenga que saber de dónde vino cada uno.

/**
 * Forma esperada de entrada (ExternalCharacterJSON) — ver CHARACTER_IMPORT_SPEC.md:
 * {
 *   id, nombre, rol, retrato, cita,
 *   atributos: { AGI, CON, FUE, HAB, CAR, INT, PER, VOL },
 *   pvBase, niveles: { sano, herido, tullido },
 *   humanidad, saludMental, alma: { actual, maxima }, deriva,
 *   cargaLibre, creditos, puntosEpicos,
 *   habilidades: { [nombreHabilidad]: valorTotal, ... },
 *   arma, armaCC, armadura, equipo: [...]
 * }
 */
export function normalizeCharacter(externalJson) {
  const errores = validarCampos(externalJson);
  if (errores.length) {
    throw new CharacterImportError("El JSON externo no tiene la forma esperada por el motor.", errores);
  }

  const retratoDeclarado = externalJson.retrato?.trim() ?? "";
  return {
    schemaVersion: 1,
    sistema: externalJson.sistema ?? "senda_qs",
    id: externalJson.id.trim(),
    nombre: externalJson.nombre.trim(),
    rol: externalJson.rol ?? "",
    // Las primeras fichas importadas recibían esta ruta ficticia aunque el
    // archivo nunca existió. Normalizarla a vacío migra esas bibliotecas sin
    // conservar una imagen rota.
    retrato: retratoDeclarado === "assets/characters/placeholder.png" ? "" : retratoDeclarado,
    cita: externalJson.cita ?? "",
    atributos: { ...externalJson.atributos },
    pvBase: externalJson.pvBase,
    niveles: { ...externalJson.niveles },
    humanidad: externalJson.humanidad ?? 100,
    saludMental: externalJson.saludMental ?? 100,
    alma: { actual: 8, maxima: 10, ...(externalJson.alma ?? {}) },
    deriva: externalJson.deriva ?? 0,
    cargaLibre: externalJson.cargaLibre ?? 0,
    creditos: externalJson.creditos ?? 0,
    puntosEpicos: externalJson.puntosEpicos ?? 1,
    habilidades: { ...externalJson.habilidades },
    arma: externalJson.arma ?? null,
    armaCC: externalJson.armaCC ?? null,
    armadura: externalJson.armadura ?? null,
    equipo: [...(externalJson.equipo ?? [])],
    rasgoOpcional: externalJson.rasgoOpcional ?? null,
    fortaleza: externalJson.fortaleza ?? "",
    origen: "importado"
  };
}

function validarCampos(externalJson) {
  const errores = [];
  if (!externalJson || typeof externalJson !== "object") return ["El JSON está vacío o no es un objeto."];

  const requeridos = ["id", "nombre", "atributos", "pvBase", "niveles", "habilidades"];
  requeridos.forEach(campo => {
    if (externalJson[campo] === undefined) errores.push(`Falta el campo obligatorio "${campo}".`);
  });

  if (externalJson.id !== undefined && (typeof externalJson.id !== "string" || !/^[a-z0-9][a-z0-9_-]{1,47}$/i.test(externalJson.id.trim()))) {
    errores.push('"id" debe tener 2-48 caracteres y usar solo letras, números, guion o guion bajo.');
  }
  if (externalJson.nombre !== undefined && (typeof externalJson.nombre !== "string" || !externalJson.nombre.trim() || externalJson.nombre.trim().length > 80)) {
    errores.push('"nombre" debe ser texto no vacío de hasta 80 caracteres.');
  }

  const contieneMarcado = valor => typeof valor === "string" && /[<>\u0000-\u001f]/.test(valor);
  function revisarTexto(valor, ruta = "personaje") {
    if (contieneMarcado(valor)) errores.push(`Texto no permitido en "${ruta}".`);
    else if (Array.isArray(valor)) valor.forEach((v, i) => revisarTexto(v, `${ruta}[${i}]`));
    else if (valor && typeof valor === "object") Object.entries(valor).forEach(([k, v]) => { revisarTexto(k, `${ruta}.clave`); revisarTexto(v, `${ruta}.${k}`); });
  }
  revisarTexto(externalJson);

  const atributosEsperados = ["AGI", "CON", "FUE", "HAB", "CAR", "INT", "PER", "VOL"];
  if (externalJson.atributos && (typeof externalJson.atributos !== "object" || Array.isArray(externalJson.atributos))) {
    errores.push('"atributos" debe ser un objeto.');
  } else if (externalJson.atributos) {
    atributosEsperados.forEach(a => {
      const valor = externalJson.atributos[a];
      if (!Number.isFinite(valor) || valor < 0 || valor > 200) errores.push(`Atributo "${a}" ausente o fuera del intervalo 0-200.`);
    });
  }

  if (!Number.isFinite(externalJson.pvBase) || externalJson.pvBase <= 0 || externalJson.pvBase > 999) {
    errores.push('"pvBase" debe ser un número entre 1 y 999.');
  }

  if (externalJson.niveles && (typeof externalJson.niveles !== "object" || Array.isArray(externalJson.niveles))) {
    errores.push('"niveles" debe ser un objeto.');
  } else if (externalJson.niveles) {
    ["sano", "herido", "tullido"].forEach(n => {
      const valor = externalJson.niveles[n];
      if (!Number.isFinite(valor) || valor < 0 || valor > 999) errores.push(`Nivel de vida "${n}" ausente o fuera del intervalo 0-999.`);
    });
  }

  if (externalJson.habilidades && (typeof externalJson.habilidades !== "object" || Array.isArray(externalJson.habilidades))) {
    errores.push('"habilidades" debe ser un objeto { nombre: valor }.');
  } else if (externalJson.habilidades) {
    Object.entries(externalJson.habilidades).forEach(([nombre, valor]) => {
      if (!nombre.trim() || nombre.length > 80 || !Number.isFinite(valor) || valor < 0 || valor > 200) errores.push(`Habilidad "${nombre}" inválida.`);
    });
  }

  if (externalJson.equipo !== undefined && !Array.isArray(externalJson.equipo)) {
    errores.push('"equipo" debe ser una lista.');
  }

  const protocoloRetrato = typeof externalJson.retrato === "string" ? externalJson.retrato.trim().match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() : null;
  if (externalJson.retrato !== undefined && (typeof externalJson.retrato !== "string" || externalJson.retrato.length > 300 || /["'<>\\]/.test(externalJson.retrato) || (protocoloRetrato && !["http", "https"].includes(protocoloRetrato)))) {
    errores.push('"retrato" debe ser una ruta o URL http(s) segura.');
  }

  return errores;
}

export class CharacterImportError extends Error {
  constructor(message, detalles = []) {
    super(message);
    this.name = "CharacterImportError";
    this.detalles = detalles;
  }
}

// Punto de enganche futuro: dado un export CRUDO de la ficha autocalculada
// (`{version, state, form, exportedAt}`), traducirlo a ExternalCharacterJSON.
// Deliberadamente no implementado — requiere el mapa completo de ids de campo
// del formulario HTML. Lanza siempre para no fingir un resultado inventado.
export function desdeExportFichaAutocalculada(_exportCrudo) {
  throw new CharacterImportError(
    "Traducción directa desde el export de la ficha autocalculada (formato {version, state, form}) " +
    "todavía no está implementada — ver docs/CHARACTER_IMPORT_SPEC.md, sección 'Trabajo futuro'."
  );
}
