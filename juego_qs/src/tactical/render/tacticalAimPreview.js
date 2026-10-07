import { interpretarTirada } from "../../rules/dice.js";
import { resolverImpacto } from "../../combat/combat.js";
import { valorCobertura } from "../../rules/cover.js";
import { claveQsDeNivelSpatial } from "../bridge/coverTranslation.js";
import { armaActivaDe } from "../bridge/qsDataAdapter.js";

// Vista previa derivada de las mismas funciones que resuelven el ataque.
// Enumera los cien resultados del d100 sin tirar ni alterar la sesión.
export function calcularVistaPreviaDisparo({ atacante, objetivo, spatialContext, cadenciaBonus = 0 }) {
  const arma = armaActivaDe(atacante);
  const coberturaObjetivo = spatialContext
    ? valorCobertura(claveQsDeNivelSpatial(spatialContext.level))
    : 0;
  let impactos = 0;
  for (let tirada = 0; tirada < 100; tirada++) {
    const resultadoTirada = interpretarTirada({ tirada, habilidadEfectiva: atacante.habilidadDisparo });
    const resultadoImpacto = resolverImpacto({
      ...resultadoTirada,
      penetracion: arma.penetracion ?? 0,
      blindajeObjetivo: objetivo.blindaje ?? 0,
      coberturaObjetivo,
      cadenciaBonus,
      danioBase: arma.danioBase
    });
    if (resultadoImpacto.impacto) impactos++;
  }
  return impactos;
}
