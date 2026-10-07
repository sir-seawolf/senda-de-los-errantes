// TacticalEncounterDefinition real de Predator N-5.2 (Production
// Integration Phase 3 + Phase 3.5, ver
// docs/TACTICAL_PRODUCTION_PHASE3_AUDIT.md y
// docs/TACTICAL_PRODUCTION_PHASE35.md para el mapeo dato-a-dato y el
// cierre de los dos blockers de P3). Consumidor del Tactical Engine
// core migrado en Phase 2 (src/tactical/) -- este archivo es PURO DATO,
// cero lógica. Vive junto al módulo Predator, NUNCA dentro de
// src/tactical/ (el core no debe conocer a Predator).
//
// Cada valor de este archivo tiene un origen trazable a un archivo
// productivo real (characters.json / enemies.json / weapons.json /
// encuentro_perseguidores_01.json / callejon.json) -- ver los audits
// para la tabla completa de decisiones de mapeo.
//
// P3.5 cerró los dos blockers de P3: (1) los ejecutores no declaran
// habilidadEsquivar -- no existe fuente canónica confirmada para su
// esquiva, así que la ausencia queda explícita en vez de usar un proxy
// inventado; (2) las tres transiciones reales (victory/defeat/flee) ya
// están representadas con el nuevo modelo de outcome genérico del core
// (transitions.flee, transitions.defeat como {resolver:"module"}).
//
// DECISIÓN DE AUTOR CERRADA (Phase 4, ya no AUTHOR_DECISION_REQUIRED):
// los cuatro perseguidores de este encuentro NO tienen esquiva por
// diseño del módulo, no por una laguna de datos pendiente de resolver
// -- la capacidad de esquiva/movimiento evasivo queda reservada para
// enemigos más poderosos, entrenados o especiales en futuros
// encuentros. `habilidadEsquivar` sigue sin declararse aquí, pero
// ahora es una elección de diseño explícita, no una pregunta abierta.
//
// Phase 4 conecta esta definición al routing narrativo real (ver
// docs/TACTICAL_PRODUCTION_PHASE4.md) -- combate_inicial.json ya puede
// solicitar "tactical-phaser" a través de su encounter, con
// TACTICAL_PHASER_ENABLED en su default (false) el jugador sigue
// viendo exactamente el renderer legacy de siempre.

const MUNICION = (cargador, reserva) => ({ cargador, reserva });

// Adaptador pool-único -> tri-tier (ver audit §5): los ejecutores MORT
// usan en producción un único pool de PV (enemies.json, pvBase), sin el
// sistema Sano/Herido/Tullido de la party. Para satisfacer el contrato
// (que exige vidaActual.sano/herido/tullido + base.niveles.tullido para
// CUALQUIER actor) sin introducir la penalización por estado de herida
// que los enemigos nunca han tenido, todo el pool se coloca en "sano" y
// "herido"/"tullido" quedan a 0 -- cualquier daño que exceda "sano"
// desborda inmediatamente (down), igual que el pool plano real.
const VIDA_ENEMIGO_POOL_UNICO = (pv) => ({ vidaActual: { sano: pv, herido: 0, tullido: 0 }, base: { niveles: { tullido: 0 } } });

// Party: modelo tri-tier real, ya usado sin adaptar (characters.json.niveles).
const VIDA_PARTY = (nivel) => ({ vidaActual: { sano: nivel, herido: nivel, tullido: nivel }, base: { niveles: { tullido: nivel } } });

