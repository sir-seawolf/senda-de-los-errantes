// Raycaster mínimo (marcha por pasos + heurística de cara), estilo
// Wolfenstein/Doom clásico. Sin motor 3D real: solo proyección de columnas
// verticales por distancia. El origen de las texturas de cada módulo se
// documenta en el propio módulo (p.ej. docs/ATLAS_SPEC.md dentro de su
// carpeta docs/), no aquí — este archivo no sabe de qué módulo vienen.
//
// El renderer NO conoce rutas de PNG por nombre ni de qué módulo vienen:
// recibe un mapa `tipoDeCelda -> claveDeTextura` (del propio mapa JSON), la
// URL de un manifiesto de texturas (`rutaManifiestoTexturas`) y una función
// `resolverAsset` para convertir la ruta relativa del manifiesto en una URL
// real — quien lo instancia (src/engine/renderers/raycast.js) es quien sabe
// de qué módulo se trata; este archivo sigue siendo agnóstico. Sin ninguno
// de los dos, cae a la ruta literal del manifiesto (útil en tests, ver
// tests/raycaster.test.mjs) — nunca rompe el render (punto 25 del encargo:
// `asset || fallbackColor`).

import { config } from "../config.js";

const COLOR_FALLBACK = {
  1: "#4a4640", // hormigón
  2: "#5a3a2a", // ladrillo
  5: "#3a4a52"  // metal
};

const cacheManifiestosTexturas = new Map();
async function cargarManifiestoTexturas(rutaManifiesto) {
  if (cacheManifiestosTexturas.has(rutaManifiesto)) return cacheManifiestosTexturas.get(rutaManifiesto);
  let manifiesto;
  try {
    const res = await fetch(rutaManifiesto);
    manifiesto = await res.json();
  } catch (e) {
    manifiesto = { assets: {} };
  }
  cacheManifiestosTexturas.set(rutaManifiesto, manifiesto);
  return manifiesto;
}

const imagenesCache = new Map();
function cargarImagen(ruta) {
  if (imagenesCache.has(ruta)) return imagenesCache.get(ruta);
  const img = new Image();
  const promesa = new Promise(resolve => {
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // fallback silencioso a color plano
  });
  img.src = ruta;
  imagenesCache.set(ruta, promesa);
  return promesa;
}

export class Raycaster {
  constructor(canvas, mapa, {
    anchoInterno = 320, altoInterno = 200, fov = Math.PI / 3, wallTypes = null,
    rutaManifiestoTexturas = "src/data/assets/textures.json",
    resolverAsset = (ruta) => ruta,
    renderStyle = "classic"
  } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.renderStyle = renderStyle;
    this.ctx.imageSmoothingEnabled = renderStyle !== "classic";
    this.mapa = mapa;
    this.anchoInterno = anchoInterno;
    this.altoInterno = altoInterno;
    this.fov = fov;
    this.wallTypes = wallTypes || {};
    this.rutaManifiestoTexturas = rutaManifiestoTexturas;
    this.resolverAsset = resolverAsset;
    this.texturasPorTipo = {}; // tipoDeCelda -> HTMLImageElement | null
    this.skyline = []; // [{image, parallax, opacity}], lejos->cerca (ver setSkyline)
    canvas.width = anchoInterno;
    canvas.height = altoInterno;
    this._prepararTexturas();
  }

  // El renderer no carga sus propias imágenes de skyline (igual que no carga
  // sprites): el llamador (src/engine/renderers/raycast.js) las resuelve vía
  // rutaAsset()/cargarImagen() del módulo activo y las pasa ya cargadas.
  // `capas` en orden lejos->cerca; cada una: { image, parallax=1, opacity=1 }.
  // parallax=1 gira al mismo ritmo que la cámara (capa "far"); >1 se mueve
  // más deprisa, dando sensación de estar más cerca (capa "mid") — nunca al
  // revés, para no romper la ilusión de profundidad.
  setSkyline(capas) {
    this.skyline = capas || [];
    if (this._ultimoRender) this.render(...this._ultimoRender);
  }

