const SIN_ARMA_DISTANCIA = Object.freeze({
  nombre: "Sin arma a distancia",
  danioBase: 0,
  penetracion: 0,
  tamano: "pequena",
  cadenciaMax: "tiroATiro",
  noDisponible: true
});

const SIN_ARMA_CC = Object.freeze({
  nombre: "Sin armas",
  danioBase: 0,
  fuerzaMinima: 0,
  tamano: "pequena"
});

function maximoHabilidad(habilidades, nombres, fallback = 0) {
  const valores = nombres.map(nombre => habilidades?.[nombre]).filter(Number.isFinite);
  return valores.length ? Math.max(...valores) : fallback;
}

function cadenciaTactica(valor) {
  const clave = String(valor ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  if (clave === "fuegosostenido") return "fuegoSostenido";
  if (clave === "rafaga") return "rafaga";
  return "tiroATiro";
}

function armaDistanciaDesde(base) {
  if (!base?.arma) return { ...SIN_ARMA_DISTANCIA };
  return {
    nombre: base.arma.nombre ?? "Arma a distancia",
    danioBase: base.arma.danio ?? 0,
    penetracion: base.arma.penetracion ?? 0,
    tamano: base.arma.tamano ?? "pequena",
    cadenciaMax: cadenciaTactica(base.arma.cadenciaMax)
  };
}

function armaCCDesde(base) {
  if (!base?.armaCC) return { ...SIN_ARMA_CC };
  return {
    nombre: base.armaCC.nombre ?? "Sin armas",
    danioBase: base.armaCC.danio ?? 0,
    fuerzaMinima: base.armaCC.fuerzaMinima ?? 0,
    tamano: base.armaCC.tamano ?? "pequena"
  };
}

function actorDesdeJugador(jugador, plaza) {
  const base = jugador.base;
  const agilidad = base.atributos?.AGI ?? 0;
  const habilidad = base.atributos?.HAB ?? 0;
  const fuerza = base.atributos?.FUE ?? 0;
  const arma = armaDistanciaDesde(base);
  const municion = jugador.municion ?? {
    cargador: base.arma?.magazineSize ?? 0,
    reserva: base.arma?.ammoReserve ?? 0
  };

  return {
    ...plaza,
    id: base.id,
    nombre: base.nombre,
    esPJ: true,
    habilidadDisparo: maximoHabilidad(jugador.habilidades, ["Distancia Corta", "Distancia Media", "Distancia Larga"], habilidad),
    habilidadCC: maximoHabilidad(jugador.habilidades, ["Arma CC Corta", "Arma CC Media", "Arma CC Larga", "Sin Armas"], Math.max(agilidad, fuerza)),
    habilidadEsquivar: maximoHabilidad(jugador.habilidades, ["Esquivar"], agilidad),
    blindaje: base.armadura?.blindaje ?? 0,
    armaPrimaria: arma,
    armaCC: armaCCDesde(base),
    municion: { primaria: { ...municion } },
    vidaActual: { ...jugador.vidaActual },
    base: { ...base, niveles: { ...base.niveles } },
    estadoDisponibilidad: jugador.estadoDisponibilidad ?? "disponible"
  };
}

/**
 * Inserta el personaje que pilota la persona en la definición táctica sin
 * acoplar el motor a un módulo. Si ya existe, solo actualiza `esPJ`. Si no
 * existe, el módulo debe declarar `playerActorSlotId`: esa plaza aporta la
 * posición inicial y mantiene el tamaño/equilibrio del grupo del encuentro.
 */
export function integrarJugadorEnDefinicion(definition, jugador) {
  const party = definition.actors.party;
  const jugadorId = jugador?.base?.id;
  const indiceExistente = party.findIndex(actor => actor.id === jugadorId);
  let partyAdaptada = party.map(actor => ({ ...actor, esPJ: actor.id === jugadorId }));

  if (jugadorId && indiceExistente < 0 && definition.playerActorSlotId) {
    const indicePlaza = party.findIndex(actor => actor.id === definition.playerActorSlotId);
    if (indicePlaza >= 0) partyAdaptada[indicePlaza] = actorDesdeJugador(jugador, party[indicePlaza]);
  }

  const retrato = jugador?.base?.retrato;
  return {
    ...definition,
    actors: { ...definition.actors, party: partyAdaptada },
    assets: retrato ? {
      ...definition.assets,
      portraits: { ...(definition.assets?.portraits ?? {}), [jugadorId]: retrato }
    } : definition.assets
  };
}
