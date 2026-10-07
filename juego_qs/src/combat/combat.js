import { resolverTirada, localizacionPorUnidad } from "../rules/dice.js";
import { rutaDeManifiesto } from "../engine/moduleLoader.js";

// Cadencia de fuego (QS PARTE 1, líneas 162-170): dato puro en el archivo de
// armas del módulo activo (paths.weapons), no en código. Se cachea por
// módulo tras la primera carga.
const cadenciaCachePorModulo = new Map();
export async function cargarCadencia() {
  const ruta = rutaDeManifiesto("weapons");
  if (cadenciaCachePorModulo.has(ruta)) return cadenciaCachePorModulo.get(ruta);
  const res = await fetch(ruta);
  const data = await res.json();
  cadenciaCachePorModulo.set(ruta, data.cadencia);
  return data.cadencia;
}

// Pasos 3-7 del orden de resolución (penetración -> blindaje total/efectivo
// -> resta -> cadencia/crítico -> daño final), separados de la tirada en sí
// (paso 1-2). Se extrajo como función propia en la Fase 2 (docs/
// COMBAT_PHASE12_CODE_MAP.md) porque el motor tenía esta misma fórmula
// escrita DOS VECES: una vez aquí (usada por los enemigos) y otra copiada a
// mano dentro de engine/renderers/combat.js (usada por el jugador, que
// necesita reutilizar una tirada ya resuelta por mostrarTirada() en vez de
// tirar de nuevo -- ver rules/dice.js, comentario de interpretarTirada()).
// Ahora ambos caminos llaman a esta única función a través de
// combat/rulesEngine.js. No cambia ningún número: es la misma matemática
// que ya tenía resolverAtaque(), solo con nombre propio y reutilizable.
// exitosDefensa (Fase 4, CAP03:1003-1011, "División de habilidad en
// defensa"): "los éxitos de defensa restan los éxitos del ataque cuerpo a
// cuerpo recibido". El manual no fija el orden exacto respecto al Blindaje
// -- se aplica en la misma capa que los éxitos brutos de la tirada, ANTES de
// restar Blindaje, por ser la lectura más directa de "restan los éxitos del
// ataque" (el ataque en bruto, no el ataque ya filtrado por armadura).
// Documentado como elección del motor donde el canon no ordena las capas
// explícitamente -- ver docs/COMBAT_PHASE4_RESULT.md. Por defecto 0: no
// cambia ningún resultado existente (comportamiento preservado).
// localizacionForzada (Fase 5B, CAP03:860-866, Apuntar/Tiro Certero):
// "permite elegir la localización" -- misma fuente de verdad que
// localizacionPorUnidad(), nunca una segunda tabla. Si se pasa, sustituye
// el resultado de la tabla por unidad del d100; si no (por defecto,
// undefined), comportamiento exactamente igual que antes de Fase 5B.
export function resolverImpacto({ tirada, exito, exitos, esCritico = false, penetracion = 0, blindajeObjetivo = 0, coberturaObjetivo = 0, cadenciaBonus = 0, danioBase = 1, exitosDefensa = 0, localizacionForzada }) {
  if (!exito) {
    return { impacto: false, danioFinal: 0, localizacion: null };
  }

  const exitosTrasDefensa = Math.max(0, exitos - Math.max(0, exitosDefensa));
  const blindajeTotal = blindajeObjetivo + coberturaObjetivo;
  const blindajeEfectivo = Math.max(0, blindajeTotal - penetracion);
  let exitosNetos = exitosTrasDefensa - blindajeEfectivo;
  exitosNetos += cadenciaBonus; // se suma después del blindaje (regla de cadencia)

  const localizacion = localizacionForzada ?? localizacionPorUnidad(tirada);
  const impacto = exitosNetos > 0;
  const danioFinal = impacto ? danioBase * exitosNetos : 0;

  return { impacto, blindajeTotal, blindajeEfectivo, exitosNetos, localizacion, danioFinal };
}

// Orden de resolución de un ataque completo, fiel a QS PARTE 1 "Penetración y
// cobertura": 1) tirada de ataque 2) éxitos normales 3) (defensa activa:
// fuera de alcance de este helper) 4) penetración total 5) blindaje total/
// efectivo 6) resta blindaje 7) suma cadencia/crítico 8) daño final.
// rng inyectable (Fase 1/2) -- por defecto Math.random, sustituible en tests.
export function resolverAtaque({ habilidadBase, dificultad = 0, puntoEpicoGastado = false, penetracion = 0, blindajeObjetivo = 0, coberturaObjetivo = 0, cadenciaBonus = 0, danioBase = 1, exitosDefensa = 0, localizacionForzada, rng = Math.random }) {
  const tirada = resolverTirada({ habilidadBase, dificultad, puntoEpicoGastado, rng });
  const impacto = resolverImpacto({
    tirada: tirada.tirada, exito: tirada.exito, exitos: tirada.exitos, esCritico: tirada.esCritico,
    penetracion, blindajeObjetivo, coberturaObjetivo, cadenciaBonus, danioBase, exitosDefensa, localizacionForzada
  });
  return { ...tirada, ...impacto };
}

// Iniciativa: d100 + valor de Iniciativa, luego posiciones restando 100 mientras sea positivo.
export function tirarIniciativa(valorIniciativa) {
  const d100 = Math.floor(Math.random() * 100) + 1; // 1-100 para evitar posiciones vacías por un 0 puro
  const total = d100 + valorIniciativa;
  const posiciones = [];
  let resto = total;
  while (resto > 0) {
    posiciones.push(resto);
    resto -= 100;
  }
  return { d100, valorIniciativa, total, posiciones };
}

// Construye el orden de actuación de todos los combatientes a partir de sus posiciones de iniciativa.
export function ordenDeActuacion(combatientes) {
  const eventos = [];
  combatientes.forEach(c => {
    const { posiciones } = tirarIniciativa(c.iniciativa);
    posiciones.forEach(pos => eventos.push({ id: c.id, posicion: pos }));
  });
  eventos.sort((a, b) => b.posicion - a.posicion);
  return eventos;
}

// `modo` es una clave de weapons.json (paths.weapons del módulo) → cadencia (tiroATiro/rafaga/fuegoSostenido).
export function modificadorCadencia(modo, cadenciaData) {
  const m = cadenciaData?.[modo];
  return m ? m.bonusExitos : 0;
}

export function modificadorMovimientoEvasivo(exitos) {
  if (exitos <= 0) return 0;
  if (exitos === 1) return -10;
  return -20;
}
