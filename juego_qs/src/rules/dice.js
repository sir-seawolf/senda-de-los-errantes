// Motor de tiradas d100 — reglas generales de La Senda de los Errantes,
// comunes a cualquier módulo (verificadas por primera vez contra la PARTE 1
// de un Quick Starter concreto). Referencia y trazabilidad: docs/QS_RULE_MAP.md

// rng inyectable (Fase 1/2, docs/COMBAT_RULES_INTERFACE.md): por defecto
// Math.random, sustituible por un generador con semilla en tests para
// tiradas deterministas -- sin introducir ningun framework de random, un
// parametro con valor por defecto basta. Compatible con todo el codigo
// existente (nadie pasaba un segundo argumento antes).
export function rollD100(rng = Math.random) {
  return Math.floor(rng() * 100); // 0-99 (00 se representa como 0)
}

// Única fuente de verdad para interpretar un d100 YA TIRADO contra una
// Habilidad efectiva: no genera ningún número aleatorio — es pura función
// de (tirada, habilidadEfectiva) -> veredicto. Existe separada de
// resolverTirada() para que gastar un Punto Épico DESPUÉS de ver el
// resultado (src/ui/rollDisplay.js) pueda re-evaluar el mismo número ya
// salido con la nueva Habilidad efectiva, sin volver a tirar el dado (que
// sería literalmente otra tirada, no "el mismo resultado mejorado") y sin
// duplicar esta lógica en ningún otro sitio. Ver docs/QS_RULE_MAP.md.
export function interpretarTirada({ tirada, habilidadEfectiva }) {
  const esPifia = tirada === 97 || tirada === 98 || tirada === 99;
  const esCriticoPorNumero = tirada === 0 || tirada === 1 || tirada === 2;

  let exito = false;
  let exitos = 0;
  let esCritico = false;

  if (esPifia) {
    exito = false;
    if (tirada > habilidadEfectiva) {
      const diferencia = tirada - habilidadEfectiva;
      exitos = -Math.ceil(diferencia / 10);
    } else {
      exitos = tirada === 99 ? -3 : tirada === 98 ? -2 : -1;
    }
  } else if (tirada <= habilidadEfectiva) {
    exito = true;
    const diferencia = habilidadEfectiva - tirada;
    exitos = Math.floor(diferencia / 10) + 1;
    if (esCriticoPorNumero) {
      esCritico = true;
      exitos += tirada === 0 ? 3 : tirada === 1 ? 2 : 1;
    }
  } else {
    exito = false;
    const diferencia = tirada - habilidadEfectiva;
    exitos = -Math.ceil(diferencia / 10);
  }

  return {
    habilidadEfectiva,
    tirada,
    tiradaTexto: String(tirada).padStart(2, "0"),
    exito,
    exitos,
    esCritico,
    esPifia,
    esCabezaAutomatica: tirada === 0 && esCritico
  };
}

// habilidadBase: categoria + habilidad concreta ya sumadas (tal como vienen en characters.json)
// dificultad: uno de +20,+10,0,-10,-20
// puntoEpicoGastado: boolean, aplica +50 tras conocer la dificultad
//
// Envoltorio fino sobre interpretarTirada(): tira el dado UNA vez y lo
// interpreta contra la Habilidad efectiva ya conocida en el momento de la
// llamada. La mayoría de tiradas del motor (enemigos, escenas sin selector
// de Punto Épico post-resultado) solo necesitan esto. rollDisplay.js, que sí
// permite gastar el PE después de ver el resultado, llama a rollD100() +
// interpretarTirada() por separado para poder re-interpretar la MISMA
// tirada — ver el comentario de interpretarTirada().
export function resolverTirada({ habilidadBase, dificultad = 0, puntoEpicoGastado = false, rng = Math.random }) {
  const habilidadEfectiva = habilidadBase + dificultad + (puntoEpicoGastado ? 50 : 0);
  const tirada = rollD100(rng);
  const interpretacion = interpretarTirada({ tirada, habilidadEfectiva });
  return { habilidadBase, dificultad, puntoEpicoGastado, ...interpretacion };
}

export function localizacionPorUnidad(tirada) {
  const unidad = tirada % 10;
  const tabla = {
    0: "Cabeza", 9: "Ojos", 8: "Pecho", 7: "Oídos", 6: "Lengua/mandíbula",
    5: "Espalda", 4: "Brazo derecho", 3: "Brazo izquierdo", 2: "Pierna derecha", 1: "Pierna izquierda"
  };
  return tabla[unidad];
}

export function esZonaVital(localizacion) {
  return localizacion === "Cabeza" || localizacion === "Pecho" || localizacion === "Espalda" || localizacion === "Ojos" || localizacion === "Oídos" || localizacion === "Lengua/mandíbula";
}
