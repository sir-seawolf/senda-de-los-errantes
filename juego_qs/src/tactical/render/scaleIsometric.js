// Proyección isométrica -- Production Integration Phase 6C (spike de
// cámara oblicua, docs/TACTICAL_PRODUCTION_PHASE6C_SPIKE.md).
//
// scale.js (crearEscala) expone `px(metros)`/`metros(pixeles)` como
// funciones ESCALARES POR EJE porque la proyección cenital es lineal e
// independiente en X e Y. La proyección isométrica NO puede
// descomponerse así -- la posición en pantalla de un punto depende de
// AMBOS ejes lógicos a la vez (x-y para la horizontal, x+y para la
// vertical). Por eso este módulo NO reexpone `px`/`metros` con la
// misma firma escalar; expone el equivalente real para 2D:
// `proyectar(xMetros, yMetros) -> {x:px, y:px}` y su inversa
// `invertir(xPx, yPx) -> {x:metros, y:metros}` -- MISMO PAPEL que
// scale.js (convertir entre el grid lógico en metros y píxeles de
// pantalla, y su inversa exacta para el hit-testing del puntero) pero
// con la forma que la geometría isométrica exige. `escalaBase` expone
// además la escala lineal de scale.js sin cambios, para lo que sigue
// siendo un tamaño puro (radio de un sprite, alto de una etiqueta) y
// no una posición sujeta a la proyección.
//
// Convención 2:1 (dimétrica), la habitual en juegos tácticos de
// rejilla -- un tile cuadrado en el grid lógico se dibuja como un
// rombo dos veces más ancho que alto. Sin rotación libre en este
// primer spike (encargo 6C, "sin rotación libre en esta primera
// versión") -- ángulo fijo.
import { crearEscala } from "./scale.js";

/**
 * @param {number} metersToPx - misma unidad que declara el encuentro
 *   (battlefield.metersToPx); aquí se interpreta como la anchura en
 *   píxeles de un metro proyectado sobre el eje horizontal de pantalla.
 * @param {{anchoMundoMetros:number, altoMundoMetros:number}} bounds -
 *   dimensiones lógicas del campo de batalla (session.battlefieldMeters)
 *   -- necesarias para calcular el desplazamiento de origen: en
 *   isométrico, `x - y` puede ser negativo, así que se desplaza el
 *   origen para que todo el mundo caiga en coordenadas de pantalla
 *   positivas (mismo criterio que aplicaría cualquier cámara real).
 */
export function crearEscalaIsometrica(metersToPx, { anchoMundoMetros, altoMundoMetros }) {
  // CORRECCIÓN (verificación Playwright de 6C): halfW=metersToPx (no
  // metersToPx/2) para que 1 metro produzca el mismo orden de magnitud
  // de píxeles que el renderer cenital (metersToPx px/metro lineal) --
  // con la mitad, el mundo isométrico salía la mitad de grande de lo
  // esperado y el HUD/panel heredado (posicionado en coordenadas de
  // pantalla fijas basadas en `mundoPx`, código compartido con el
  // cenital) quedaba mal encajado. halfH=metersToPx/2 mantiene la
  // proporción 2:1 (alto de tile = mitad del ancho).
  const halfW = metersToPx;
  const halfH = metersToPx / 2;
  const offsetX = altoMundoMetros * halfW; // desplaza el origen para evitar screenX negativo

  function proyectar(xMetros, yMetros) {
    return {
      x: (xMetros - yMetros) * halfW + offsetX,
      y: (xMetros + yMetros) * halfH
    };
  }

  function invertir(xPx, yPx) {
    const xAjustado = xPx - offsetX;
    return {
      x: (xAjustado / halfW + yPx / halfH) / 2,
      y: (yPx / halfH - xAjustado / halfW) / 2
    };
  }

  const mundoPx = {
    width: (anchoWorldExtent(anchoMundoMetros, altoMundoMetros)) * halfW,
    height: (anchoMundoMetros + altoMundoMetros) * halfH
  };

  return { metersToPx, halfW, halfH, offsetX, proyectar, invertir, mundoPx, escalaBase: crearEscala(metersToPx) };
}

function anchoWorldExtent(anchoMundoMetros, altoMundoMetros) {
  // screenX recorre desde -alto*halfW (x=0,y=alto) hasta +ancho*halfW
  // (x=ancho,y=0) -- el ancho total en píxeles es la suma de ambos extremos.
  return anchoMundoMetros + altoMundoMetros;
}
