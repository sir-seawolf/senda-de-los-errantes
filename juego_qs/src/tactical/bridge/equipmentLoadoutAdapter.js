import { equipamientoActivoDe, obtenerMiembro } from "../../gameState.js";
import { rutaDeManifiesto } from "../../engine/moduleLoader.js";

const SIN_ARMA_DISTANCIA = Object.freeze({ nombre: "Sin arma a distancia", danioBase: 0, penetracion: 0, tamano: "pequena", cadenciaMax: "tiroATiro", noDisponible: true });
const SIN_ARMA_CC = Object.freeze({ nombre: "Sin arma cuerpo a cuerpo", danioBase: 0, fuerzaMinima: 0, tamano: "pequena", noDisponible: true });

function claveDe(referencia) {
  return referencia?.split(":").slice(1).join(":") || null;
}

function armaTactica(definicion) {
  return {
    nombre: definicion.nombre,
    danioBase: definicion.danio,
    penetracion: definicion.penetracion ?? 0,
    tamano: definicion.tamano,
    cadenciaMax: definicion.cadenciaMax ?? "tiroATiro"
  };
}

function municionInicial(definicion) {
  return { cargador: definicion.magazineSize ?? 0, reserva: definicion.ammoReserve ?? 0 };
}

function blindajeActivo(miembroId, catalogo, actorFallback) {
  const entrada = equipamientoActivoDe(miembroId, "armor")[0];
  if (!entrada) return 0;
  const clave = claveDe(entrada.referencia);
  const catalogada = catalogo.armaduras?.[clave];
  if (catalogada) return catalogada.blindaje ?? 0;
  const base = obtenerMiembro(miembroId)?.base?.armadura;
  return base?.equipoId?.split(":")[1] === clave ? (base.blindaje ?? 0) : actorFallback.blindaje;
}

function seleccionarArma(miembroId, tipo, catalogo) {
  const entrada = equipamientoActivoDe(miembroId, tipo)[0];
  if (!entrada) return null;
  const definicion = catalogo.armas?.[claveDe(entrada.referencia)];
  if (!definicion) return null;
  return { entrada, definicion };
}

export async function cargarCatalogoEquipoActivo() {
  const response = await fetch(rutaDeManifiesto("weapons"));
  if (!response.ok) throw new Error(`No se pudo cargar el catálogo de equipo (${response.status})`);
  return response.json();
}

export function hidratarPartyDesdeEquipo(definition, catalogo) {
  return {
    ...definition,
    actors: {
      ...definition.actors,
      party: definition.actors.party.map(actor => {
        const miembro = obtenerMiembro(actor.id);
        // Saves antiguos y personajes importados sin ids estables conservan
        // la definición táctica del encuentro: nunca se adivina por el texto.
        if (!miembro?.inventarioRefs?.some(Boolean)) return actor;

        const seleccionDistancia = seleccionarArma(actor.id, "ranged", catalogo);
        const seleccionCC = seleccionarArma(actor.id, "melee", catalogo);
        const armaPrimaria = seleccionDistancia ? armaTactica(seleccionDistancia.definicion) : { ...SIN_ARMA_DISTANCIA };
        const armaCC = seleccionCC ? armaTactica(seleccionCC.definicion) : { ...SIN_ARMA_CC };
        const recursosGuardados = seleccionDistancia?.entrada.recursos?.municion;
        const esArmaBase = seleccionDistancia && claveDe(seleccionDistancia.entrada.referencia) === miembro.base?.arma?.equipoId?.split(":")[1];
        const municion = recursosGuardados ?? (esArmaBase && miembro.municion ? miembro.municion : (seleccionDistancia ? municionInicial(seleccionDistancia.definicion) : { cargador: 0, reserva: 0 }));

        return {
          ...actor,
          habilidadDisparo: seleccionDistancia?.definicion.habilidad ? (miembro.habilidades?.[seleccionDistancia.definicion.habilidad] ?? actor.habilidadDisparo) : actor.habilidadDisparo,
          habilidadCC: seleccionCC?.definicion.habilidad ? (miembro.habilidades?.[seleccionCC.definicion.habilidad] ?? actor.habilidadCC) : actor.habilidadCC,
          blindaje: blindajeActivo(actor.id, catalogo, actor),
          armaPrimaria,
          armaCC,
          municion: { primaria: { ...municion } },
          equipoInstancias: { primaria: seleccionDistancia?.entrada.instanciaId ?? null, cc: seleccionCC?.entrada.instanciaId ?? null }
        };
      })
    }
  };
}