  _dibujarCapaSkyline(capa, angulo) {
    const { ctx, anchoInterno, altoInterno, fov } = this;
    const img = capa.image;
    const parallax = capa.parallax ?? 1;
    const opacidad = capa.opacity ?? 1;
    // Proyección cilíndrica simple: la lámina entera representa una vuelta
    // completa (360°). Con el fov actual, una vuelta completa ocupa
    // anchoInterno * (2π/fov) píxeles de pantalla a la misma escala que se
    // ve el resto de la escena — así una capa con parallax=1 gira exactamente
    // al mismo ritmo angular que la cámara (ni patina ni se adelanta).
    // Nunca se escala en vertical por distancia: siempre altoInterno/2 de
    // alto, fondo "infinitamente lejano". Se dibujan 3 copias consecutivas
    // para que la costura de la imagen no deje un hueco al cruzarla.
    const horizonte = altoInterno / 2;
    const anchoVuelta = anchoInterno * (2 * Math.PI / fov);
    const u = (((angulo * parallax) / (2 * Math.PI)) % 1 + 1) % 1;
    const despX = -u * anchoVuelta;
    ctx.save();
    ctx.globalAlpha = opacidad;
    for (let copia = -1; copia <= 1; copia++) {
      ctx.drawImage(img, 0, 0, img.width, img.height, despX + copia * anchoVuelta, 0, anchoVuelta, horizonte);
    }
    ctx.restore();
  }

  async _prepararTexturas() {
    const manifiesto = await cargarManifiestoTexturas(this.rutaManifiestoTexturas);
    for (const [tipo, info] of Object.entries(this.wallTypes)) {
      const clave = info.atlasTile;
      const spec = manifiesto.assets?.[clave];
      if (!spec) continue; // sin entrada en el manifiesto -> se queda en color de refuerzo
      const rutaGenerada = this.resolverAsset(`assets/generated/${spec.outFile}`);
      cargarImagen(rutaGenerada).then(img => {
        if (!img) return;
        this.texturasPorTipo[tipo] = img;
        // Si una textura termina de cargar DESPUÉS del primer frame (carrera
        // habitual: el primer render() es síncrono, la carga de imagen no),
        // se repinta con los últimos parámetros conocidos para no depender
        // de que llegue un nuevo frame de movimiento.
        if (this._ultimoRender) this.render(...this._ultimoRender);
      });
    }
  }

  esMuro(x, y) {
    const fila = this.mapa[Math.floor(y)];
    if (!fila) return true;
    const celda = fila[Math.floor(x)];
    return celda === undefined || (celda !== 0 && !this._esCeldaEspecial(celda));
  }

  _esCeldaEspecial(celda) {
    // Celdas de meta (refugio/vehículo) no son muros a efectos de colisión,
    // pero tampoco tienen textura de pared — el llamador ya filtra antes.
    return false;
  }

