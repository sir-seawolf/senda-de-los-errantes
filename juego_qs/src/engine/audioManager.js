// Gestor de audio común y agnóstico del motor.
//
// La música conserva sus dos canales A/B y la API histórica. Los demás buses
// se crean bajo demanda: un canal de ambiente en bucle y pools acotados para
// reproducciones puntuales. El contenido solo entrega identificadores; un
// manifiesto registrado desde fuera resuelve esos ids a recursos físicos.
const CLAVE_PREFERENCIAS = "la_senda_audio_settings_v1";
const BUSES = Object.freeze(["music", "ambience", "sfx", "ui"]);
const BUSES_PUNTUALES = new Set(["sfx", "ui"]);
const DEFAULT_BUS_PREFS = Object.freeze({
  music: { enabled: true, volume: 0.65 },
  ambience: { enabled: true, volume: 0.65 },
  sfx: { enabled: true, volume: 0.8 },
  ui: { enabled: true, volume: 0.8 }
});

function limitar01(valor) {
  return Math.max(0, Math.min(1, Number(valor)));
}

function resolverFadeMs(config, from, to) {
  const regla = (config.fadeRules || []).find(r =>
    (r.from === from || r.from === "*") && r.to === to
  );
  return regla ? regla.fadeMs : config.defaultFadeMs;
}

function normalizarPreferencias(datos) {
  if (!datos || typeof datos !== "object") return null;
  const legacyValido = typeof datos.musicEnabled === "boolean" && typeof datos.musicVolume === "number";
  const busesGuardados = datos.buses && typeof datos.buses === "object" ? datos.buses : {};
  if (!legacyValido && !Object.keys(busesGuardados).length) return null;

  const buses = {};
  for (const bus of BUSES) {
    const guardado = busesGuardados[bus];
    const fallback = DEFAULT_BUS_PREFS[bus];
    const enabled = typeof guardado?.enabled === "boolean"
      ? guardado.enabled
      : (bus === "music" && legacyValido ? datos.musicEnabled : fallback.enabled);
    const volume = typeof guardado?.volume === "number"
      ? limitar01(guardado.volume)
      : (bus === "music" && legacyValido ? limitar01(datos.musicVolume) : fallback.volume);
    buses[bus] = { enabled, volume };
  }
  return buses;
}