export const predatorTacticalEncounter = {
  schemaVersion: 1,
  id: "predator_combate_inicial_tactical",
  // Production Integration Phase 6C/6-playtest: activa el renderer
  // oblicuo/isométrico (spike verificado por Playwright, ver
  // docs/TACTICAL_PRODUCTION_PHASE6C_SPIKE.md) SOLO para este encuentro
  // real de Predator. Dirección visual aceptada para encuentros con PJ
  // a pie -- la vista cenital sigue existiendo como fallback técnico
  // (TacticalScene.js, sin tocar) y como opción futura reservada para
  // naves/vehículos/unidades (no desarrollados todavía). Ningún otro
  // encuentro ni módulo activa este valor.
  renderer: "phaser-tactical-isometric",
  ui: {
    locationLabel: "Callejón de servicio · Sector N-5.2"
  },

  // Plaza narrativa del protagonista. Si se elige un personaje que no está
  // en el reparto táctico base (Reyes, Drago o uno importado), el adaptador
  // genérico conserva esta posición y sustituye sus datos por los de la ficha.
  playerActorSlotId: "kova",

  // Battlefield: sin coordenadas en la fuente legacy (la cobertura real
  // es un nivel entero por combatiente, no un objeto en el mundo) --
  // layout construido de cero para esta fase y verificado contra el
  // SpatialCombatAdapter real de producción (ver
  // tests/tacticalPredatorEncounter.test.mjs, "geometría real de
  // producción"). "cajas"/"contenedor" son los DOS objetos de cobertura
  // reales que declara encuentro_perseguidores_01.json/callejon.json;
  // "muro_callejon" es una adición DIGITAL_SPATIAL_ADAPTATION (geometría
  // propia del callejón, no un objeto de cobertura narrativo) pendiente
  // de confirmación del autor -- ver audit §7.
  battlefield: {
    widthMeters: 20,
    heightMeters: 12,
    metersToPx: 40,
    coverRadiusMeters: 2.2,
    background: null, // sin arte táctico todavía -- P3 es solo datos
    obstacles: [
      { id: "cajas", type: "partial", nombre: "Cajas apiladas", x: 7, y: 8.4, width: 1.4, height: 1.2 },
      { id: "contenedor", type: "solid", nombre: "Contenedor metálico", x: 11, y: 5.6, width: 2, height: 2 },
      // DIGITAL_SPATIAL_ADAPTATION -- ver audit §7. No aparece en
      // coberturaDisponible de encuentro_perseguidores_01.json.
      { id: "muro_callejon", type: "total", nombre: "Esquina del callejón", x: 15.5, y: 0, width: 1, height: 4.5 }
    ],
    terrainConfig: { costeAscensoPorMetro: 0.75 },
    terrainZones: [
      // Las manchas blandas se pegan a los márgenes de circulación; no
      // compiten con los combatientes ni se leen como props arrojados.
      { id: "charco_carga", type: "puddle", label: "Charco aceitoso", asset: "puddle", x: 4.7, y: 7.65, width: 2.7, height: 1.15, widthMeters: 2.75, movementMultiplier: 1.5, elevationMeters: 0, depth: 1, originY: 0.5, alpha: 0.78 },
      { id: "escombro_humedo", type: "debris", label: "Escombros y maleza", asset: "debris", x: 5.4, y: 2.4, width: 2.2, height: 1.05, widthMeters: 2.15, movementMultiplier: 1.35, elevationMeters: 0, depth: 2, originY: 0.55, alpha: 0.7 },
      // La plataforma pertenece al muelle del perímetro. El ejecutor 4
      // ocupa su superficie: altura, cobertura y figura cuentan la misma
      // historia espacial en vez de ser capas independientes.
      { id: "plataforma_carga", structureId: "perimetro_servicio", attachedToExitId: "salida_seguridad", occupantIds: ["ejecutor_4"], type: "platform", label: "Muelle elevado", asset: "platform", x: 10.7, y: 2.55, width: 4.1, height: 2.55, widthMeters: 4.05, movementMultiplier: 1.1, elevationMeters: 0.6, depthOffset: -3, originY: 0.82 }
    ],
    visuals: {
      walls: [
        // Toda la escenografía vive en metros del tablero. Así conserva
        // su relación con actores y cobertura en cualquier viewport.
        { structureId: "perimetro_servicio", asset: "straight", x: 5.8, y: 2.7, widthMeters: 5.4, originY: 0.88 },
        { structureId: "perimetro_servicio", asset: "corner", x: 10.4, y: 1.2, widthMeters: 5.1, originY: 0.88 }
      ],
      props: [
        { asset: "crates", obstacleId: "cajas", widthMeters: 1.55 },
        { asset: "barrier", obstacleId: "contenedor", widthMeters: 1.6 }
      ],
      exits: [
        { id: "salida_seguridad", structureId: "perimetro_servicio", asset: "security", state: "closed", x: 15.4, y: 0.6, widthMeters: 4.35, originY: 0.9 }
      ]
    },
    atmosphere: {
      ambientTint: 0x071116,
      ambientAlpha: 0.2,
      reducedGridAlpha: 0.13,
      lights: [
        { x: 15.2, y: 1.1, color: 0x8adcf0, radiusMeters: 3.8, intensity: 0.13, pulse: 0.018 },
        { x: 6.2, y: 3.2, color: 0xe5ad5a, radiusMeters: 2.6, intensity: 0.09, pulse: 0.014 },
        { x: 12.2, y: 8.4, color: 0xe5ad5a, radiusMeters: 2.2, intensity: 0.075, pulse: 0.012 }
      ],
      particles: { type: "dust", count: 18, color: 0xaec4c9, alpha: 0.16, driftPx: 22, durationMs: 5200 }
    }
  },

  actors: {
    party: [
      {
        // Kova -- characters.json "kova". Arma activa: Subfusil ->
        // habilidadDisparo = habilidades["Distancia Media"]. armaCC:
        // Machete real (characters.json.armaCC). Blindaje: armadura
        // ligera real (2).
        id: "kova", nombre: "Kova", x: 3, y: 9, esPJ: false,
        habilidadDisparo: 48, habilidadCC: 57, habilidadEsquivar: 43, blindaje: 2,
        armaPrimaria: { nombre: "Subfusil", danioBase: 5, penetracion: 0, tamano: "mediana", cadenciaMax: "fuegoSostenido" },
        armaCC: { nombre: "Machete", danioBase: 4, fuerzaMinima: 40, tamano: "pequena" },
        municion: { primaria: MUNICION(30, 60) },
        ...VIDA_PARTY(20)
      },
      {
        // Bishop -- characters.json "bishop". Arma activa: Pistola
        // pequeña -> habilidadDisparo = habilidades["Distancia Corta"].
        // Sin arma CC real (characters.json.armaCC.danio = 0) -- se
        // copia igual, no se inventa una. Blindaje 0 (traje de
        // especialista, sin zonas).
        id: "bishop", nombre: "Bishop", x: 3, y: 6, esPJ: false,
        habilidadDisparo: 45, habilidadCC: 37, habilidadEsquivar: 40, blindaje: 0,
        armaPrimaria: { nombre: "Pistola pequeña", danioBase: 3, penetracion: 0, tamano: "pequena", cadenciaMax: "tiroATiro" },
        armaCC: { nombre: "Sin arma CC", danioBase: 0, fuerzaMinima: 0, tamano: "pequena" },
        municion: { primaria: MUNICION(12, 24) },
        ...VIDA_PARTY(15)
      },
      {
        // Salim -- characters.json "salim". Mismo patrón que Bishop
        // (Pistola pequeña, sin arma CC real). Blindaje 0 (mono de
        // especialista).
        id: "salim", nombre: "Salim", x: 3, y: 3, esPJ: false,
        habilidadDisparo: 38, habilidadCC: 32, habilidadEsquivar: 33, blindaje: 0,
        armaPrimaria: { nombre: "Pistola pequeña", danioBase: 3, penetracion: 0, tamano: "pequena", cadenciaMax: "tiroATiro" },
        armaCC: { nombre: "Sin arma CC", danioBase: 0, fuerzaMinima: 0, tamano: "pequena" },
        municion: { primaria: MUNICION(12, 24) },
        ...VIDA_PARTY(16)
      }
    ],

    // 4 Ejecutores MORT -- enemies.json "ejecutorMort", cantidad real
    // para 3 personajes de party (encuentro_perseguidores_01.json,
    // ajusteEjecutores.tabla). Identidad player-facing: se usa
    // "Ejecutor corporativo" (nombreOculto real), NUNCA "MORT" -- el
    // flag identidad_mort_revelada no está activo en la vertical slice
    // actual (audit §1). Blindaje 2 (SOURCE_OVERRIDE DIGITAL_ADAPTATION
    // ya vigente en producción -- NO se revierte a 3 aquí).
    enemies: [
      { id: "ejecutor_1", nombre: "Ejecutor corporativo 1", x: 12.4, y: 6.6, esPJ: false,
        // habilidadEsquivar OMITIDA por DISEÑO (decisión de autor
        // cerrada en Phase 4, ver docs/TACTICAL_PRODUCTION_PHASE4.md):
        // los Ejecutores MORT de este encuentro no tienen esquiva --
        // esa capacidad queda reservada para enemigos más poderosos,
        // entrenados o especiales en futuros encuentros. No es una
        // laguna de datos pendiente (ya no AUTHOR_DECISION_REQUIRED),
        // ni "alerta"/"categoriasSecundarias" se usan como proxy.
        // tacticalAI.js respeta la ausencia genéricamente: estos
        // ejecutores nunca reciben la opción EVASIVE_MOVEMENT.
        habilidadDisparo: 35, habilidadCC: 35, blindaje: 2,
        armaPrimaria: { nombre: "Subfusil", danioBase: 5, penetracion: 0, tamano: "mediana", cadenciaMax: "fuegoSostenido" },
        armaCC: { nombre: "Machete", danioBase: 4, fuerzaMinima: 40, tamano: "pequena" },
        municion: { primaria: MUNICION(40, 60) },
        ...VIDA_ENEMIGO_POOL_UNICO(18) },
      { id: "ejecutor_2", nombre: "Ejecutor corporativo 2", x: 8.6, y: 9, esPJ: false,
        // habilidadEsquivar OMITIDA por DISEÑO (decisión de autor
        // cerrada en Phase 4, ver docs/TACTICAL_PRODUCTION_PHASE4.md):
        // los Ejecutores MORT de este encuentro no tienen esquiva --
        // esa capacidad queda reservada para enemigos más poderosos,
        // entrenados o especiales en futuros encuentros. No es una
        // laguna de datos pendiente (ya no AUTHOR_DECISION_REQUIRED),
        // ni "alerta"/"categoriasSecundarias" se usan como proxy.
        // tacticalAI.js respeta la ausencia genéricamente: estos
        // ejecutores nunca reciben la opción EVASIVE_MOVEMENT.
        habilidadDisparo: 35, habilidadCC: 35, blindaje: 2,
        armaPrimaria: { nombre: "Subfusil", danioBase: 5, penetracion: 0, tamano: "mediana", cadenciaMax: "fuegoSostenido" },
        armaCC: { nombre: "Machete", danioBase: 4, fuerzaMinima: 40, tamano: "pequena" },
        municion: { primaria: MUNICION(40, 60) },
        ...VIDA_ENEMIGO_POOL_UNICO(18) },
      { id: "ejecutor_3", nombre: "Ejecutor corporativo 3", x: 17, y: 2.5, esPJ: false,
        // habilidadEsquivar OMITIDA por DISEÑO (decisión de autor
        // cerrada en Phase 4, ver docs/TACTICAL_PRODUCTION_PHASE4.md):
        // los Ejecutores MORT de este encuentro no tienen esquiva --
        // esa capacidad queda reservada para enemigos más poderosos,
        // entrenados o especiales en futuros encuentros. No es una
        // laguna de datos pendiente (ya no AUTHOR_DECISION_REQUIRED),
        // ni "alerta"/"categoriasSecundarias" se usan como proxy.
        // tacticalAI.js respeta la ausencia genéricamente: estos
        // ejecutores nunca reciben la opción EVASIVE_MOVEMENT.
        habilidadDisparo: 35, habilidadCC: 35, blindaje: 2,
        armaPrimaria: { nombre: "Subfusil", danioBase: 5, penetracion: 0, tamano: "mediana", cadenciaMax: "fuegoSostenido" },
        armaCC: { nombre: "Machete", danioBase: 4, fuerzaMinima: 40, tamano: "pequena" },
        municion: { primaria: MUNICION(40, 60) },
        ...VIDA_ENEMIGO_POOL_UNICO(18) },
      { id: "ejecutor_4", nombre: "Ejecutor corporativo 4", x: 12.75, y: 3.8, esPJ: false,
        // habilidadEsquivar OMITIDA por DISEÑO (decisión de autor
        // cerrada en Phase 4, ver docs/TACTICAL_PRODUCTION_PHASE4.md):
        // los Ejecutores MORT de este encuentro no tienen esquiva --
        // esa capacidad queda reservada para enemigos más poderosos,
        // entrenados o especiales en futuros encuentros. No es una
        // laguna de datos pendiente (ya no AUTHOR_DECISION_REQUIRED),
        // ni "alerta"/"categoriasSecundarias" se usan como proxy.
        // tacticalAI.js respeta la ausencia genéricamente: estos
        // ejecutores nunca reciben la opción EVASIVE_MOVEMENT.
        habilidadDisparo: 35, habilidadCC: 35, blindaje: 2,
        armaPrimaria: { nombre: "Subfusil", danioBase: 5, penetracion: 0, tamano: "mediana", cadenciaMax: "fuegoSostenido" },
        armaCC: { nombre: "Machete", danioBase: 4, fuerzaMinima: 40, tamano: "pequena" },
        municion: { primaria: MUNICION(40, 60) },
        ...VIDA_ENEMIGO_POOL_UNICO(18) }
    ]
  },

  // eliminateEnemies/allPartyDown ya soportados sin cambios por el core
  // (P2) -- ningún "cuatro perseguidores muertos" hardcodeado en
  // src/tactical/.
  objectives: {
    victory: { type: "eliminateEnemies" },
    defeat: { type: "allPartyDown" }
  },

  // Perfiles EXISTENTES (P2, sin crear ninguno nuevo). "cautious" para
  // los ejecutores porque es el único perfil que ya reproduce su único
  // comportamiento defensivo real observable en combat.js ("se queda sin
  // munición y se cubre" -- buscarCobertura=true). "cautious" para
  // companions porque es el comportamiento por defecto ya usado (ningún
  // encuentro existente pide agresividad/evasión especial).
  ai: { enemies: "cautious", companions: "cautious" },

  assets: {
    moduleRoot: "modules/predator_n52",
    battlefield: "assets/generated/tactical_battlefield_warehouse_v1.png",
    scene: {
      floor: "assets/generated/tactical/floor_concrete_cc0_v1.jpg",
      walls: {
        straight: "assets/generated/tactical/wall_straight_v1.png",
        corner: "assets/generated/tactical/wall_corner_v1.png"
      },
      props: {
        crates: "assets/generated/tactical/prop_crates_v1.png",
        barrier: "assets/generated/tactical/prop_barrier_v1.png"
      },
      terrain: {
        puddle: "assets/generated/tactical/terrain_puddle_v1.png",
        debris: "assets/generated/tactical/terrain_debris_weeds_v1.png",
        platform: "assets/generated/tactical/terrain_platform_v1.png"
      },
      exits: {
        security: {
          closed: "assets/generated/tactical/door_closed_v1.png",
          open: "assets/generated/tactical/door_open_v2.png"
        }
      }
    },
    actors: {
      kova: { idle: "assets/generated/sprites/kova_tactical.png" },
      bishop: { idle: "assets/generated/sprites/bishop_tactical.png" },
      salim: { idle: "assets/generated/sprites/salim_tactical.png" },
      // La presentación conserva la premisa: son perseguidores humanos y
      // anónimos. La afiliación real no se codifica en el arte ni se revela
      // antes de que el módulo active su flag narrativo.
      ejecutor_1: { idle: "assets/generated/sprites/executor_human_idle_v1.png", hurt: "assets/generated/sprites/executor_human_hurt_v2.png", down: "assets/generated/sprites/executor_human_down_v2.png" },
      ejecutor_2: { idle: "assets/generated/sprites/executor_human_idle_v1.png", hurt: "assets/generated/sprites/executor_human_hurt_v2.png", down: "assets/generated/sprites/executor_human_down_v2.png" },
      ejecutor_3: { idle: "assets/generated/sprites/executor_human_idle_v1.png", hurt: "assets/generated/sprites/executor_human_hurt_v2.png", down: "assets/generated/sprites/executor_human_down_v2.png" },
      ejecutor_4: { idle: "assets/generated/sprites/executor_human_idle_v1.png", hurt: "assets/generated/sprites/executor_human_hurt_v2.png", down: "assets/generated/sprites/executor_human_down_v2.png" }
    },
    portraits: {
      kova: "assets/characters/kova.png",
      bishop: "assets/characters/bishop.png",
      salim: "assets/characters/salim.png"
    },
    ui: {
      actionFamilies: {
        ofensivas: "assets/generated/weapons/weapon_smg_side.png",
        tacticas: "assets/generated/ui/ui_alert.png",
        defensivas: "assets/generated/ui/ui_armor.png"
      }
    },
    fxProfile: "industrial"
  },

  // Production Integration Phase 3.5 (docs/TACTICAL_PRODUCTION_PHASE35.md)
  // -- cierra el blocker de P3: los tres outcomes reales de
  // encuentro_perseguidores_01.json ya tienen representación:
  //   - victory  -> id de escena plano real ("aparcamiento_panoramico_piloto").
  //   - flee     -> id de escena plano real ("persecucion",
  //                 onFlee.transition real -- el jugador huye a mitad de
  //                 combate y vuelve al minijuego de persecución).
  //   - defeat   -> {resolver:"module"}: el destino real depende de
  //                 setFinalTipo condicional (finales.json, "muerte" vs
  //                 "casi_muerto" según si se gastó un Punto Épico) --
  //                 una decisión de estado narrativo que el Tactical
  //                 Engine no tiene datos para tomar. El motor solo
  //                 informa outcome="defeat"; el módulo (fuera de
  //                 src/tactical/) es quien aplica exactamente la misma
  //                 lógica que ya tiene combat.js hoy.
  transitions: {
    victory: "aparcamiento_panoramico_piloto",
    defeat: { resolver: "module" },
    flee: "persecucion"
  }
};