  render(px, py, angulo) {
    this._ultimoRender = [px, py, angulo];
    const { ctx, anchoInterno, altoInterno, fov } = this;
    ctx.fillStyle = "#1a1a1a"; // techo (también fallback si no hay skyline)
    ctx.fillRect(0, 0, anchoInterno, altoInterno / 2);
    if (this.renderStyle === "thirdPerson") this._dibujarSueloTerceraPersona(angulo);
    else {
      ctx.fillStyle = "#26221f"; // suelo clásico / fallback
      ctx.fillRect(0, altoInterno / 2, anchoInterno, altoInterno / 2);
    }

    // Skyline/panorama por encima de las paredes (punto 9 del encargo): se
    // pinta ANTES de las columnas de pared, ocupando siempre la misma franja
    // [0, altoInterno/2] (el horizonte) — cada capa se desplaza horizontalmente
    // según el ángulo de cámara (proyección cilíndrica simple, envolviendo la
    // imagen), pero NUNCA se escala verticalmente por distancia: es un fondo
    // "infinitamente lejano", no geometría 3D. Las columnas de pared que se
    // dibujan después tapan la parte de abajo donde corresponda de forma
    // natural (más pared cerca = menos franja de cielo visible encima).
    if (this.skyline?.length) {
      for (const capa of this.skyline) {
        if (!capa.image) continue;
        this._dibujarCapaSkyline(capa, angulo);
      }
    }

    this.zBuffer = this.zBuffer || new Array(anchoInterno);

    for (let col = 0; col < anchoInterno; col++) {
      const rayAngulo = angulo - fov / 2 + (col / anchoInterno) * fov;
      const dx = Math.cos(rayAngulo);
      const dy = Math.sin(rayAngulo);

      let dist = 0;
      let tipoMuro = 1;
      let caraU = 0;
      const paso = 0.02;
      let x = px, y = py;
      let prevX = x, prevY = y;
      while (dist < 20) {
        prevX = x; prevY = y;
        x += dx * paso;
        y += dy * paso;
        dist += paso;
        if (this.esMuro(x, y)) {
          tipoMuro = this.mapa[Math.floor(y)]?.[Math.floor(x)] ?? 1;
          // Heurística de cara: si cruzamos un límite entero de columna (x),
          // es una cara vertical (este/oeste) y la U de textura es la parte
          // fraccional de Y; si cruzamos un límite de fila (y), cara
          // horizontal y la U es la parte fraccional de X.
          const cruzoColumna = Math.floor(x) !== Math.floor(prevX);
          caraU = cruzoColumna ? (y - Math.floor(y)) : (x - Math.floor(x));
          break;
        }
      }

      const distCorregida = dist * Math.cos(rayAngulo - angulo);
      this.zBuffer[col] = distCorregida;
      const alturaLinea = Math.min(altoInterno, altoInterno / (distCorregida + 0.0001));
      // "Fog por distancia": oscurecimiento barato en función de la distancia.
      // Desactivable en config.js sin tocar el motor — con fog apagado, solo
      // queda un sombreado mínimo para que los muros no se vean totalmente planos.
      const sombra = config.visualEffects.fog
        ? Math.max(0.2, 1 - distCorregida / 12)
        : Math.max(0.75, 1 - distCorregida / 40);
      const textura = this.texturasPorTipo[tipoMuro];
      const yTop = (altoInterno - alturaLinea) / 2;

      if (textura) {
        const colX = Math.floor(caraU * textura.width);
        ctx.globalAlpha = 1;
        ctx.drawImage(textura, colX, 0, 1, textura.height, col, yTop, 1, alturaLinea);
        if (sombra < 1) {
          ctx.fillStyle = `rgba(0,0,0,${1 - sombra})`;
          ctx.fillRect(col, yTop, 1, alturaLinea);
        }
      } else {
        const colorBase = COLOR_FALLBACK[tipoMuro] || COLOR_FALLBACK[1];
        ctx.fillStyle = sombrear(colorBase, sombra);
        ctx.fillRect(col, yTop, 1, alturaLinea);
      }
    }
  }

  _dibujarSueloTerceraPersona(angulo) {
    const { ctx, anchoInterno, altoInterno } = this;
    const horizonte = Math.floor(altoInterno / 2);
    const altoSuelo = altoInterno - horizonte;
    const deriva = Math.sin(angulo) * anchoInterno * 0.025;

    // Perspectiva procedural barata y suave: cada franja ensancha la calzada
    // desde el punto de fuga. No es una regla de mapa y no altera colisiones.
    for (let fila = 0; fila < altoSuelo; fila++) {
      const t = fila / altoSuelo;
      const luminosidad = Math.round(17 + t * 15);
      ctx.fillStyle = `rgb(${luminosidad},${luminosidad + 3},${luminosidad + 5})`;
      ctx.fillRect(0, horizonte + fila, anchoInterno, 1);

      const anchoCalzada = anchoInterno * (0.18 + t * 0.88);
      const izquierda = (anchoInterno - anchoCalzada) / 2 + deriva * (1 - t);
      ctx.fillStyle = `rgba(79,105,113,${0.025 + t * 0.045})`;
      ctx.fillRect(izquierda, horizonte + fila, anchoCalzada, 1);
    }

    // Reflejos y marcas discontinuas convergen en el horizonte. La variación
    // de fase con el ángulo evita que parezcan una cuadrícula estática.
    const fase = Math.abs(Math.sin(angulo * 1.7)) * 18;
    for (let i = 0; i < 7; i++) {
      const t = (i + 1) / 7;
      const y = horizonte + t * t * altoSuelo + fase * t;
      const ancho = 1 + t * 5;
      const alto = 2 + t * 11;
      ctx.fillStyle = i % 2 ? "rgba(101,183,199,.2)" : "rgba(215,154,53,.16)";
      ctx.fillRect(anchoInterno / 2 - ancho / 2 + deriva * (1 - t), y, ancho, alto);
    }
  }

