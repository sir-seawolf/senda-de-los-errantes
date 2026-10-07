// Ayudar — tiradas colaborativas.
// SOURCE_OVERRIDE: MANUAL_CANON. El QS no cubre cooperación de grupo en su
// chuleta reducida. Regla real: CAP03_Mecanicas_Sistema_v2_DEFINITIVO.md,
// sección "Tiradas colaborativas" (líneas 213-223):
//   "Cuando varios personajes trabajan juntos, todos tiran. Los éxitos se
//   suman. Los fallos también." + ejemplo: "A: 3 éxitos / B: 1 éxito / C: −1.
//   Total: 3 éxitos. Sin C habrían sido 4."
// No se inventa ningún bonificador fijo (+10/+20): el "ayudar" real es sumar
// los éxitos (o fallos, que restan) de cada tirada independiente.
export function agregarResultadosColaborativos(resultados) {
  const exitosTotal = resultados.reduce((sum, r) => sum + r.exitos, 0);
  return {
    resultados,
    exitosTotal,
    exito: exitosTotal > 0
  };
}
