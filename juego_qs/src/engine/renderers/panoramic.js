// Renderer para escenas panorámicas ("Localización C", ver
// docs/CONTRATO_VISUAL_PREDATOR.md y docs/CALIBRACION_GEOMETRICA_CALLEJON_
// PREDATOR.md). Un único sistema de coordenadas de mundo: fondo, sombras,
// objetos, avatar, oclusión, luces, hotspots y la capa de calibración son
// TODOS hijos directos de #mundo y reciben la MISMA transformación de
// escala+cámara (panoramica-escala/transform en pintarAvatarYCamara). Nadie
// calcula su posición en píxeles de viewport: todo se declara en píxeles del
// fondo maestro (origen arriba-izquierda), y `#mundo` se escala una sola vez
// para ajustarse al viewport real antes de desplazar la cámara.
//
// Autoridad geométrica de cada objeto: `anchor` (bottom-center, el punto de
// contacto con el suelo) + `width`/`height` (tamaño real mostrado). La caja
// (x,y,width,height) se DERIVA de eso (cajaDeObjeto) -- nunca se declara por
// separado, para que no puedan desincronizarse.
//
// Hotspots: derivan su caja de la del objeto que representan (`objectRef` +
// margen), nunca de coordenadas propias -- así el área interactiva coincide
// espacialmente con el hueco por construcción, no por copiar números a mano.
//
// Recorrido lateral: el personaje NO cambia de escala con X (ver corrección
// de contrato, paquete visual 2026-08-22) -- la reducción por profundidad
// queda reservada para una futura senda que entre de verdad hacia el fondo.
import { cargarEscena, buscarInteraccion, ejecutarInteraccion } from "../sceneEngine.js";
import { rutaAsset, rutaModulo, moduloActivo } from "../moduleLoader.js";
import { state, tieneFlag, cambiarEscena } from "../../gameState.js";
import { config } from "../../config.js";
import { montarCapaCalibracion } from "./panoramicCalibration.js";
import { loadTiledPanoramicMap, mergeTiledPanoramicScene } from "../tiled/tiledPanoramicAdapter.js";
import { normalizeSceneLayers } from "../sceneLayers.js";
import { mountDomSceneLayers } from "./domSceneLayers.js";