  // Sprites billboard: siempre de cara a la cámara, escalados por distancia,
  // ocultos tras paredes más cercanas (comparando contra el zBuffer que
  // `render()` ya dejó relleno columna a columna). Nunca estira ancho y
  // alto por separado — `anchoSprite` sale siempre de `alturaSprite *
  // aspectoOriginal`, así que la proporción real del PNG jamás se deforma
  // (punto 5 del encargo 0.2 visual).
  //
  // `sprites` es una lista de:
  //   { x, y, image,
  //     anchor: "ground" | "center" (por defecto "center", compatibilidad),
  //     worldHeight,   // ground: altura real en "unidades de pared" (1 =
  //                    // una pared llena de suelo a techo); ej. persona
  //                    // ~0.55-0.6, coche ~0.35-0.4, farola >1
  //     escala }       // center (legado): multiplicador simple, sin anclaje
  //
  // "ground": la base del sprite coincide siempre con la línea de suelo
  // aparente a esa distancia (la misma que usa `render()` para las paredes:
  // altoInterno/dist), así nunca flota ni se hunde al cambiar de distancia.
  // "center" sigue existiendo tal cual para no romper llamadas ya probadas
  // (ver tests/raycaster.test.mjs) — nuevo código debería usar "ground" para
  // cualquier cosa apoyada en el suelo (vehículos, personajes, farolas...).
  // Se ordenan de más lejos a más cerca (pintor).
  renderSprites(px, py, angulo, sprites) {
    const { ctx, anchoInterno, altoInterno, fov } = this;
    if (!this.zBuffer) return;

    const conDistancia = sprites
      .filter(s => s.image)
      .map(s => {
        const ddx = s.x - px, ddy = s.y - py;
        const dist = Math.hypot(ddx, ddy);
        let anguloRel = Math.atan2(ddy, ddx) - angulo;
        while (anguloRel > Math.PI) anguloRel -= 2 * Math.PI;
        while (anguloRel < -Math.PI) anguloRel += 2 * Math.PI;
        return { ...s, dist, anguloRel };
      })
      .filter(s => s.dist > 0.15 && Math.abs(s.anguloRel) < fov * 0.85)
      .sort((a, b) => b.dist - a.dist);

    for (const s of conDistancia) {
      const aspecto = s.image.width / s.image.height;
      const anchor = s.anchor ?? "center";
      let alturaSprite, yTop;

      if (anchor === "ground") {
        // Misma relación distancia->altura que usan las paredes
        // (altoInterno/dist = una "unidad de pared" completa a esa
        // distancia), multiplicada por la altura real del objeto en esas
        // unidades. Sin el tope de 1.6x de las paredes: un sprite ground sí
        // debe poder llenar la pantalla si está pegado a la cámara.
        const worldHeight = s.worldHeight ?? 0.55;
        alturaSprite = (altoInterno / s.dist) * worldHeight;
        const alturaParedLlena = altoInterno / s.dist;
        const sueloAparente = altoInterno / 2 + alturaParedLlena / 2;
        yTop = sueloAparente - alturaSprite;
      } else {
        const escala = s.escala ?? 1;
        alturaSprite = Math.min(altoInterno * 1.6, (altoInterno / s.dist) * escala);
        yTop = (altoInterno - alturaSprite) / 2;
      }

      const anchoSprite = alturaSprite * aspecto;
      const centroX = (anchoInterno / 2) * (1 + s.anguloRel / (fov / 2));
      const xIzq = centroX - anchoSprite / 2;

      const colIni = Math.max(0, Math.floor(xIzq));
      const colFin = Math.min(anchoInterno, Math.ceil(xIzq + anchoSprite));
      if (colFin <= colIni) continue;

      const sombra = Math.max(0.25, 1 - s.dist / 14);
      ctx.save();
      ctx.filter = sombra < 1 ? `brightness(${sombra})` : "none";
      // Opacidad propia del sprite (además del oscurecimiento por
      // distancia) — pensada para decals planos tipo "sombra en el suelo"
      // (worldHeight muy bajo + opacity < 1), que deben leerse como una
      // mancha tenue, no como un objeto opaco de pie (punto 6/12 del
      // encargo 0.2 visual, pasada 2).
      if (s.opacity !== undefined) ctx.globalAlpha = s.opacity;
      for (let col = colIni; col < colFin; col++) {
        if (s.dist >= (this.zBuffer[col] ?? Infinity)) continue; // tras una pared: no se dibuja
        const uCol = (col - xIzq) / anchoSprite;
        const srcX = Math.max(0, Math.min(s.image.width - 1, Math.floor(uCol * s.image.width)));
        ctx.drawImage(s.image, srcX, 0, 1, s.image.height, col, yTop, 1, alturaSprite);
      }
      ctx.restore();
    }
  }
}

function sombrear(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16) * factor;
  const g = parseInt(hex.slice(3, 5), 16) * factor;
  const b = parseInt(hex.slice(5, 7), 16) * factor;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