function cargarPreferencias(storage) {
  try {
    const raw = storage?.getItem(CLAVE_PREFERENCIAS);
    return raw ? normalizarPreferencias(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function guardarPreferencias(storage, buses) {
  try {
    storage?.setItem(CLAVE_PREFERENCIAS, JSON.stringify({
      musicEnabled: buses.music.enabled,
      musicVolume: buses.music.volume,
      buses
    }));
  } catch {
    // La persistencia nunca debe bloquear el audio.
  }
}

function canalPorDefecto() {
  const audio = new Audio();
  audio.preload = "none";
  return audio;
}

export function crearGestorAudio({
  crearCanal = canalPorDefecto,
  storage = (typeof localStorage !== "undefined" ? localStorage : null),
  config = null,
  debug = false,
  resolverRecurso = (src) => src,
  log = (...args) => { if (debug) console.log("[audio]", ...args); }
} = {}) {
  // Estos son y seguirán siendo exclusivamente los dos canales musicales A/B.
  const canales = [crearCanal(), crearCanal()];
  const canalTrackUrl = [null, null];
  let activo = -1;
  let estadoActual = null;
  let moduloIdActual = null;
  let mapasPorModulo = {};
  let cfg = config;
  let desbloqueado = false;
  let pendiente = null;
  let ambientePendiente = null;
  let fadeTimer = null;

  const prefsGuardadas = cargarPreferencias(storage);
  const preferencias = structuredClone(prefsGuardadas || DEFAULT_BUS_PREFS);
  const manifiestos = new Map();
  let canalAmbiente = null;
  let ambienteActual = null;
  let ambienteBaseVolume = 1;
  const pools = { sfx: [], ui: [] };
  const limitesPuntuales = { sfx: 6, ui: 4 };

  function prepararCanal(canal, etiqueta) {
    canal.preload = "none";
    canal.volume = 0;
    canal.onerror = () => log("error al cargar", etiqueta, canal.src);
    return canal;
  }

  function volumenEfectivo(bus, baseVolume = 1) {
    const pref = preferencias[bus];
    return pref.enabled ? pref.volume * limitar01(baseVolume) : 0;
  }

  function aplicarDefaultsConfig() {
    for (const bus of BUSES) {
      const configurado = cfg?.buses?.[bus];
      if (!prefsGuardadas && typeof configurado?.defaultVolume === "number") {
        preferencias[bus].volume = limitar01(configurado.defaultVolume);
      }
    }
    if (!prefsGuardadas && typeof cfg?.defaultVolume === "number") {
      preferencias.music.volume = limitar01(cfg.defaultVolume);
    }
    limitesPuntuales.sfx = Math.max(1, Math.trunc(cfg?.buses?.sfx?.maxVoices ?? 6));
    limitesPuntuales.ui = Math.max(1, Math.trunc(cfg?.buses?.ui?.maxVoices ?? 4));
  }

  async function inicializar(rutaConfig = "src/data/audio/audioConfig.json") {
    if (!cfg) {
      try {
        const res = await fetch(rutaConfig);
        cfg = await res.json();
      } catch {
        cfg = {
          basePath: "assets/shared/audio/music/",
          defaultVolume: 0.65,
          defaultFadeMs: 2500,
          global: {},
          fadeRules: [],
          buses: {}
        };
      }
    }
    aplicarDefaultsConfig();
    canales.forEach((canal, i) => prepararCanal(canal, `music:${i}`));
  }

  // Fachada musical histórica: se conserva para todos los consumidores actuales.
  function registrarMapaModulo(moduloId, mapaMusica) {
    mapasPorModulo[moduloId] = mapaMusica || {};
  }

  function resolverArchivoMusical(moduloId, estado) {
    if (!cfg) return null;
    if (estado === "gateway" || estado === "menu") return cfg.global?.[estado] || null;
    return mapasPorModulo[moduloId]?.[estado] || null;
  }

  function resolverUrlMusical(moduloId, estado) {
    const archivo = resolverArchivoMusical(moduloId, estado);
    return archivo ? cfg.basePath + archivo : null;
  }

  // Puerto nuevo: el nombre de ámbito es opaco para el gestor. Puede ser un
  // módulo, un paquete común o cualquier adaptador futuro.
  function registrarManifiestoAudio(ambito, manifiesto) {
    manifiestos.set(ambito, manifiesto?.sounds || manifiesto || {});
  }

  function resolverSonido(ambito, identificador) {
    try {
      const entrada = manifiestos.get(ambito)?.[identificador];
      if (!entrada) return null;
      const descriptor = typeof entrada === "string" ? { src: entrada } : entrada;
      if (!descriptor?.src) return null;
      return {
        url: resolverRecurso(descriptor.src, { ambito, identificador }),
        volume: typeof descriptor.volume === "number" ? limitar01(descriptor.volume) : 1
      };
    } catch (error) {
      log("no se pudo resolver", ambito, identificador, error);
      return null;
    }
  }

  function cancelarFadeEnCurso() {
    if (fadeTimer !== null) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  function irASilencioInmediato() {
    cancelarFadeEnCurso();
    canales.forEach(c => { c.volume = 0; try { c.pause(); } catch {} });
    activo = -1;
  }

  function iniciarCrossfade(moduloId, estado, url, fadeMs) {
    cancelarFadeEnCurso();
    const destino = activo === 0 ? 1 : 0;
    const origen = activo;
    const canalDestino = canales[destino];
    const canalOrigen = origen >= 0 ? canales[origen] : null;

    if (canalTrackUrl[destino] !== url) {
      canalDestino.src = url;
      canalDestino.currentTime = 0;
      canalTrackUrl[destino] = url;
    }

    canalDestino.volume = 0;
    canalDestino.loop = true;
    const intentoPlay = canalDestino.play?.();
    if (intentoPlay?.catch) intentoPlay.catch(() => log("play() bloqueado/rechazado para", url));

    const pasos = Math.max(1, Math.round(fadeMs / 100));
    let paso = 0;
    fadeTimer = setInterval(() => {
      paso++;
      const t = Math.min(1, paso / pasos);
      const vFinal = volumenEfectivo("music");
      canalDestino.volume = vFinal * t;
      if (canalOrigen) canalOrigen.volume = vFinal * (1 - t);
      if (t >= 1) {
        cancelarFadeEnCurso();
        if (canalOrigen) { try { canalOrigen.pause(); } catch {} }
        activo = destino;
      }
    }, 100);

    estadoActual = estado;
    moduloIdActual = moduloId;
  }

  function _forzarFinDeFade() {
    if (fadeTimer === null) return;
    clearInterval(fadeTimer);
    fadeTimer = null;
    const destino = activo === 0 ? 1 : 0;
    const vFinal = volumenEfectivo("music");
    canales.forEach((c, i) => {
      if (i === destino) c.volume = vFinal;
      else { c.volume = 0; try { c.pause(); } catch {} }
    });
    activo = destino;
  }

  function reproducirEstado(moduloId, estado, opts = {}) {
    if (!desbloqueado) { pendiente = { moduloId, estado, opts }; return; }
    if (!cfg) return;
    if (estado === estadoActual && moduloId === moduloIdActual && activo >= 0) return;

    const url = resolverUrlMusical(moduloId, estado);
    if (!url) {
      irASilencioInmediato();
      estadoActual = estado;
      moduloIdActual = moduloId;
      return;
    }

    const fadeMs = opts.fadeMs ?? resolverFadeMs(cfg, estadoActual, estado);
    iniciarCrossfade(moduloId, estado, url, fadeMs);
  }

  function asegurarCanalAmbiente() {
    if (!canalAmbiente) canalAmbiente = prepararCanal(crearCanal(), "ambience");
    return canalAmbiente;
  }

  function detenerAmbiente() {
    if (!canalAmbiente) {
      ambienteActual = null;
      return;
    }
    try { canalAmbiente.pause(); } catch {}
    canalAmbiente.volume = 0;
    ambienteActual = null;
  }

  function reproducirAmbiente(ambito, identificador) {
    if (!desbloqueado) {
      ambientePendiente = { ambito, identificador };
      return true;
    }
    const sonido = resolverSonido(ambito, identificador);
    if (!sonido) {
      detenerAmbiente();
      return false;
    }
    if (ambienteActual?.ambito === ambito && ambienteActual?.identificador === identificador) return true;

    const canal = asegurarCanalAmbiente();
    try { canal.pause(); } catch {}
    canal.src = sonido.url;
    canal.currentTime = 0;
    canal.loop = true;
    ambienteBaseVolume = sonido.volume;
    canal.volume = volumenEfectivo("ambience", ambienteBaseVolume);
    ambienteActual = { ambito, identificador };
    const intento = canal.play?.();
    if (intento?.catch) intento.catch(() => log("play() bloqueado/rechazado para ambiente", sonido.url));
    return true;
  }

  function obtenerCanalPuntual(bus) {
    const pool = pools[bus];
    const libre = pool.find(canal => canal.ended || canal.paused);
    if (libre) return libre;
    if (pool.length < limitesPuntuales[bus]) {
      const nuevo = prepararCanal(crearCanal(), bus);
      pool.push(nuevo);
      return nuevo;
    }
    const reciclado = pool.shift();
    pool.push(reciclado);
    try { reciclado.pause(); } catch {}
    return reciclado;
  }

  function reproducirPuntual(bus, ambito, identificador) {
    if (!BUSES_PUNTUALES.has(bus) || !desbloqueado) return false;
    const sonido = resolverSonido(ambito, identificador);
    if (!sonido) return false;

    const canal = obtenerCanalPuntual(bus);
    canal.src = sonido.url;
    canal.currentTime = 0;
    canal.loop = false;
    canal._audioBaseVolume = sonido.volume;
    canal.volume = volumenEfectivo(bus, sonido.volume);
    const intento = canal.play?.();
    if (intento?.catch) intento.catch(() => log("play() bloqueado/rechazado para", bus, sonido.url));
    return true;
  }

  function desbloquear() {
    if (desbloqueado) return;
    desbloqueado = true;
    if (pendiente) {
      const pedido = pendiente;
      pendiente = null;
      reproducirEstado(pedido.moduloId, pedido.estado, pedido.opts);
    }
    if (ambientePendiente) {
      const pedido = ambientePendiente;
      ambientePendiente = null;
      reproducirAmbiente(pedido.ambito, pedido.identificador);
    }
  }

  function actualizarVolumenBus(bus) {
    if (bus === "music" && activo >= 0) canales[activo].volume = volumenEfectivo("music");
    if (bus === "ambience" && canalAmbiente) canalAmbiente.volume = volumenEfectivo("ambience", ambienteBaseVolume);
    if (BUSES_PUNTUALES.has(bus)) {
      pools[bus].forEach(canal => {
        canal.volume = volumenEfectivo(bus, canal._audioBaseVolume ?? 1);
      });
    }
  }

  function establecerMuteBus(bus, valor) {
    if (!BUSES.includes(bus)) return false;
    preferencias[bus].enabled = !valor;
    actualizarVolumenBus(bus);
    guardarPreferencias(storage, preferencias);
    return true;
  }

  function establecerVolumenBus(bus, valor) {
    if (!BUSES.includes(bus)) return false;
    preferencias[bus].volume = limitar01(valor);
    actualizarVolumenBus(bus);
    guardarPreferencias(storage, preferencias);
    return true;
  }

  // Alias obligatorios de compatibilidad musical.
  function establecerMute(valor) {
    establecerMuteBus("music", valor);
  }

  function establecerVolumen(valor) {
    establecerVolumenBus("music", valor);
  }

  function obtenerPreferencias() {
    const buses = structuredClone(preferencias);
    return {
      musicEnabled: buses.music.enabled,
      musicVolume: buses.music.volume,
      buses
    };
  }

  function alCambiarVisibilidad(oculto) {
    const activos = [];
    if (activo >= 0) activos.push(canales[activo]);
    if (canalAmbiente && ambienteActual) activos.push(canalAmbiente);
    for (const canal of activos) {
      if (oculto) {
        try { canal.pause(); } catch {}
      } else {
        const intento = canal.play?.();
        if (intento?.catch) intento.catch(() => log("no se pudo reanudar audio"));
      }
    }
  }

  function _estado() {
    return {
      activo,
      estadoActual,
      moduloIdActual,
      desbloqueado,
      muted: !preferencias.music.enabled,
      volumen: preferencias.music.volume,
      canalTrackUrl: [...canalTrackUrl],
      ambienteActual,
      limitesPuntuales: { ...limitesPuntuales },
      vocesPuntuales: { sfx: pools.sfx.length, ui: pools.ui.length }
    };
  }

  return {
    inicializar,
    registrarMapaModulo,
    reproducirEstado,
    registrarManifiestoAudio,
    reproducirAmbiente,
    detenerAmbiente,
    reproducirPuntual,
    desbloquear,
    establecerMute,
    establecerVolumen,
    establecerMuteBus,
    establecerVolumenBus,
    obtenerPreferencias,
    alCambiarVisibilidad,
    irASilencioInmediato,
    _forzarFinDeFade,
    _estado,
    _canales: canales,
    _canalAmbiente: () => canalAmbiente,
    _pools: pools
  };
}

export const audioManager = (typeof window !== "undefined") ? crearGestorAudio() : null;

export { resolverFadeMs, BUSES };