function rutaRecursoPanoramico(escena, archivo) {
  if (!archivo) return archivo;
  if (/^([a-z]+:)?\/\//i.test(archivo) || archivo.startsWith("/")) return rutaAsset(archivo, moduloActivo());
  return rutaAsset(`${escena.assetBase || ""}${archivo}`, moduloActivo());
}

export function clamp(v, lo, hi) {
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

// Cámara: sigue al avatar solo cuando sale de la zona muerta central,
// nunca antes; se abrazadera para no mostrar fuera del fondo maestro.
export function calcularCamaraX({ avatarX, camaraXPrev, viewportWidth, masterWidth, deadzonePct = 30, minX = 0, maxX }) {
  const maxCamara = maxX !== undefined ? maxX : Math.max(minX, masterWidth - viewportWidth);
  const anchoZonaMuerta = viewportWidth * (deadzonePct / 100);
  const bordeIzq = camaraXPrev + (viewportWidth - anchoZonaMuerta) / 2;
  const bordeDer = camaraXPrev + (viewportWidth + anchoZonaMuerta) / 2;
  let camaraX = camaraXPrev;
  if (avatarX < bordeIzq) camaraX = avatarX - (viewportWidth - anchoZonaMuerta) / 2;
  else if (avatarX > bordeDer) camaraX = avatarX - (viewportWidth + anchoZonaMuerta) / 2;
  return clamp(camaraX, minX, maxCamara);
}

export function dentroDeProximidad(avatarX, objetivoX, radio) {
  return Math.abs(avatarX - objetivoX) <= radio;
}

// Proximidad por caja (hotspots): el avatar solo se mueve en X sobre la
// banda caminable, así que basta comparar su X contra el rango horizontal
// de la caja, ampliado por un margen de alcance.
export function dentroDeCajaX(avatarX, caja, margen = 0) {
  return avatarX >= caja.x - margen && avatarX <= caja.x + caja.width + margen;
}

// Traducción única de clic/toque en viewport a coordenada horizontal de
// mundo. Botones, teclado, ratón y táctil terminan llamando a moverAvatarA().
export function worldXDesdeCliente({ clientX, viewportLeft, escala, camaraX }) {
  if (!(escala > 0)) throw new Error("La escala panorámica debe ser mayor que cero");
  return camaraX + (clientX - viewportLeft) / escala;
}

// Estado activo de un objeto: stateFlag presente -> el estado que declare
// (por defecto el segundo si el flag es "true"/está puesto); si no hay
// stateFlag o no está puesto, defaultState (o el primero declarado).
export function resolverEstadoObjeto(objeto) {
  const estados = Object.keys(objeto.states || {});
  if (!estados.length) return null;
  if (objeto.stateFlag && objeto.activeState && tieneFlag(objeto.stateFlag)) {
    return objeto.activeState;
  }
  return objeto.defaultState && estados.includes(objeto.defaultState) ? objeto.defaultState : estados[0];
}

// Caja derivada del anclaje bottom-center + tamaño mostrado en el estado
// actual (que puede variar de anchura/altura por estado, p.ej. una verja
// abierta más ancha que cerrada -- el anclaje NUNCA se mueve, la caja sí
// puede cambiar de tamaño a su alrededor). Única función que calcula esto
// -- objetos, sombras, oclusión, hotspots y la capa de calibración leen
// todos la MISMA caja, nunca la recalculan cada uno a su manera.
// `anchorOffsetX` (opcional, 0 por defecto) corrige un lienzo cuyo
// contenido opaco real NO está centrado en su propio ancho -- p.ej. la
// farola: su poste queda descentrado dentro del PNG porque el brazo
// sobresale hacia un lado, así que el centro geométrico del lienzo no
// coincide con el punto de apoyo real en el suelo. Medido una vez sobre el
// archivo real (bbox de alfa), nunca a ojo sobre el mundo.
export function cajaDeObjeto(objeto, estadoActivo) {
  const ancho = (objeto.widthByState && objeto.widthByState[estadoActivo]) ?? objeto.width;
  const alto = (objeto.heightByState && objeto.heightByState[estadoActivo]) ?? objeto.height;
  const offsetX = objeto.anchorOffsetX || 0;
  return { x: objeto.anchor.x - ancho / 2 + offsetX, y: objeto.anchor.y - alto, width: ancho, height: alto };
}

// Caja de un hotspot: la de su objeto de referencia, ampliada por un margen
// de alcance -- nunca coordenadas propias independientes (punto 8 del
// encargo: "el hotspot... sí debe coincidir espacialmente con el hueco").
export function cajaDeHotspot(hs, objetos) {
  const objeto = objetos.find(o => o.id === hs.objectRef);
  if (!objeto) return null;
  const estadoActivo = resolverEstadoObjeto(objeto);
  const caja = cajaDeObjeto(objeto, estadoActivo);
  const mx = hs.marginX ?? 40;
  const my = hs.marginY ?? 20;
  return { x: caja.x - mx, y: caja.y - my, width: caja.width + mx * 2, height: caja.height + my * 2 };
}

export async function montarPanoramica(container, escenaId) {
  let escena = await cargarEscena(escenaId);

  if (escena.tiledMap) {
    const tiledUrl = rutaModulo(escena.tiledMap, moduloActivo());
    const tiled = await loadTiledPanoramicMap(tiledUrl);
    escena = mergeTiledPanoramicScene(escena, tiled, { spawnId: state.entrySpawnId });
  }

  const presentation = normalizeSceneLayers(escena);
  if (!(presentation.width > 0) || !(presentation.height > 0) || !presentation.layers.length) {
    throw new Error(`Escena panorámica "${escenaId}" sin composición visual dimensionada`);
  }
  if (!escena.player?.sprite) {
    throw new Error(`Escena panorámica "${escenaId}" sin player.sprite declarado (ver Entrega 4 del contrato -- provisional real, nunca un marcador geométrico)`);
  }

  const wrap = document.createElement("div");
  wrap.className = "panoramica";
  wrap.innerHTML = `
    <div class="panoramica-viewport" id="viewport">
      <div class="panoramica-escala" id="escala">
        <div class="panoramica-mundo" id="mundo">
          <div class="panoramica-capas" id="capas-presentacion"></div>
          <div class="panoramica-capa-sombras" id="capa-sombras"></div>
          <div class="panoramica-capa-objetos" id="capa-objetos"></div>
          <div class="panoramica-avatar-grupo" id="avatar-grupo">
            <div class="panoramica-avatar-sombra"></div>
            <img class="panoramica-avatar" id="avatar" draggable="false" alt="Personaje jugador" />
          </div>
          <div class="panoramica-capa-oclusion" id="capa-oclusion"></div>
          <div class="panoramica-capa-luces" id="capa-luces"></div>
          <div class="panoramica-hotspots" id="hotspots"></div>
        </div>
      </div>
    </div>
    <div class="panoramica-controles-movimiento" id="controles-movimiento">
      <button class="panoramica-mov-btn" id="mov-izq" aria-label="Moverse a la izquierda">◀</button>
      <button class="panoramica-efectos-toggle" id="toggle-efectos" aria-pressed="${config.visualEffects.panoramicLighting}">
        ${config.visualEffects.panoramicLighting ? "EFECTOS: ON" : "EFECTOS: OFF"}
      </button>
      <button class="panoramica-mov-btn" id="mov-der" aria-label="Moverse a la derecha">▶</button>
    </div>
    <div class="panoramica-texto" id="texto"><em>${escena.introText || ""}</em></div>
  `;
  container.appendChild(wrap);

  if (config.debug.showHotspotAreas) wrap.classList.add("debug-hotspots");
  if (config.debug.showPanoramicDevNote && escena.devNote) {
    const nota = document.createElement("div");
    nota.className = "panoramica-dev-nota";
    nota.textContent = escena.devNote;
    wrap.appendChild(nota); // fuera del flujo (position:fixed en CSS): nunca resta alto al escenario
  }

  const viewportEl = wrap.querySelector("#viewport");
  const escalaEl = wrap.querySelector("#escala");
  const mundoEl = wrap.querySelector("#mundo");
  const capasPresentacionEl = wrap.querySelector("#capas-presentacion");
  const capaSombrasEl = wrap.querySelector("#capa-sombras");
  const capaObjetosEl = wrap.querySelector("#capa-objetos");
  const avatarGrupoEl = wrap.querySelector("#avatar-grupo");
  const avatarEl = wrap.querySelector("#avatar");
  const capaOclusionEl = wrap.querySelector("#capa-oclusion");
  const capaLucesEl = wrap.querySelector("#capa-luces");
  const hotspotsEl = wrap.querySelector("#hotspots");
  const textoEl = wrap.querySelector("#texto");
  const toggleEfectosEl = wrap.querySelector("#toggle-efectos");

  function onTexto(t) { textoEl.innerHTML = `<em>${t}</em>`; }

  const master = { width: presentation.width, height: presentation.height };
  mundoEl.style.width = `${master.width}px`;
  mundoEl.style.height = `${master.height}px`;
  const capasDom = mountDomSceneLayers(capasPresentacionEl, presentation, {
    resolveResource: archivo => rutaRecursoPanoramico(escena, archivo)
  });

  // Capa de calibración (config.debug.showPanoramicCalibration, "false" por
  // defecto -- solo desarrollo): vive DENTRO de #mundo, así que hereda la
  // misma transformación que todo lo demás. Reutilizable para cualquier
  // localización panorámica futura -- ver panoramicCalibration.js.
  if (config.debug.showPanoramicCalibration) montarCapaCalibracion(mundoEl, escena);

  const walkable = escena.walkable || { y: master.height * 0.87, xMin: 0, xMax: master.width };
  const estado = { avatarX: escena.player?.startX ?? walkable.xMin, camaraX: 0, mirandoIzquierda: false };

  // El módulo puede declarar una variante por personaje; el motor usa el
  // sprite común como fallback y conserva el mismo contrato geométrico.
  const varianteAvatar = escena.player.variants?.[state.playerCharacterId] ?? escena.player;
  const avatarAncho = varianteAvatar.spriteWidth || escena.player.spriteWidth || 90;
  const avatarAlto = varianteAvatar.spriteHeight || escena.player.spriteHeight || 140;
  avatarEl.style.width = `${avatarAncho}px`;
  avatarEl.style.height = `${avatarAlto}px`;
  const fotogramasMarcha = (varianteAvatar.walkFrames?.length ? varianteAvatar.walkFrames : [varianteAvatar.sprite ?? escena.player.sprite])
    .map(archivo => rutaRecursoPanoramico(escena, archivo));
  avatarEl.src = fotogramasMarcha[0];

  // ---------- Sombras de contacto (CSS, sin tocar ningún PNG original) ----------
  function crearSombra(anchoObjeto) {
    const sombra = document.createElement("div");
    sombra.className = "panoramica-sombra-contacto";
    sombra.style.width = `${anchoObjeto * 0.8}px`;
    return sombra;
  }
  const sombrasObjetoEl = new Map();
  (escena.objects || []).forEach(obj => {
    if (!obj.contactShadow) return;
    const sombra = crearSombra(obj.width);
    capaSombrasEl.appendChild(sombra);
    sombrasObjetoEl.set(obj.id, sombra);
  });

  // ---------- Objetos con estado (puerta, farola, valla, contenedor) ----------
  const objetosEl = new Map();
  (escena.objects || []).forEach(obj => {
    const el = document.createElement("img");
    el.className = "panoramica-objeto";
    el.dataset.objetoId = obj.id;
    el.draggable = false;
    if (obj.flipX) el.style.transform = "scaleX(-1)";
    capaObjetosEl.appendChild(el);
    objetosEl.set(obj.id, el);
  });

  function pintarObjetos() {
    (escena.objects || []).forEach(obj => {
      const estadoActivo = resolverEstadoObjeto(obj);
      const archivo = obj.states[estadoActivo];
      const el = objetosEl.get(obj.id);
      if (!el || !archivo) return;
      const caja = cajaDeObjeto(obj, estadoActivo);
      el.src = rutaRecursoPanoramico(escena, archivo);
      el.style.width = `${caja.width}px`;
      el.style.height = `${caja.height}px`;
      el.style.left = `${caja.x}px`;
      el.style.top = `${caja.y}px`;

      // El contenedor es el único objeto marcado `occludes`: vive en la capa
      // de oclusión (por delante del avatar), el resto en la capa trasera.
      const capaDestino = obj.occludes ? capaOclusionEl : capaObjetosEl;
      if (el.parentElement !== capaDestino) capaDestino.appendChild(el);

      const sombra = sombrasObjetoEl.get(obj.id);
      if (sombra) {
        sombra.style.left = `${obj.anchor.x - (caja.width * 0.8) / 2}px`;
        sombra.style.top = `${obj.anchor.y - 10}px`;
      }
    });
  }

  // ---------- Luces agrupadas con su objeto (farola: halo + charco de suelo) ----------
  // Nunca se posicionan por su cuenta -- su centro es siempre
  // objeto.anchor + centerOffset (punto 6 del encargo: "forman un solo
  // grupo. No pueden posicionarse independientemente").
  const lucesEl = [];
  (escena.lighting || []).forEach(luz => {
    const objetoAncla = (escena.objects || []).find(o => o.id === luz.attachTo);
    if (!objetoAncla) return;
    const el = document.createElement("img");
    el.className = "panoramica-luz";
    el.draggable = false;
    el.src = rutaRecursoPanoramico(escena, luz.file);
    el.style.width = `${luz.width}px`;
    el.style.height = `${luz.height}px`;
    const cx = objetoAncla.anchor.x + (luz.centerOffset?.x || 0);
    const cy = objetoAncla.anchor.y + (luz.centerOffset?.y || 0);
    el.style.left = `${cx - luz.width / 2}px`;
    el.style.top = `${cy - luz.height / 2}px`;
    capaLucesEl.appendChild(el);
    lucesEl.push({ el, luz, objetoAncla });
  });

  function pintarLuces() {
    lucesEl.forEach(({ el, luz, objetoAncla }) => {
      const estadoObjeto = resolverEstadoObjeto(objetoAncla);
      const requiereEstado = luz.requiresObjectState?.[objetoAncla.id];
      const visiblePorEstado = !requiereEstado || requiereEstado === estadoObjeto;
      const visiblePorAjuste = !luz.toggleableEffect || config.visualEffects.panoramicLighting;
      el.style.display = (visiblePorEstado && visiblePorAjuste) ? "" : "none";
    });
  }

  toggleEfectosEl.addEventListener("click", () => {
    config.visualEffects.panoramicLighting = !config.visualEffects.panoramicLighting;
    toggleEfectosEl.setAttribute("aria-pressed", String(config.visualEffects.panoramicLighting));
    toggleEfectosEl.textContent = config.visualEffects.panoramicLighting ? "EFECTOS: ON" : "EFECTOS: OFF";
    pintarLuces();
  });

  // ---------- Hotspots independientes del dibujo, pero coincidentes con el hueco ----------
  // Sin círculo/rótulo permanentes: el área interactiva es la caja del
  // objeto de referencia (cajaDeHotspot), ampliada por un margen de
  // alcance -- nunca una coordenada propia. La indicación visual solo
  // aparece por proximidad real del avatar o por foco de teclado, y se
  // ancla ENCIMA de la caja (nunca a la altura del avatar) para no taparlo.
  let menuContextualAbierto = null;
  function cerrarMenuContextual() {
    menuContextualAbierto?.remove();
    menuContextualAbierto = null;
  }

  function abrirMenuContextual(ancla, acciones, elegir) {
    cerrarMenuContextual();
    const menu = document.createElement("div");
    menu.className = "hotspot-menu";
    acciones.forEach(accion => {
      const boton = document.createElement("button");
      boton.className = "hotspot-menu-opcion";
      boton.textContent = accion.label;
      boton.addEventListener("click", (event) => {
        event.stopPropagation();
        cerrarMenuContextual();
        elegir(accion);
      });
      menu.appendChild(boton);
    });
    document.body.appendChild(menu);
    menuContextualAbierto = menu;

    const anclaRect = ancla.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margen = 6;
    let left = Math.min(anclaRect.left, window.innerWidth - menuRect.width - margen);
    let top = anclaRect.bottom + margen;
    if (top + menuRect.height > window.innerHeight - margen) top = anclaRect.top - menuRect.height - margen;
    menu.style.left = `${Math.max(margen, left)}px`;
    menu.style.top = `${Math.max(margen, Math.min(top, window.innerHeight - menuRect.height - margen))}px`;

    const cerrarAlPulsarFuera = event => {
      if (!menu.contains(event.target)) {
        cerrarMenuContextual();
        document.removeEventListener("pointerdown", cerrarAlPulsarFuera);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", cerrarAlPulsarFuera), 0);
  }

  const hotspotsInfo = [];
  const exitsInfo = [];
  (escena.hotspots || []).forEach(hs => {
    const caja = cajaDeHotspot(hs, escena.objects || []);
    if (!caja) return;
    const el = document.createElement("div");
    el.className = "panoramica-hotspot";
    el.dataset.hotspotId = hs.id;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", hs.label);
    el.style.left = `${caja.x}px`;
    el.style.top = `${caja.y}px`;
    el.style.width = `${caja.width}px`;
    el.style.height = `${caja.height}px`;

    const etiqueta = document.createElement("span");
    etiqueta.className = "panoramica-hotspot-etiqueta";
    etiqueta.textContent = hs.label;
    etiqueta.style.display = "none";
    el.appendChild(etiqueta);

    // Visibilidad de la etiqueta gobernada directamente desde JS (display,
    // no opacity/transition): una transición CSS de opacidad produjo antes
    // un artefacto real de repintado en Chromium (texto fantasma
    // superpuesto) -- toggling directo de "display" no admite estados
    // intermedios mal compuestos.
    el.addEventListener("focus", () => { etiqueta.style.display = "block"; });
    el.addEventListener("blur", () => actualizarProximidadHotspots());

    function ejecutarTrigger(trigger) {
      const interaccion = buscarInteraccion(escena, { hotspot: trigger });
      if (!interaccion) {
        onTexto(escena.defaultText || "No parece que puedas hacer eso ahí.");
        return;
      }
      ejecutarInteraccion({
        escenaId,
        escena,
        interaccion,
        onTexto,
        onCustom: consecuencia => {
          pintarObjetos();
          pintarLuces();
          pintarAvatarYCamara();
          actualizarProximidadHotspots();
          if (Number.isFinite(consecuencia?.panoramicMoveToX)) moverAvatarA(consecuencia.panoramicMoveToX);
        }
      });
    }

    function activar() {
      const cajaActual = cajaDeHotspot(hs, escena.objects || []);
      if (!dentroDeCajaX(estado.avatarX, cajaActual, hs.marginX ?? 40)) {
        onTexto(hs.lejosText || "Tendrías que acercarte primero.");
        return;
      }
      if (hs.actions?.length) {
        abrirMenuContextual(el, hs.actions, accion => {
          if (accion.closeOnly) {
            onTexto(accion.closeText || "Decides no actuar todavía.");
            return;
          }
          ejecutarTrigger(accion.trigger);
        });
        return;
      }
      ejecutarTrigger(hs.trigger || hs.id);
    }
    el.addEventListener("click", (e) => { e.stopPropagation(); activar(); });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activar(); }
    });
    hotspotsEl.appendChild(el);
    hotspotsInfo.push({ el, etiqueta, hs });
  });

  // ---------- Salidas entre localizaciones Tiled ----------
  // Tiled define únicamente la caja y las referencias de navegación. El
  // contenido de la escena aporta etiqueta, requisitos y textos. La salida
  // usa el mismo lenguaje visual y la misma regla de proximidad que cualquier
  // otro hotspot; no crea un segundo sistema de movimiento.
  const salidasContenido = new Map((escena.exits || []).map(exit => [exit.id, exit]));
  (escena.tiledRuntime?.exits || []).forEach(exitTiled => {
    const contenido = salidasContenido.get(exitTiled.id) || {};
    const caja = exitTiled.box;
    if (!caja || !(caja.width > 0) || !(caja.height > 0)) return;

    const el = document.createElement("div");
    el.className = "panoramica-hotspot panoramica-salida";
    el.dataset.exitId = exitTiled.id;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    const label = contenido.label || exitTiled.id;
    el.setAttribute("aria-label", label);
    el.style.left = `${caja.x}px`;
    el.style.top = `${caja.y}px`;
    el.style.width = `${caja.width}px`;
    el.style.height = `${caja.height}px`;

    const etiqueta = document.createElement("span");
    etiqueta.className = "panoramica-hotspot-etiqueta";
    etiqueta.textContent = label;
    etiqueta.style.display = "none";
    el.appendChild(etiqueta);

    const activar = () => {
      const margen = contenido.marginX ?? 60;
      if (!dentroDeCajaX(estado.avatarX, caja, margen)) {
        onTexto(contenido.lejosText || "Tendrías que acercarte a la salida.");
        return;
      }
      const requisitosCumplidos = (contenido.requiresFlags || []).every(tieneFlag);
      if (!requisitosCumplidos) {
        onTexto(contenido.blockedText || "Ese paso todavía no está disponible.");
        return;
      }
      cambiarEscena(exitTiled.targetScene, { spawnId: exitTiled.targetSpawnId });
    };
    el.addEventListener("click", event => { event.stopPropagation(); activar(); });
    el.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activar(); }
    });
    el.addEventListener("focus", () => { etiqueta.style.display = "block"; });
    el.addEventListener("blur", () => actualizarProximidadHotspots());
    hotspotsEl.appendChild(el);
    exitsInfo.push({ el, etiqueta, caja, contenido });
  });

  const mostrarEtiquetasSiempre = config.debug.showHotspotAreas;
  function actualizarProximidadHotspots() {
    hotspotsInfo.forEach(({ el, etiqueta, hs }) => {
      const caja = cajaDeHotspot(hs, escena.objects || []);
      // La caja del propio elemento puede cambiar de tamaño si el objeto
      // cambió de estado (p.ej. la verja se ensancha al abrirse) -- se
      // repinta aquí para no quedar coincidiendo con un hueco que ya movió.
      el.style.left = `${caja.x}px`; el.style.top = `${caja.y}px`;
      el.style.width = `${caja.width}px`; el.style.height = `${caja.height}px`;
      const cerca = dentroDeCajaX(estado.avatarX, caja, hs.marginX ?? 40);
      el.classList.toggle("cerca", cerca);
      if (document.activeElement === el) return; // el foco de teclado manda mientras dure
      etiqueta.style.display = (cerca || mostrarEtiquetasSiempre) ? "block" : "none";
    });
    exitsInfo.forEach(({ el, etiqueta, caja, contenido }) => {
      const cerca = dentroDeCajaX(estado.avatarX, caja, contenido.marginX ?? 60);
      el.classList.toggle("cerca", cerca);
      if (document.activeElement === el) return;
      etiqueta.style.display = (cerca || mostrarEtiquetasSiempre) ? "block" : "none";
    });
  }

  // ---------- Avatar, movimiento y cámara ----------
  function updatePresentationLayers(timeMs = performance.now()) {
    capasDom.update({
      cameraX: estado.camaraX,
      cameraY: 0,
      pointerX: estado.pointerX || 0,
      pointerY: estado.pointerY || 0,
      timeMs,
      reducedMotion: config.accessibility.reduceMotion ||
        document.documentElement.classList.contains("reduce-motion") ||
        Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches),
      flags: state.flags
    });
  }

  function actualizarEscala() {
    const alturaDisponible = viewportEl.clientHeight || 1;
    const escalaFactor = alturaDisponible / master.height;
    escalaEl.style.transform = `scale(${escalaFactor})`;
    escalaEl.dataset.escala = String(escalaFactor);
    return escalaFactor;
  }

  function pintarAvatarYCamara() {
    const escalaFactor = actualizarEscala();
    avatarGrupoEl.style.left = `${estado.avatarX - avatarAncho / 2}px`;
    avatarGrupoEl.style.top = `${walkable.y - avatarAlto}px`;
    avatarEl.style.transform = estado.mirandoIzquierda ? "scaleX(-1)" : "";

    const viewportWidthWorld = (viewportEl.clientWidth || 1) / (escalaFactor || 1);
    estado.camaraX = calcularCamaraX({
      avatarX: estado.avatarX,
      camaraXPrev: estado.camaraX,
      viewportWidth: viewportWidthWorld,
      masterWidth: master.width,
      deadzonePct: escena.camera?.deadzoneWidthPct ?? 30,
      minX: escena.camera?.limits?.minX ?? 0,
      maxX: escena.camera?.limits?.maxX
    });
    mundoEl.style.transform = `translateX(${-estado.camaraX}px)`;
    updatePresentationLayers();
    actualizarProximidadHotspots();
  }

  // El PJ es quien se mueve; la cámara solo lo SIGUE mediante la zona muerta
  // de calcularCamaraX() -- nunca al revés.
  let animacionMovimiento = 0;
  function moverAvatarA(worldX) {
    const destino = clamp(worldX, walkable.xMin, walkable.xMax);
    const origen = estado.avatarX;
    if (destino === origen) return;
    estado.mirandoIzquierda = destino < origen;

    if (animacionMovimiento) cancelAnimationFrame(animacionMovimiento);
    const reducirMovimiento = document.documentElement.classList.contains("reduce-motion") ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reducirMovimiento || fotogramasMarcha.length < 2) {
      estado.avatarX = destino;
      avatarEl.src = fotogramasMarcha[0];
      pintarAvatarYCamara();
      return;
    }

    const distancia = Math.abs(destino - origen);
    const duracion = clamp((distancia / (escena.player.walkSpeed || 820)) * 1000, 360, 1400);
    const frameMs = escena.player.walkFrameMs || 130;
    let inicio = null;
    avatarGrupoEl.classList.add("caminando");

    function paso(timestamp) {
      if (inicio === null) inicio = timestamp;
      const progreso = Math.min(1, (timestamp - inicio) / duracion);
      estado.avatarX = origen + (destino - origen) * progreso;
      avatarEl.src = fotogramasMarcha[Math.floor((timestamp - inicio) / frameMs) % fotogramasMarcha.length];
      pintarAvatarYCamara();
      if (progreso < 1) {
        animacionMovimiento = requestAnimationFrame(paso);
      } else {
        animacionMovimiento = 0;
        avatarGrupoEl.classList.remove("caminando");
        avatarEl.src = fotogramasMarcha[0];
      }
    }
    animacionMovimiento = requestAnimationFrame(paso);
  }

  wrap.querySelector("#mov-izq").addEventListener("click", () => moverAvatarA(estado.avatarX - 120));
  wrap.querySelector("#mov-der").addEventListener("click", () => moverAvatarA(estado.avatarX + 120));
  viewportEl.addEventListener("pointermove", event => {
    const rect = viewportEl.getBoundingClientRect();
    estado.pointerX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    estado.pointerY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
    pintarAvatarYCamara();
  });
  viewportEl.addEventListener("pointerleave", () => {
    estado.pointerX = 0; estado.pointerY = 0; pintarAvatarYCamara();
  });
  viewportEl.addEventListener("click", (event) => {
    // Los hotspots gestionan su propio clic y paran la propagación. Un clic
    // libre sobre el decorado mueve al PJ al punto del mundo señalado.
    if (event.target.closest?.(".panoramica-hotspot")) return;
    const rect = viewportEl.getBoundingClientRect();
    const escalaFactor = Number(escalaEl.dataset.escala) || actualizarEscala();
    moverAvatarA(worldXDesdeCliente({
      clientX: event.clientX,
      viewportLeft: rect.left,
      escala: escalaFactor,
      camaraX: estado.camaraX
    }));
  });
  window.addEventListener("keydown", function onKey(e) {
    if (!wrap.isConnected) { window.removeEventListener("keydown", onKey); return; }
    if (e.key === "ArrowLeft") moverAvatarA(estado.avatarX - 60);
    if (e.key === "ArrowRight") moverAvatarA(estado.avatarX + 60);
  });
  pintarObjetos();
  pintarLuces();
  pintarAvatarYCamara();
  // BUG real encontrado con Playwright (2026-08-22, iteración de
  // integración): el cálculo de escala del primer pintarAvatarYCamara()
  // puede ganarle al layout -- si #scenario aún no había terminado de
  // ocupar su fila del grid (p.ej. justo tras la transición "fundiendo" o
  // llegando por el botón de menú en vez de un cambiarEscena() directo),
  // viewportEl.clientHeight se leía pequeño y la escena quedaba encogida
  // en una esquina para SIEMPRE -- "resize" nunca se disparaba porque la
  // ventana no cambiaba de tamaño, solo el contenido interno. Un único
  // repintado no bastaba para detectarlo en las pruebas anteriores porque
  // siempre incluían al menos un movimiento del avatar (que sí volvía a
  // medir). ResizeObserver mide el tamaño REAL del viewport cada vez que
  // cambia -- incluida la primera vez, ya con el layout asentado -- y
  // sigue cubriendo cualquier redimensión real de ventana sin necesitar
  // también el listener de "resize".
  new ResizeObserver(() => pintarAvatarYCamara()).observe(viewportEl);

  if (presentation.layers.some(layer => layer.oscillation.x || layer.oscillation.y)) {
    function animateAmbientLayers(timestamp) {
      if (!wrap.isConnected) return;
      updatePresentationLayers(timestamp);
      requestAnimationFrame(animateAmbientLayers);
    }
    requestAnimationFrame(animateAmbientLayers);
  }
}
