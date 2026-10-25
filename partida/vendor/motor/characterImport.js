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
// `desdeExportFichaAutocalculada` traduce ese formulario mediante sus ids
// estables; `normalizeCharacter` valida después la forma semántica común. Ambos
// caminos devuelven el mismo formato interno que usa src/data/characters.json,
// de modo que el resto del motor no necesita saber de dónde vino la ficha.

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

const ATRIBUTOS_V4 = {
  A: "AGI", C: "CON", F: "FUE", H: "HAB",
  Ca: "CAR", I: "INT", P: "PER", V: "VOL"
};

// Orden canónico declarado por la ficha v4. Sus campos calculados tienen ids
// estables `sktot-${rama}-${indice}`; no dependemos de la posición del input
// dentro del DOM ni replicamos aquí sus fórmulas.
const HABILIDADES_V4 = {
  academicas: ["Ciencias", "Biotecnología", "Navegación", "Burocracia", "Buscar información", "Programación", "Diagnóstico", "Investigación", "Juego", "Diseño Hardware", "Sentido del Negocio", "Supervivencia", "Vigilar/Rastrear"],
  tecnologicas: ["Armería", "Artesanía", "Ciber-tecnología", "Demoliciones", "Disfraz", "Electrónica", "Falsificación", "Química", "Mecánica", "Manos ágiles", "Seguridad", "Primeros Auxilios", "Conducir", "Pilotar", "Trajes Servoasistidos", "Sigilo"],
  atleticas: ["Acrobacias", "Resistir", "Proezas", "Conducir", "Pilotar", "Sigilo"],
  sociales: ["Absorción", "Autocontrol", "Bajos Fondos", "Empatía", "Interrogatorio", "Liderazgo", "Manejo de Animales", "Persuasión", "Seducción", "Estilo"],
  combate: ["Iniciativa", "Alerta", "Esquivar", "Distancia Corta", "Distancia Media", "Distancia Larga", "Sin Armas", "Arma CC Corta", "Arma CC Media", "Arma CC Larga"],
  distorsion: ["Detección de Distorsión", "Manipulación de Distorsión", "Camino de los Portales", "Tatuador Rúnico", "Herrero Rúnico", "Proyección de Energía", "Protección de Energía", "Invocación de Energía"]
};

const PUNTOS_EPICOS_V4 = { "Héroe": 1, "Madera de Héroe": 3, "Predestinado": 9 };

function numeroDeFormulario(form, clave) {
  if (!(clave in form) || form[clave] === "" || form[clave] === null) return null;
  const valor = Number(form[clave]);
  return Number.isFinite(valor) ? valor : null;
}

function idDesdeNombre(nombre) {
  return String(nombre)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 48);
}

// Traduce el export real `{version:4,state,form}` sin ejecutar código de la
// ficha externa. Consume únicamente campos calculados que el propio export ya
// guarda, de modo que méritos, implantes y demás modificadores llegan incluidos
// en los totales finales.
export function desdeExportFichaAutocalculada(exportCrudo) {
  if (!exportCrudo || exportCrudo.version !== 4 || !exportCrudo.form || typeof exportCrudo.form !== "object" || Array.isArray(exportCrudo.form)) {
    throw new CharacterImportError("El archivo no es un export compatible de la ficha autocalculada v4.");
  }

  const { form } = exportCrudo;
  const state = exportCrudo.state && typeof exportCrudo.state === "object" ? exportCrudo.state : {};
  const nombre = typeof form.personaje === "string" ? form.personaje.trim() : "";
  const atributos = {};
  const ausentes = [];
  Object.entries(ATRIBUTOS_V4).forEach(([codigoV4, codigoMotor]) => {
    const valor = numeroDeFormulario(form, `at-${codigoV4}`);
    if (valor === null) ausentes.push(`at-${codigoV4}`);
    else atributos[codigoMotor] = valor;
  });

  const habilidades = {};
  Object.entries(HABILIDADES_V4).forEach(([rama, nombres]) => {
    nombres.forEach((skill, indice) => {
      const campo = `sktot-${rama}-${indice}`;
      const valor = numeroDeFormulario(form, campo);
      if (valor === null) {
        ausentes.push(campo);
        return;
      }
      // Conducir, Pilotar y Sigilo existen en dos ramas de la ficha. El motor
      // usa una clave única, así que conserva el total más favorable ya
      // calculado por la fuente.
      habilidades[skill] = Math.max(habilidades[skill] ?? -Infinity, valor);
    });
  });

  if (!nombre) ausentes.push("personaje");
  if (ausentes.length) {
    throw new CharacterImportError("El export v4 está incompleto o fue creado antes de calcular la ficha.", ausentes.map(campo => `Falta el campo calculado "${campo}".`));
  }

  const A = atributos.AGI, C = atributos.CON, F = atributos.FUE;
  const pvBase = Math.ceil((A + C + F) / 6);
  const compras = Array.isArray(state.compras) ? state.compras : [];
  const humanidad = Math.max(0, 100 - compras.reduce((total, compra) => total + (Number(compra?.hum) || 0), 0));
  const profesiones = Array.isArray(state.effectiveProfs) ? state.effectiveProfs.filter(p => typeof p === "string" && p.trim()) : [];
  const iniciado = profesiones.includes("Iniciado");
  const almaMaxima = iniciado ? 10 : 8;
  const equipo = typeof form.equipoInicial === "string" ? form.equipoInicial.split(/\r?\n/).map(linea => linea.trim()).filter(Boolean) : [];
  const armaduraFuente = state.armadura && typeof state.armadura === "object" ? state.armadura : null;
  const creditos = typeof form.dineroFinal === "string" || typeof form.dineroFinal === "number"
    ? Number.parseInt(String(form.dineroFinal).replace(/[^\d-]/g, ""), 10) || 0
    : 0;

  return {
    id: idDesdeNombre(nombre),
    nombre,
    rol: profesiones.join(" / ") || String(form.tipoPersonaje || "Errante"),
    cita: typeof state.historia === "string" ? state.historia : "",
    atributos,
    pvBase,
    niveles: { sano: pvBase, herido: pvBase, tullido: pvBase },
    humanidad,
    saludMental: 100,
    alma: { actual: Math.min(almaMaxima, Math.floor(humanidad / 10)), maxima: almaMaxima },
    deriva: 0,
    cargaLibre: Math.ceil((F + C) / 4),
    creditos,
    puntosEpicos: PUNTOS_EPICOS_V4[form.tipoPersonaje] ?? 1,
    habilidades,
    armadura: armaduraFuente ? { nombre: String(armaduraFuente.n || "Armadura"), blindaje: Number(armaduraFuente.bld) || 0, zonas: [] } : null,
    equipo
  };
}
