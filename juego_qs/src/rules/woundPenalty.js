// Penalizador de habilidad por nivel de herida — QS línea 230 / CAP03 (Vida y
// heridas graves): "Herido (−10 a todas las habilidades), Tullido (−20 a
// todas las habilidades)". Único punto central de cálculo: cualquier tirada
// que pase por src/ui/rollDisplay.js aplica esto automáticamente — ninguna
// escena tiene que acordarse de restarlo por su cuenta.
export function penalizadorPorNivel(nivel) {
  if (nivel === "tullido") return -20;
  if (nivel === "herido") return -10;
  return 0;
}
