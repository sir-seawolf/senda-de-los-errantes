const STEP_TITLES = [
  "1) Tipo de personaje","2) Atributos y Puntos Gratuitos","3) Stats derivados","4) Profesiones",
  "5) Habilidades","6) MéritoDefecto especial","7) Méritos y Defectos","8) Equipo y dinero",
  "9) Resumen","10) Ficha final"
];

const PROFESIONES = ["Combatiente","Civil","Científico","Especialista Técnico","Iniciado","Ninguna"];
const TYPE_CFG = {
  "Héroe": {prim:40, sec:35, pg:10, pe:1},
  "Madera de Héroe": {prim:35, sec:30, pg:20, pe:3},
  "Predestinado": {prim:30, sec:25, pg:30, pe:9}
};
const ATTRS = ["Ca","A","P","C","I","F","V","H"];

const RAZAS = {
  "Humano": { mod:{}, voc:null, maxAttr:50, profSlots:3 },
  "Nakel": { mod:{}, voc:"Especialista Técnico", maxAttr:50, profSlots:2 },
  "Inukel": { mod:{Ca:5,I:-5}, voc:"Especialista Técnico", maxAttr:50, profSlots:3 },
  "Kawalapiti": { mod:{C:10,V:5,Ca:-10,A:-5}, voc:null, maxAttr:50, profSlots:2 },
  "Chernos": { mod:{C:10,P:5,Ca:-10,F:-5}, voc:null, maxAttr:50, profSlots:2 },
  "Mujer Gato": { mod:{A:10,Ca:5}, voc:"Civil", maxAttr:50, profSlots:3 },
  "Hombre Gato": { mod:{F:10,C:10,I:-10}, voc:"Combatiente", maxAttr:50, profSlots:3 }
};

// Conducir, Pilotar y Sigilo son rama dual (ANEXO_Meritos_Habilidades_DEFINITIVO.md): aparecen
// en tecnologicas Y en atleticas, con su propia base cada una — no es un duplicado por error.
const SKILLS = {
  academicas:["Ciencias","Biotecnología","Navegación","Burocracia","Buscar información","Programación","Diagnóstico","Investigación","Juego","Diseño Hardware","Sentido del Negocio","Supervivencia","Vigilar/Rastrear"],
  tecnologicas:["Armería","Artesanía","Ciber-tecnología","Demoliciones","Disfraz","Electrónica","Falsificación","Química","Mecánica","Manos ágiles","Seguridad","Primeros Auxilios","Conducir","Pilotar","Trajes Servoasistidos","Sigilo"],
  atleticas:["Acrobacias","Resistir","Proezas","Conducir","Pilotar","Sigilo"],
  sociales:["Absorción","Autocontrol","Bajos Fondos","Empatía","Interrogatorio","Liderazgo","Manejo de Animales","Persuasión","Seducción","Estilo"],
  combate:["Iniciativa","Alerta","Esquivar","Distancia Corta","Distancia Media","Distancia Larga","Sin Armas","Arma CC Corta","Arma CC Media","Arma CC Larga"],
  distorsion:["Detección de Distorsión","Manipulación de Distorsión","Camino de los Portales","Tatuador Rúnico","Herrero Rúnico","Proyección de Energía","Protección de Energía","Invocación de Energía"]
};

const SKILL_BASE_FORMULA = {
  academicas: () => round((attr("I")+attr("V"))/2),
  tecnologicas: () => round((attr("H")+attr("P"))/2),
  atleticas: () => round((attr("A")+attr("F"))/2),
  sociales: () => round((attr("Ca")+attr("P"))/2),
  // Combate no tiene base única de rama: cada habilidad su propia fórmula (Anexo Méritos/Habilidades).
  // Distancia y Arma CC comparten la misma fórmula en sus tres tramos — el tamaño del arma
  // (FUE mínima, CAP04d) diferencia el tramo en juego, no la fórmula.
  combate: [
    () => round((attr("A")+attr("P"))/2),            // Iniciativa
    () => round((attr("P")+attr("I"))/2),            // Alerta
    () => round((attr("A")+attr("H"))/2),            // Esquivar
    () => round((attr("A")+attr("H"))/2),            // Distancia Corta
    () => round((attr("A")+attr("H"))/2),            // Distancia Media
    () => round((attr("A")+attr("H"))/2),            // Distancia Larga
    () => round((attr("F")+attr("C")+attr("A"))/3),  // Sin Armas
    () => round((attr("F")+attr("A")+attr("H"))/3),  // Arma CC Corta
    () => round((attr("F")+attr("A")+attr("H"))/3),  // Arma CC Media
    () => round((attr("F")+attr("A")+attr("H"))/3)   // Arma CC Larga
  ],
  // Distorsión arranca a 0, sin base calculada (Anexo): no se promedia con atributos.
  distorsion: () => 0
};

const POOL_SOURCE = {
  Combatiente:{combate:15, atleticas:10, tecnologicas:5},
  Civil:{academicas:15, sociales:10, atleticas:5},
  "Científico":{academicas:15, tecnologicas:10, sociales:5},
  "Especialista Técnico":{tecnologicas:15, sociales:10, academicas:5},
  Iniciado:{distorsion:15, academicas:10, tecnologicas:5}
};

const ECON_CFG = {
  Combatiente:{income:4000, kit1:"Casco + chaleco (Bld 1) + arma básica", kit2:"Armadura superior o arma modificada / vehículo ligero"},
  Civil:{income:10000, kit1:"Ropa de calidad + vehículo pequeño", kit2:"Vehículo de gama o propiedad + contactos"},
  "Científico":{income:6000, kit1:"Traje especialista + herramientas + escáner", kit2:"Laboratorio de campo o acceso a datos"},
  "Especialista Técnico":{income:6000, kit1:"Traje + escáner + kit herramientas", kit2:"Dron/droide auxiliar o taller portátil"},
  Iniciado:{income:3000, kit1:"Traje Iniciado + acumulador rúnico", kit2:"Focos extra + perlas + 1 runa básica"}
};

// Las 9 runas básicas reales (CAP04b) — "Ancla/Velo/Pulso" eran un error, no existen en el Anexo.
const RUNAS_BASICAS = ["Filo","Ímpetu","Resistencia","Luz","Alerta","Paso Ligero","Silencio","Aguante","Impulso"];

// Runas de Escuela, solo Nivel 1-2 ("sin restricción" según CAP04b) — Nivel 3+ excluido de creación
// (requiere maestro/narrativa). Nivel 7+ (Míticas) no se fabrican por reglas estándar, no entran aquí.
// No se repiten nombres que ya están en las básicas (Silencio/Luz/Alerta/Paso Ligero aparecen también
// en algunas escuelas como reafirmación de la misma runa — se usa la básica, no se duplica aquí).
const RUNAS_ESCUELA = {
  "Combate": [
    {n:"Explosiva", nivel:1},
    {n:"Veneno", nivel:1},
    {n:"Veneno de Hoja", nivel:1},
    {n:"Furia", nivel:2},
    {n:"Piel de Hierro", nivel:2},
  ],
  "Laboratorio": [
    {n:"Preservar", nivel:1},
    {n:"Sellado", nivel:1},
    {n:"Transmutación", nivel:2},
    {n:"Análisis", nivel:2},
    {n:"Elemental", nivel:1},
  ],
  "Nómada": [
    {n:"Búsqueda", nivel:1},
    {n:"Invocación", nivel:2},
    {n:"Raíz", nivel:2},
  ],
  "Sombra": [
    {n:"Sombra", nivel:2},
    {n:"Alteración de Sentidos", nivel:2},
  ],
  "Vínculo": [
    {n:"Velocidad", nivel:2},
    {n:"Ojo de Águila", nivel:2},
  ],
  "Forja": [
    {n:"Protección", nivel:2},
    {n:"Aguza", nivel:2},
    {n:"Duradera", nivel:2},
  ],
};
const ESCUELAS = ["Básica", ...Object.keys(RUNAS_ESCUELA)];

const MERITOS = [
  {n:"Afiliación", pe:1, desc:"Pertenencia a una corp con rango, recursos y obligaciones. Workhouse: gratis."},
  {n:"Característica mejorada", pe:2, desc:"+10 a un atributo, sin superar el techo de creación. El exceso no se aplica ni se guarda."},
  {n:"Habilidad mejorada", pe:2, desc:"+30 a una habilidad específica, techo 90 en creación. El exceso no se aplica ni se guarda."},
  {n:"Ahorros", pe:1, desc:"+10.000 PC disponibles."},
  {n:"Contactos", pe:1, desc:"Una red que suma a las habilidades afines cuando los contactas."},
  {n:"Fama", pe:1, desc:"Tu nombre llega antes que tú. Influyes sobre nivel²×200 personas en tu contexto."},
  {n:"Iniciativa (tipo)", pe:1, desc:"+10 a Iniciativa en el tipo indicado (CC, distancia o general)."},
  {n:"Posición", pe:1, desc:"Un lugar reconocido en una jerarquía. Legitimidad dentro de una estructura."},
  {n:"Recursos", pe:1, desc:"Acceso a recursos materiales de una organización. No son tuyos — los usas mientras mantienes la afiliación."},
  {n:"Reputación", pe:1, desc:"Suma en enfrentamientos de miradas e intimidación donde tu nombre tenga peso."},
  {n:"Favor a tu favor (menor)", pe:1, desc:"Alguien te debe un favor menor."},
  {n:"Favor a tu favor (serio)", pe:2, desc:"Alguien te debe un favor serio."},
  {n:"Favor a tu favor (se jugó la vida)", pe:3, desc:"Alguien se jugó la vida por ti — te lo debe todo."},
  {n:"Objeto especial", pe:1, desc:"Un objeto con historia que llegó a tus manos antes de que entendieras lo que eras. Tira 1d10+1d8 en la tabla de CAP02."},
  {n:"Runas adicionales", pe:2, desc:"+3 runas en creación (solo Iniciados). Nivel máximo igual al de la toma que las concede."},
  {n:"Nivel de vida", pe:0, desc:"No cuesta PE. Ingreso recurrente: Nivel × 1.000 PC/mes."}
];
const DEFECTOS = [
  {n:"Característica empeorada", pe:2, desc:"−10 a un atributo (mínimo 20)."},
  {n:"Analfabetismo", pe:2, desc:"No sabe leer ni escribir. Cierra puertas que el dinero no siempre abre."},
  {n:"Legalmente inexistente", pe:2, desc:"Sin chip ni registro. Paria legal en cualquier sistema documentado."},
  {n:"Antecedentes penales (menor)", pe:1, desc:"Chip con historial: infracción menor."},
  {n:"Antecedentes penales (grave)", pe:2, desc:"Chip con historial: delito grave."},
  {n:"Antecedentes penales (mayor)", pe:3, desc:"Chip con historial: crimen mayor."},
  {n:"En busca y captura (local)", pe:1, desc:"Te busca una organización local."},
  {n:"En busca y captura (corp menor)", pe:2, desc:"Te busca una corp menor."},
  {n:"En busca y captura (corp mayor)", pe:3, desc:"Te busca una corp mayor, alcance multitesela."},
  {n:"Enemigo (básico)", pe:1, desc:"Alguien te odia personalmente — individuo básico."},
  {n:"Enemigo (con recursos)", pe:2, desc:"Alguien te odia personalmente — tiene recursos."},
  {n:"Enemigo (prioridad)", pe:3, desc:"Alguien poderoso te ha convertido en prioridad."},
  {n:"Deudas (1 punto)", pe:1, desc:"Debes 10.000 PC más intereses."},
  {n:"Deudas (2 puntos)", pe:2, desc:"Debes 20.000 PC más intereses."},
  {n:"Deudas (3 puntos)", pe:3, desc:"Debes 30.000 PC más intereses."},
  {n:"Deuda de honor (menor)", pe:1, desc:"Debes un favor menor."},
  {n:"Deuda de honor (serio)", pe:2, desc:"Debes un favor serio."},
  {n:"Deuda de honor (vida)", pe:3, desc:"Alguien se jugó la vida por ti y ahora se la debes."},
  {n:"Adicto (leve)", pe:1, desc:"Sin la sustancia: efectos secundarios molestos."},
  {n:"Adicto (moderado)", pe:2, desc:"Sin la sustancia: efectos secundarios serios."},
  {n:"Adicto (incapacitante)", pe:3, desc:"Sin la sustancia: incapacitación."},
  {n:"Amnesia", pe:1, desc:"Sin recuerdos anteriores al inicio. El cuerpo sabe lo que hizo; la cabeza no."},
  {n:"Minoría", pe:1, desc:"−20 a la Habilidad efectiva en tiradas Sociales cuando el contexto active prejuicio relevante."},
  {n:"Notoriedad", pe:1, desc:"−20 a la Habilidad efectiva en tiradas Sociales cuando el interlocutor reconoce tu reputación negativa."}
];

let state = {
  step:1,
  dirtyFrom:null,
  pools:{},
  selectedMer:[],
  selectedDef:[],
  runes:[],
  effectiveProfs:[],
  compras:[],
  armadura:null,
  historia:''
};

const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];
// Regla de la casa: cuando queda decimal, SIEMPRE hacia arriba. Es un plus
// deliberado para el jugador. Solo se usa en SKILL_BASE_FORMULA.
// (El Alma accesible es la excepcion escrita: usa suelo, ver CAP02 Paso 3.)
const round = x => Math.ceil(x);

// ===================== VEHÍCULOS (CAP05b) =====================
const VEH_NIVELES = [
  {n:1, tam:"Ligero", huecos:3, maniobra:15, plazas:2, carga:0.2, precio:1000, pde:50},
  {n:2, tam:"Medio", huecos:6, maniobra:5, plazas:5, carga:1, precio:12000, pde:100},
  {n:3, tam:"Grande", huecos:12, maniobra:0, plazas:20, carga:3, precio:60000, pde:300},
  {n:4, tam:"Enorme", huecos:24, maniobra:-5, plazas:50, carga:40, precio:200000, pde:1000},
  {n:5, tam:"Colosal", huecos:48, maniobra:-15, plazas:250, carga:800, precio:1000000, pde:10000},
];
const VEH_CALIDADES = [
  {n:"Básica", precioMult:0.5, maniobra:-5, pdePct:-0.10, huecosAdd:-1},
  {n:"Estándar", precioMult:1, maniobra:0, pdePct:0, huecosAdd:0},
  {n:"Premium", precioMult:2, maniobra:5, pdePct:0.20, huecosAdd:2},
];
const VEH_PROPULSIONES = [
  {n:"Terrestre/Acuático", mult:1, mov:"50 km/h", nt:0},
  {n:"Submarino", mult:2, mov:"100 km/h", nt:4},
  {n:"Aerodeslizador", mult:5, mov:"500 km/h", nt:6},
  {n:"Volador", mult:4, mov:"1.000 km/h", nt:5},
  {n:"AV (aéreo-vehículo)", mult:8, mov:"1.500 km/h", nt:6},
  {n:"Espacial planetario", mult:12, mov:"15.000 km/h", nt:6},
  {n:"Espacial", mult:20, mov:"150.000 km/h", nt:7},
  {n:"Salto", mult:30, mov:"1 año luz", nt:8},
  {n:"Mech (incl. servo)", mult:12, mov:"variable", nt:7},
];
const VEH_BLINDAJES = [
  {n:"Sin blindaje", bld:0, pdeExtra:0, precio:0, maniobra:15, huecos:0},
  {n:"Micro Clase 1", bld:5, pdeExtra:10, precio:5000, maniobra:10, huecos:1},
  {n:"Ligera Clase 1", bld:7, pdeExtra:14, precio:10000, maniobra:5, huecos:1},
  {n:"Media Clase 1", bld:9, pdeExtra:18, precio:20000, maniobra:-10, huecos:2},
  {n:"Dura Clase 1", bld:11, pdeExtra:22, precio:40000, maniobra:-20, huecos:2},
  {n:"Pesada Clase 1", bld:12, pdeExtra:24, precio:60000, maniobra:-25, huecos:3},
  {n:"Asalto Clase 1", bld:15, pdeExtra:30, precio:100000, maniobra:0, huecos:3},
];
const VEH_ARMAS = [
  {n:"Espada Clase 1 (CC energía)", puntería:10, dano:12, precio:7600, huecos:1},
  {n:"Hacha Clase 1 (CC energía)", puntería:0, dano:14, precio:8000, huecos:1},
  {n:"Mazo Clase 1 (CC energía)", puntería:-30, dano:16, precio:7700, huecos:1},
  {n:"Taladro Clase 1 (CC energía)", puntería:-10, dano:11, precio:6500, huecos:1},
  {n:"Guadaña Clase 1 (CC energía)", puntería:-1, dano:14, precio:8300, huecos:1},
  {n:"Pistola láser Clase 1", puntería:0, dano:10, precio:12000, huecos:1},
  {n:"Rifle láser Clase 1", puntería:0, dano:12, precio:17000, huecos:2},
  {n:"Cañón láser Clase 1", puntería:0, dano:15, precio:10600, huecos:2},
  {n:"Torretas láser Clase 1", puntería:0, dano:14, precio:20000, huecos:2},
  {n:"Cañón de plasma Clase 1", puntería:0, dano:17, precio:12600, huecos:2},
  {n:"Gatling Clase 1", puntería:-2, dano:13, precio:14700, huecos:2},
  {n:"Cañón Clase 1 (proyectil)", puntería:0, dano:16, precio:17000, huecos:3},
  {n:"Rifle de pulso Clase 1", puntería:2, dano:0, precio:11100, huecos:1, nota:"No hace daño: dispara ancla, engancha si supera blindaje."},
  {n:"Lanzagranadas Clase 1", puntería:-20, dano:17, precio:9800, huecos:2},
  {n:"Lanzamisiles Clase 1", puntería:0, dano:19, precio:15200, huecos:2},
];
const VEH_COMPLEMENTOS = [
  {n:"Estanco", pctPB:0.5, huecos:0, efecto:"Estanco en cualquier ambiente, 3h autonomía"},
  {n:"Camuflaje pasivo", pctPB:0.1, huecos:1, efecto:"+10 acechar/esconderse"},
  {n:"Camuflaje activo", pctPB:0.5, huecos:1, efecto:"+20 acechar/esconderse"},
  {n:"Servo asistida", pctPB:10, huecos:0, efecto:"Reduce penalizadores de maniobra"},
  {n:"Remolque", pctFinal:0.10, huecos:0, efecto:"−10% maniobra"},
  {n:"Soporte vital (por plaza)", precioPorPlaza:10000, huecos:0, efecto:"Atmósfera y temperatura para humanos"},
  {n:"Sistemas estancos (submarino)", pctPB:2, huecos:0, efecto:"Impermeabilización completa"},
  {n:"Cabina expuesta", precioFijo:-20000, huecos:0, efecto:"+10 maniobra. Cabina puede ser impactada con apuntado cuidadoso"},
  {n:"Segunda mano", pctFinal:-0.5, huecos:0, efecto:"Riesgo de fallo 5-20%"},
];

let vState = { nivel:1, calidad:"Estándar", propulsion:"Terrestre/Acuático", blindaje:"Sin blindaje", armas:[], complementos:[] };

function showMode(m){
  qs('#modoPersonaje').style.display = m==='personaje' ? '' : 'none';
  qs('#modoVehiculo').style.display = m==='vehiculo' ? '' : 'none';
  qs('#modoRefugio').style.display = m==='refugio' ? '' : 'none';
  qs('#modoMaster').style.display = m==='master' ? '' : 'none';
  qs('#modeBtnPersonaje').className = m==='personaje' ? 'btn alt' : 'btn';
  qs('#modeBtnVehiculo').className = m==='vehiculo' ? 'btn alt' : 'btn';
  qs('#modeBtnRefugio').className = m==='refugio' ? 'btn alt' : 'btn';
  qs('#modeBtnMaster').className = m==='master' ? 'btn alt' : 'btn';
  if(m==='vehiculo') renderVehiculo();
  if(m==='refugio') renderRefugios();
}
window.showMode = showMode;

function vehHuecosTotal(){
  const niv = VEH_NIVELES.find(x=>x.n===vState.nivel);
  const cal = VEH_CALIDADES.find(x=>x.n===vState.calidad);
  return niv.huecos + cal.huecosAdd;
}
function vehHuecosUsados(){
  const bl = VEH_BLINDAJES.find(x=>x.n===vState.blindaje);
  const armasH = vState.armas.reduce((s,a)=>s+a.huecos,0);
  const complH = vState.complementos.reduce((s,c)=>s+(c.huecos||0),0);
  return (bl?bl.huecos:0) + armasH + complH;
}
function vehPrecioBase(){
  const niv = VEH_NIVELES.find(x=>x.n===vState.nivel);
  const cal = VEH_CALIDADES.find(x=>x.n===vState.calidad);
  return Math.round(niv.precio * cal.precioMult);
}
function vehPrecioTotal(){
  const niv = VEH_NIVELES.find(x=>x.n===vState.nivel);
  const prop = VEH_PROPULSIONES.find(x=>x.n===vState.propulsion);
  const bl = VEH_BLINDAJES.find(x=>x.n===vState.blindaje);
  const pb = vehPrecioBase();
  let precioProp = Math.round(pb * prop.mult);
  let total = precioProp + (bl?bl.precio:0);
  total += vState.armas.reduce((s,a)=>s+a.precio,0);
  vState.complementos.forEach(c=>{
    if(c.precioFijo!==undefined) total += c.precioFijo;
    if(c.pctPB!==undefined) total += Math.round(pb * c.pctPB);
    if(c.precioPorPlaza!==undefined) total += c.precioPorPlaza * niv.plazas;
  });
  vState.complementos.forEach(c=>{ if(c.pctFinal!==undefined) total += Math.round(total * c.pctFinal); });
  return Math.max(0, Math.round(total));
}
function vehManiobraTotal(){
  const niv = VEH_NIVELES.find(x=>x.n===vState.nivel);
  const cal = VEH_CALIDADES.find(x=>x.n===vState.calidad);
  const bl = VEH_BLINDAJES.find(x=>x.n===vState.blindaje);
  return niv.maniobra + cal.maniobra + (bl?bl.maniobra:0);
}
function vehPdeTotal(){
  const niv = VEH_NIVELES.find(x=>x.n===vState.nivel);
  const cal = VEH_CALIDADES.find(x=>x.n===vState.calidad);
  const bl = VEH_BLINDAJES.find(x=>x.n===vState.blindaje);
  const base = Math.round(niv.pde * (1+cal.pdePct));
  return {estructura: base, extraBlindaje: bl?bl.pdeExtra:0};
}

function buildVehSelects(){
  qs('#vehNivel').innerHTML = VEH_NIVELES.map(v=>`<option value="${v.n}">N${v.n} ${v.tam} — ${v.precio} PC base</option>`).join('');
  qs('#vehCalidad').innerHTML = VEH_CALIDADES.map(v=>`<option>${v.n}</option>`).join('');
  qs('#vehPropulsion').innerHTML = VEH_PROPULSIONES.map(v=>`<option>${v.n}</option>`).join('');
  qs('#vehBlindaje').innerHTML = VEH_BLINDAJES.map(v=>`<option>${v.n}</option>`).join('');
  qs('#vehArmaSelect').innerHTML = VEH_ARMAS.map((a,i)=>`<option value="${i}">${a.n} — Dñ${a.dano} — ${a.precio} PC — ${a.huecos} hueco(s)</option>`).join('');
  qs('#vehComplSelect').innerHTML = VEH_COMPLEMENTOS.map((c,i)=>`<option value="${i}">${c.n} — ${c.efecto}</option>`).join('');
}

function anadirArma(){
  const i = parseInt(qs('#vehArmaSelect').value,10);
  const a = VEH_ARMAS[i];
  if(vehHuecosUsados()+a.huecos > vehHuecosTotal()){ alert('No quedan huecos suficientes.'); return; }
  vState.armas.push({...a});
  renderVehiculo();
}
window.anadirArma = anadirArma;
function quitarArma(i){ vState.armas.splice(i,1); renderVehiculo(); }
window.quitarArma = quitarArma;

function anadirComplemento(){
  const i = parseInt(qs('#vehComplSelect').value,10);
  const c = VEH_COMPLEMENTOS[i];
  if((c.huecos||0) && vehHuecosUsados()+c.huecos > vehHuecosTotal()){ alert('No quedan huecos suficientes.'); return; }
  vState.complementos.push({...c});
  renderVehiculo();
}
window.anadirComplemento = anadirComplemento;
function quitarComplemento(i){ vState.complementos.splice(i,1); renderVehiculo(); }
window.quitarComplemento = quitarComplemento;

function renderVehiculo(){
  vState.nivel = parseInt(qs('#vehNivel')?.value||1,10);
  vState.calidad = qs('#vehCalidad')?.value || "Estándar";
  vState.propulsion = qs('#vehPropulsion')?.value || "Terrestre/Acuático";
  vState.blindaje = qs('#vehBlindaje')?.value || "Sin blindaje";

  const niv = VEH_NIVELES.find(x=>x.n===vState.nivel);
  const prop = VEH_PROPULSIONES.find(x=>x.n===vState.propulsion);
  const bl = VEH_BLINDAJES.find(x=>x.n===vState.blindaje);
  const pde = vehPdeTotal();
  const precio = vehPrecioTotal();
  const presupuesto = parseInt(qs('#vehPresupuesto')?.value||'0',10)||0;
  const huecosT = vehHuecosTotal(), huecosU = vehHuecosUsados();

  qs('#vehArmasLista').innerHTML = vState.armas.length ? vState.armas.map((a,i)=>`<div>${a.n} — Dñ${a.dano}, ${a.precio} PC, ${a.huecos} hueco(s) <button class="btn" type="button" onclick="quitarArma(${i})">Quitar</button></div>`).join('') : '<span class="muted">Sin armas.</span>';
  qs('#vehComplLista').innerHTML = vState.complementos.length ? vState.complementos.map((c,i)=>`<div>${c.n} — ${c.efecto} <button class="btn" type="button" onclick="quitarComplemento(${i})">Quitar</button></div>`).join('') : '<span class="muted">Sin complementos.</span>';

  const sobrepresupuesto = precio > presupuesto;
  qs('#vehResumen').innerHTML = `
    <div><b>Nombre:</b> ${qs('#vehNombre')?.value || '(sin nombre)'}</div>
    <div><b>Nivel:</b> N${niv.n} ${niv.tam} · <b>Calidad:</b> ${vState.calidad} · <b>Propulsión:</b> ${vState.propulsion} (NT mín. ${prop.nt})</div>
    <div><b>Maniobra:</b> ${vehManiobraTotal()} · <b>Velocidad:</b> ${prop.mov} · <b>Plazas:</b> ${niv.plazas} · <b>Carga:</b> ${niv.carga} t</div>
    <div><b>Blindaje:</b> ${bl.bld} · <b>PDE estructura:</b> ${pde.estructura} · <b>PDE extra blindaje:</b> ${pde.extraBlindaje}</div>
    <div><b>Huecos:</b> ${huecosU} / ${huecosT} ${huecosU>huecosT?'⚠️ excedido':''}</div>
    <div style="margin-top:6px"><b>Precio total:</b> <span style="${sobrepresupuesto?'color:#b91c1c;font-weight:bold':''}">${precio} PC</span> — Presupuesto: ${presupuesto} PC ${sobrepresupuesto?'⚠️ por encima del presupuesto':''}</div>
  `;
}
window.renderVehiculo = renderVehiculo;

function resetVehiculo(){
  vState = { nivel:1, calidad:"Estándar", propulsion:"Terrestre/Acuático", blindaje:"Sin blindaje", armas:[], complementos:[] };
  qs('#vehNombre').value=''; qs('#vehNivel').value='1'; qs('#vehCalidad').value='Estándar';
  qs('#vehPropulsion').value='Terrestre/Acuático'; qs('#vehBlindaje').value='Sin blindaje';
  renderVehiculo();
}
window.resetVehiculo = resetVehiculo;

function randomVehiculo(){
  const presupuesto = parseInt(qs('#vehPresupuesto')?.value||'50000',10)||50000;
  vState = { nivel:1, calidad:"Estándar", propulsion:"Terrestre/Acuático", blindaje:"Sin blindaje", armas:[], complementos:[] };
  // Nivel/calidad/propulsión al azar dentro de lo que el presupuesto pueda pagar (aproximado, se ajusta si excede).
  const nivelesOk = VEH_NIVELES.filter(n=>n.precio<=presupuesto);
  vState.nivel = (nivelesOk.length?nivelesOk[Math.floor(Math.random()*nivelesOk.length)]:VEH_NIVELES[0]).n;
  vState.calidad = VEH_CALIDADES[Math.floor(Math.random()*VEH_CALIDADES.length)].n;
  vState.propulsion = VEH_PROPULSIONES[Math.floor(Math.random()*3)].n; // limitado a las 3 más baratas por defecto
  vState.blindaje = VEH_BLINDAJES[Math.floor(Math.random()*4)].n;
  qs('#vehNivel').value = vState.nivel; qs('#vehCalidad').value = vState.calidad;
  qs('#vehPropulsion').value = vState.propulsion; qs('#vehBlindaje').value = vState.blindaje;
  // Añade 0-2 armas y 0-1 complemento si hay huecos y presupuesto, ajustando si se pasa.
  for(let i=0;i<2;i++){
    if(vehHuecosUsados() >= vehHuecosTotal()) break;
    const candidatos = VEH_ARMAS.filter(a=>a.huecos <= (vehHuecosTotal()-vehHuecosUsados()));
    if(!candidatos.length || Math.random()<0.4) continue;
    vState.armas.push({...candidatos[Math.floor(Math.random()*candidatos.length)]});
  }
  if(Math.random()<0.5 && vehHuecosUsados()<vehHuecosTotal()){
    const cIdx = Math.floor(Math.random()*VEH_COMPLEMENTOS.length);
    vState.complementos.push({...VEH_COMPLEMENTOS[cIdx]});
  }
  if(!qs('#vehNombre').value) qs('#vehNombre').value = 'Vehículo sin nombre';
  renderVehiculo();
  guardarVehiculoSnapshot();
}
window.randomVehiculo = randomVehiculo;

let vehiculosGuardados = [];
function guardarVehiculoSnapshot(){
  const niv = VEH_NIVELES.find(x=>x.n===vState.nivel);
  const prop = VEH_PROPULSIONES.find(x=>x.n===vState.propulsion);
  vehiculosGuardados.push({
    nombre: qs('#vehNombre')?.value || 'Vehículo sin nombre',
    resumen: `N${niv.n} ${niv.tam} · ${vState.calidad} · ${vState.propulsion} (${prop.mov}) · Maniobra ${vehManiobraTotal()} · PDE ${vehPdeTotal().estructura}+${vehPdeTotal().extraBlindaje} · ${vState.armas.length} arma(s) · ${vehPrecioTotal().toLocaleString()} PC`
  });
  renderVehiculosGuardados();
}
function quitarVehiculoGuardado(i){ vehiculosGuardados.splice(i,1); renderVehiculosGuardados(); }
window.quitarVehiculoGuardado = quitarVehiculoGuardado;
function renderVehiculosGuardados(){
  const html = vehiculosGuardados.length ? vehiculosGuardados.map((v,i)=>`<div>${v.nombre} — ${v.resumen} <button class="btn" type="button" onclick="quitarVehiculoGuardado(${i})">Quitar</button></div>`).join('') : '<span class="muted">Ningún vehículo generado todavía.</span>';
  const m = qs('#vehiculosGuardadosListaMaster'); if(m) m.innerHTML = html;
}
window.renderVehiculosGuardados = renderVehiculosGuardados;
// ===================== FIN VEHÍCULOS =====================

// ===================== REFUGIOS Y BASES (CAP04d) =====================
const BASES_CFG = [
  {n:"Refugio", desc:"Escondite, piso franco", costeMin:2000, costeMax:10000, tiempo:"Días", mantenimiento:200, dan:"Dormir seguro, almacén pequeño, punto de respaldo de Necrochip"},
  {n:"Puesto", desc:"Pequeña base operativa", costeMin:30000, costeMax:80000, tiempo:"Semanas", mantenimiento:1000, dan:"Taller básico (auto-reparación a mitad de coste, CAP05b), 2-4 de tripulación"},
  {n:"Taller-base", desc:"Centro de operaciones", costeMin:150000, costeMax:500000, tiempo:"1-3 meses", mantenimiento:5000, dan:"Fabricación nivel Norton, hangar de vehículo, red de contactos"},
  {n:"Asentamiento", desc:"Comunidad propia", costeMin:1000000, costeMax:5000000, tiempo:"Meses", mantenimientoTxt:"Salarios de tus Unidades", dan:"Genera ingreso (producción, rentas, servicios)"},
  {n:"Nodo", desc:"Punto de poder en la Urdimbre", costeMin:20000000, costeMax:20000000, tiempo:"Evento de campaña", mantenimientoTxt:"Enorme", dan:"Poder real, y diana para las corps"},
];
let refugios = [];

function buildRefSelect(){
  qs('#refNivel').innerHTML = BASES_CFG.map(b=>`<option>${b.n}</option>`).join('');
  renderRefugioForm();
}
function currentBaseCfg(){ return BASES_CFG.find(b=>b.n===(qs('#refNivel')?.value||"Refugio")); }
function renderRefugioForm(){
  const b = currentBaseCfg();
  if(!b) return;
  qs('#refInfo').innerHTML = `${b.desc} — Rango: ${b.costeMin.toLocaleString()}-${b.costeMax.toLocaleString()} PC · Tiempo: ${b.tiempo} · Mantenimiento/mes: ${b.mantenimiento?b.mantenimiento.toLocaleString()+' PC':b.mantenimientoTxt} · Da: ${b.dan}`;
  if(!qs('#refCoste').value) qs('#refCoste').value = b.costeMin;
}
window.renderRefugioForm = renderRefugioForm;

function anadirRefugio(){
  const b = currentBaseCfg();
  const tomado = qs('#refTomado').value === 'si';
  let coste = parseInt(qs('#refCoste').value||b.costeMin,10) || b.costeMin;
  if(coste < b.costeMin || coste > b.costeMax){ alert(`El coste debe estar entre ${b.costeMin} y ${b.costeMax} PC para un ${b.n}.`); return; }
  if(tomado) coste = Math.round(coste*0.5);
  refugios.push({
    nivel: b.n, nombre: qs('#refNombre').value || `(${b.n} sin nombre)`,
    coste, tomado, mantenimiento: b.mantenimiento || null, mantenimientoTxt: b.mantenimientoTxt || null,
    dan: b.dan, tiempo: b.tiempo
  });
  qs('#refNombre').value='';
  renderRefugios();
}
window.anadirRefugio = anadirRefugio;

function quitarRefugio(i){ refugios.splice(i,1); renderRefugios(); }
window.quitarRefugio = quitarRefugio;

function renderRefugios(){
  const presupuesto = parseInt(qs('#refPresupuesto')?.value||'0',10)||0;
  const lista = qs('#refugiosLista');
  const html = refugios.length ? refugios.map((r,i)=>`<div>${r.nombre} — <b>${r.nivel}</b> (${r.coste.toLocaleString()} PC${r.tomado?', tomado — hereda Tabla 4 y Rasgo Distintivo como complicaciones':''}), mantenimiento ${r.mantenimiento?r.mantenimiento.toLocaleString()+' PC/mes':r.mantenimientoTxt} · ${r.dan} <button class="btn" type="button" onclick="quitarRefugio(${i})">Quitar</button></div>`).join('') : '<span class="muted">Sin propiedades todavía.</span>';
  if(lista) lista.innerHTML = html;
  const mLista = qs('#refugiosListaMaster'); if(mLista) mLista.innerHTML = html;
  const totalCoste = refugios.reduce((s,r)=>s+r.coste,0);
  const totalMant = refugios.reduce((s,r)=>s+(r.mantenimiento||0),0);
  const sobrepresupuesto = totalCoste > presupuesto;
  const resumenHtml = `<b>Coste total:</b> <span style="${sobrepresupuesto?'color:#b91c1c;font-weight:bold':''}">${totalCoste.toLocaleString()} PC</span> — Presupuesto: ${presupuesto.toLocaleString()} PC ${sobrepresupuesto?'⚠️ por encima del presupuesto':''}<br><b>Mantenimiento mensual total (numérico):</b> ${totalMant.toLocaleString()} PC/mes${refugios.some(r=>r.mantenimientoTxt)?' + mantenimientos narrativos (Asentamiento/Nodo)':''}`;
  if(qs('#refResumen')) qs('#refResumen').innerHTML = resumenHtml;
}
window.renderRefugios = renderRefugios;

function resetRefugioForm(){
  qs('#refNombre').value=''; qs('#refNivel').value='Refugio'; qs('#refTomado').value='no';
  renderRefugioForm();
}
window.resetRefugioForm = resetRefugioForm;

function randomRefugio(){
  const presupuesto = parseInt(qs('#refPresupuesto')?.value||'50000',10)||50000;
  const candidatos = BASES_CFG.filter(b=>b.costeMin<=presupuesto);
  const b = candidatos.length ? candidatos[Math.floor(Math.random()*candidatos.length)] : BASES_CFG[0];
  const maxDentroPresupuesto = Math.min(b.costeMax, presupuesto);
  const coste = b.costeMin + Math.floor(Math.random()*Math.max(1,(maxDentroPresupuesto-b.costeMin)));
  qs('#refNivel').value = b.n;
  qs('#refNombre').value = `${b.n} sin nombre`;
  qs('#refCoste').value = coste;
  qs('#refTomado').value = Math.random()<0.3 ? 'si' : 'no';
  renderRefugioForm();
  anadirRefugio();
}
window.randomRefugio = randomRefugio;
// ===================== FIN REFUGIOS Y BASES =====================

// ===================== HISTORIA BREVE (plantilla, sin IA — ver nota a Miguel) =====================
const HIST_APERTURA = [
  "Nadie recuerda bien cómo llegó {nombre} al grupo, pero nadie duda ya de que se quede.",
  "{nombre} no habla mucho de antes de esto. Lo poco que se sabe, se sabe por terceros.",
  "Hay quien jura que {nombre} ya había cruzado tres teselas antes de que empezara esta historia.",
  "{nombre} llegó con lo puesto y una historia que cambia cada vez que la cuenta.",
  "Pocos saben qué trae {nombre} entre manos. Menos aún se atreven a preguntar dos veces.",
];
const HIST_RAZA = {
  "Humano": "Humano de origen, sin marcas que lo delaten a primera vista.",
  "Nakel": "Nakel — algo en él intuye tecnología antigua que no debería reconocer.",
  "Inukel": "Inukel, con esa calma que solo dan generaciones de adaptarse a lo peor.",
  "Kawalapiti": "Kawalapiti, más resistente de lo que su porte sugiere.",
  "Chernos": "Chernos, marcado por algo que la mayoría prefiere no preguntar.",
  "Mujer Gato": "De sangre felina, con reflejos que traicionan cualquier disfraz de calma.",
  "Hombre Gato": "De sangre felina, con reflejos que traicionan cualquier disfraz de calma.",
  "Droideum": "Un chasis que a veces piensa que fue humano alguna vez, o que finge creerlo.",
};
const HIST_PROF = {
  "Civil": "sabe moverse en salones y despachos igual de bien que en la calle",
  "Combatiente": "ha visto suficiente combate como para no necesitar impresionar a nadie",
  "Especialista Técnico": "arregla lo que sea con lo que tenga a mano, y lo que no tiene, lo improvisa",
  "Científico": "hace preguntas que incomodan porque casi siempre tiene razón",
  "Iniciado": "lleva la Distorsión en la sangre de una forma que todavía está aprendiendo a nombrar",
};
const HIST_CIERRE = [
  "Todavía no ha decidido si esto es una segunda oportunidad o solo otro trabajo.",
  "Lo que quiere de verdad no lo ha dicho todavía — puede que ni él mismo lo sepa.",
  "Sigue aquí. Eso, de momento, es toda la explicación que da.",
  "Cuenta los días de otra forma desde que cruzó la primera vez.",
  "Alguien de su pasado sigue sin saber dónde está. Mejor así, dice él.",
];

function generarHistoriaBreve(){
  const nombre = qs('#personaje')?.value || 'Este errante';
  const raza = qs('#raza')?.value || 'Humano';
  const profs = effectiveProfs();
  const profTxt = profs.length ? (HIST_PROF[profs[0]] || 'todavía no encuentra su sitio') : 'todavía no encuentra su sitio';
  const apertura = randomChoice(HIST_APERTURA).replace('{nombre}', nombre);
  const razaTxt = HIST_RAZA[raza] || '';
  const cierre = randomChoice(HIST_CIERRE);
  state.historia = `${apertura} ${razaTxt} Además, ${profTxt}. ${cierre}`;
  return state.historia;
}
window.generarHistoriaBreve = generarHistoriaBreve;
// ===================== FIN HISTORIA BREVE =====================
let pnjs = [];

function generarPNJ(){
  qs('#tipoPersonaje').value = qs('#pnjTipo').value;
  randomTypeData();
  qs('#tipoPersonaje').value = qs('#pnjTipo').value; // randomTypeData no toca tipo; nos aseguramos igualmente
  enforcePgLimits(); recalcAttr(); rebuildPools(); rebuildEconomy();
  randomAttrs();
  enforcePgLimits(); recalcAttr(); recalcSkillBases();
  randomProfs();
  rebuildPools(); rebuildEconomy(); recalcSkillBases(); renderRunes();
  randomSkills();
  calcSkills(); renderStatsDerivados(); rebuildEconomy();
  const historiaPnj = generarHistoriaBreve();

  const attrsTxt = ATTRS.map(a=>`${a} ${attr(a)}`).join(' · ');
  const skillTop = qsa('.sk-tot').map(t=>{
    const r=t.dataset.r, i=parseInt(t.dataset.i,10);
    return {name: `${SKILLS[r][i]}`, v: parseInt(t.value,10)||0};
  }).sort((a,b)=>b.v-a.v).slice(0,4);
  const vidaTxt = (qs('#statsDerivadosBox').textContent.match(/PV base:\s*(\d+)/)||[])[1] || '?';

  pnjs.push({
    nombre: qs('#personaje').value, raza: qs('#raza').value, tipo: qs('#tipoPersonaje').value,
    profesiones: effectiveProfs().join(', ') || '—', attrs: attrsTxt, vida: vidaTxt,
    skills: skillTop.map(s=>`${s.name} ${s.v}%`).join(' · '), historia: historiaPnj
  });
  renderPNJs();
}
window.generarPNJ = generarPNJ;

function quitarPNJ(i){ pnjs.splice(i,1); renderPNJs(); }
window.quitarPNJ = quitarPNJ;

function renderPNJs(){
  const l = qs('#pnjLista');
  l.innerHTML = pnjs.length ? pnjs.map((p,i)=>`<div class="box" style="margin-top:6px"><b>${p.nombre}</b> — ${p.raza}, ${p.tipo} (${p.profesiones})<br>PV base: ${p.vida} · ${p.attrs}<br>Destaca en: ${p.skills}<br><i>${p.historia||''}</i> <button class="btn" type="button" onclick="quitarPNJ(${i})">Quitar</button></div>`).join('') : '<span class="muted">Ningún PNJ generado todavía.</span>';
}
window.renderPNJs = renderPNJs;

// Generador de semillas de aventura — combina categorías, no digitaliza las semillas fijas de CAP08 §6.
const SEMILLA_TIPO = ["Rescate","Recuperación de objeto","Escolta","Investigación","Sabotaje","Infiltración","Extracción","Negociación","Persecución","Defensa"];
const SEMILLA_CORP = ["Chafry","TecnoStealer","Serpent","Primus","Mort","Workhouse","Pseudo-Arkanitas","ninguna corp — cliente independiente"];
const SEMILLA_LOC = ["Mundo Máquina","Cuenca Gótica","Tierra-12","La Ciudad Subterránea","Bosque Sombrío","Desierto de Huesos","Ruinas de la Antigua Ciudad","Laboratorio Clandestino","Territorio Corrupto"];
const SEMILLA_COMPL = [
  "el cliente miente sobre el objetivo real",
  "hay un traidor entre los contratantes",
  "el plazo es mucho más corto de lo prometido",
  "otra facción quiere lo mismo",
  "el objetivo no quiere ser rescatado/recuperado",
  "la información de partida está desactualizada o es falsa",
  "el pasado de un miembro del grupo está involucrado",
  "el trabajo obliga a cruzar a una tesela bloqueada o restringida",
];
const SEMILLA_RECOMPENSA = [
  "acceso a tecnología rara",
  "un favor de alguien poderoso",
  "información comprometedora sobre una corp",
  "un Necrochip recuperado",
  "una base o territorio abandonado",
  "solo el dinero acordado — nada más",
];
let semillas = [];
function generarSemilla(){
  const texto = `${randomChoice(SEMILLA_TIPO)} para ${randomChoice(SEMILLA_CORP)} en ${randomChoice(SEMILLA_LOC)}. Complicación: ${randomChoice(SEMILLA_COMPL)}. Recompensa extra: ${randomChoice(SEMILLA_RECOMPENSA)}.`;
  semillas.push(texto);
  renderSemillas();
}
window.generarSemilla = generarSemilla;
function quitarSemilla(i){ semillas.splice(i,1); renderSemillas(); }
window.quitarSemilla = quitarSemilla;
function renderSemillas(){
  const l = qs('#semillasLista');
  l.innerHTML = semillas.length ? semillas.map((s,i)=>`<div>${s} <button class="btn" type="button" onclick="quitarSemilla(${i})">Quitar</button></div>`).join('') : '<span class="muted">Ninguna semilla generada todavía.</span>';
}
window.renderSemillas = renderSemillas;
// ===================== FIN HERRAMIENTAS DEL NARRADOR =====================

// ===================== GENERADOR DE ASENTAMIENTOS (Anexo) =====================
function d(n){ return Math.floor(Math.random()*n)+1; }

const AST_NT = [
  {nt:"NT 1-2", val:2, desc:"Primitivo. Herramientas manuales, sin energía estable. Supervivencia básica."},
  {nt:"NT 2-3", val:3, desc:"Pre-industrial. Energía mecánica, metalurgia básica. Sin electrónica."},
  {nt:"NT 3-4", val:4, desc:"Industrial temprano. Electricidad, motores de combustión, radio básica."},
  {nt:"NT 4-5", val:5, desc:"Industrial avanzado. Electrónica, medicina funcional, comunicaciones."},
  {nt:"NT 5", val:5, desc:"Moderno bajo. Informática básica, cirugía, vehículos motorizados comunes."},
  {nt:"NT 5-6", val:6, desc:"Moderno. Redes, implantes simples, naves atmosféricas."},
  {nt:"NT 6-7", val:7, desc:"Avanzado. Implantes medios, naves orbitales, IA simples."},
  {nt:"NT 7-8", val:8, desc:"Alto. Implantes mayores, motores de salto, Necrochips estándar."},
  {nt:"NT 8-9", val:9, desc:"Muy alto. Tecnología de los Antiguos parcialmente activa o replicada."},
  {nt:"Mixto", val:9, desc:"Combina dos niveles. Tira dos veces y elige el más dramático."},
];
const AST_TIPO = [
  {n:"Aldea de subsistencia", ntMin:0, desc:"Unas decenas de personas. Cultivos, animales, sin infraestructura."},
  {n:"Aldea de subsistencia", ntMin:0, desc:"Unas decenas de personas. Cultivos, animales, sin infraestructura."},
  {n:"Campamento nómada", ntMin:0, desc:"Sin ubicación fija. Se mueve con la estación o la necesidad."},
  {n:"Puesto de avanzada", ntMin:0, desc:"Pequeño grupo en territorio hostil. Depende de suministros externos."},
  {n:"Asentamiento minero", ntMin:3, desc:"Extracción de recursos. Puede tener Helio-3 si es el recurso que explotan."},
  {n:"Pueblo comercial", ntMin:3, desc:"Nodo de intercambio para la región. Mercado básico."},
  {n:"Fortaleza o bastión", ntMin:2, desc:"Función defensiva primaria. Puede ser de cualquier facción."},
  {n:"Ciudad pequeña", ntMin:4, desc:"Infraestructura urbana básica. Servicios mínimos."},
  {n:"Ciudad industrial", ntMin:5, desc:"Producción como eje. Contaminación, barrios obreros, tensión social."},
  {n:"Puerto o muelle orbital bajo", ntMin:6, desc:"Tráfico de naves atmosféricas y suborbitales. Mercado de paso."},
  {n:"Estación orbital menor", ntMin:7, desc:"Infraestructura fija en órbita. Capacidad limitada."},
  {n:"Nodo de tránsito", ntMin:6, desc:"Punto de conexión entre rutas. Sin población fija relevante."},
  {n:"Instalación corporativa", ntMin:5, desc:"Propiedad de una corp. Acceso restringido. Tiene su propia lógica."},
  {n:"Asentamiento refugiado", ntMin:3, desc:"Gente que llegó huyendo de algo. Infraestructura improvisada. Tensión alta."},
  {n:"Ruinas habitadas", ntMin:0, desc:"Estructura antigua ocupada por supervivientes. Mezcla de NT."},
  {n:"Estación de investigación", ntMin:7, desc:"Científicos, datos, acceso restringido. Algo que estudian activamente."},
  {n:"Comunidad autónoma", ntMin:4, desc:"Sin corp dominante por elección. Autogestionada. Desconfianza a extraños."},
  {n:"Ciudad flotante / orbital media", ntMin:7, desc:"Infraestructura significativa. Población permanente. Política interna."},
  {n:"Hub de contrabando", ntMin:5, desc:"Todo se consigue, nada es oficial. Presencia corp nula o comprada."},
  {n:"Elige o combina dos", ntMin:0, desc:"El DJ elige el que mejor encaje o combina dos resultados adyacentes."},
];
const AST_SUMINISTROS = [
  {rango:[1,2], n:"Escasez crítica", helio:"No", comida:"Racionada", basico:"Casi nada", avanzado:"Nada"},
  {rango:[3,4], n:"Escasez severa", helio:"No", comida:"Escasa", basico:"Poco", avanzado:"Nada"},
  {rango:[5,6], n:"Escasez moderada", helio:"Raro / caro", comida:"Suficiente", basico:"Básico", avanzado:"Muy poco"},
  {rango:[7,9], n:"Ajustado", helio:"Poco / caro", comida:"Suficiente", basico:"Básico", avanzado:"Escaso"},
  {rango:[10,12], n:"Normal", helio:"Disponible", comida:"Bien", basico:"Bien", avanzado:"Limitado"},
  {rango:[13,15], n:"Bueno", helio:"Disponible", comida:"Abundante", basico:"Bien", avanzado:"Disponible"},
  {rango:[16,17], n:"Abundante", helio:"Barato", comida:"Abundante", basico:"Abundante", avanzado:"Bien"},
  {rango:[18,19], n:"Excedente", helio:"Muy barato", comida:"Excedente", basico:"Excedente", avanzado:"Disponible"},
  {rango:[20,20], n:"Centro de distribución", helio:"De todo", comida:"De todo", basico:"De todo", avanzado:"De todo (precio alto)"},
];
const AST_ARTESANOS = [
  {rango:[1,4], n:"Ninguno destacable", ntMin:0, desc:"Los artesanos locales son competentes pero no memorables."},
  {rango:[5,6], n:"Herrero excepcional", ntMin:0, desc:"Trabaja metales con técnica inusual. Piezas que duran décadas."},
  {rango:[7,7], n:"Médico / Curandero atípico", ntMin:2, desc:"Combina métodos locales con conocimiento de otro origen. Hace preguntas."},
  {rango:[8,8], n:"Mecánico de lo imposible", ntMin:4, desc:"Repara cualquier cosa con lo que tiene a mano. No sabe cómo lo hace."},
  {rango:[9,9], n:"Fabricante de armas", ntMin:3, desc:"Armas a medida. Calidad superior. No vende a desconocidos sin referencia."},
  {rango:[10,10], n:"Informante / Archivista", ntMin:3, desc:"Guarda registros de todo. Tiene información de valor. Tiene precio."},
  {rango:[11,11], n:"Tatuador / Modificador corporal", ntMin:4, desc:"Modificaciones estéticas y funcionales sin pasar por corp. Discreto."},
  {rango:[12,12], n:"Químico independiente", ntMin:5, desc:"Produce compuestos que no existen en el catálogo oficial. Algunos son útiles."},
  {rango:[13,13], n:"Piloto retirado", ntMin:6, desc:"Conoce rutas que no están en ningún mapa. Puede contratarse."},
  {rango:[14,14], n:"Técnico de implantes sin registro", ntMin:6, desc:"Implantes sin paperwork. Sin garantía. Sin preguntas."},
  {rango:[15,15], n:"Especialista en tecnología antigua", ntMin:4, desc:"Identifica y a veces activa artefactos de los Antiguos. No sabe de dónde viene su conocimiento."},
  {rango:[16,16], n:"Constructor naval artesanal", ntMin:6, desc:"Naves pequeñas construidas a mano. Lentas pero casi indestructibles."},
  {rango:[17,17], n:"IA independiente (cuerpo físico)", ntMin:7, desc:"Lleva aquí más tiempo del que admite. Observa. Tiene agenda propia."},
  {rango:[18,18], n:"Maestro de Distorsión menor", ntMin:5, desc:"No es un Maestro de Portales — pero manipula la distorsión de formas pequeñas y útiles."},
  {rango:[19,19], n:"Nakel con conocimiento heredado", ntMin:4, desc:"Intuye tecnología antigua sin formación. No sabe por qué."},
  {rango:[20,20], n:"Figura legendaria en retiro", ntMin:0, desc:"Alguien que fue importante en otra parte. Está aquí porque no quiere que lo encuentren."},
];
const AST_CORPS = [
  {rango:[1,3], n:"Ninguna", desc:"Sin corps. Sin logos, sin agentes, sin contratos. La gente lo valora o lo teme."},
  {rango:[4,5], n:"Ninguna (activa)", desc:"Las corps saben que existe pero no han enviado a nadie todavía."},
  {rango:[6,7], n:"Rastros abandonados", desc:"Hubo presencia corp. Ya no. Quedan infraestructura, contratos rotos y gente amargada."},
  {rango:[8,9], n:"No oficial — comercial", desc:"Representante o distribuidor de una corp, sin acreditación oficial. Negocia en gris."},
  {rango:[10,11], n:"No oficial — inteligencia", desc:"Agente de Serpent o similar. No se identifica. Observa. Puede ser contactable."},
  {rango:[12,13], n:"Oficial menor", desc:"Oficina pequeña de una corp. Presencia simbólica, poco poder real."},
  {rango:[14,15], n:"Oficial establecida", desc:"Una corp con infraestructura real. Contrata local, tiene agenda, tiene enemigos."},
  {rango:[16,17], n:"Dos corps en tensión", desc:"Dos facciones con intereses opuestos. El asentamiento está en medio."},
  {rango:[18,18], n:"Control corporativo total", desc:"Una corp lo controla todo. Ley, suministros, información. Puede ser Mort, Workhouse o similar."},
  {rango:[19,19], n:"Presencia Primus", desc:"Agentes o estructura de Primus. Pueden ser protectores, vigilantes o ambas cosas."},
  {rango:[20,20], n:"Situación en conflicto", desc:"Tira dos veces. Las dos presencias coexisten en tensión activa."},
];
const AST_RASGO = [
  "Tiene un portal. Nadie sabe a dónde lleva. Nadie lo ha cruzado en años.",
  "Siempre hay niebla. Natural, de distorsión, o algo entre medias. Visibilidad reducida permanente.",
  "La fauna local no es hostil pero tampoco le tiene miedo a nadie.",
  "Hay un barrio entero que habla un idioma que nadie identifica.",
  "Algo se avería aquí con frecuencia inusual. Nadie sabe por qué.",
  "Hay una estructura de los Antiguos en el centro. Nadie la toca. Nadie sabe qué hace.",
  "El tiempo no cuadra. Llevas dos horas dentro pero fuera han pasado cuatro. O al revés.",
  "Hay una facción local sin afiliación conocida que tiene más poder del que debería.",
  "Todo el mundo aquí tiene tatuajes del mismo diseño. Nadie explica por qué.",
  "El lugar huele a algo que no debería existir en ese entorno.",
  "Hay un mercado de información. No de bienes — solo información.",
  "Alguien aquí lleva décadas esperando a alguien que no ha llegado.",
  "Los droides y las IAs son tratados como ciudadanos con derechos. Es una política, no una costumbre.",
  "Hay una zona del asentamiento a la que nadie va de noche. Nadie dice por qué.",
  "El lugar fue construido sobre otra cosa. Se oye a veces algo debajo.",
  "La corp que lo controla tiene una política interna que resulta extrañamente humana.",
  "Hay un Nakel que lleva aquí más tiempo del que cualquiera recuerda.",
  "Tienen una fiesta o ritual colectivo que ocurre sin aviso. El asentamiento se paraliza.",
  "Alguien aquí tiene información sobre Seawolf. No lo sabe todavía.",
  "El DJ elige. Si no tiene idea, combina el resultado 7 con otro a su elección.",
];

function findByRango(tabla, roll){ return tabla.find(t=>roll>=t.rango[0] && roll<=t.rango[1]); }
function rollFiltradoPorNT(tabla, ntVal, maxIntentos=15){
  for(let i=0;i<maxIntentos;i++){
    const roll = d(20);
    const entry = 'rango' in tabla[0] ? findByRango(tabla, roll) : tabla[roll-1];
    if((entry.ntMin||0) <= ntVal) return entry;
  }
  // Si tras varios intentos no hay suerte, usar el primero válido de la tabla (regla: "usa el resultado anterior/siguiente").
  return tabla.find(e=>(e.ntMin||0) <= ntVal) || tabla[0];
}

// NT: 1d20 ponderado (no 1d10 plano). NT8-9 y Mixto quedan fuera de la tirada al azar —
// son de trama/decisión del DJ, no algo que salga solo. 1-2 son posibles pero raros (5% cada uno).
// NT5/NT5-6 son lo habitual en la Urdimbre (50% combinado).
const AST_NT_TABLA = [
  {rango:[1,1], idx:0},   // NT1-2 Primitivo — 5%
  {rango:[2,2], idx:1},   // NT2-3 Pre-industrial — 5%
  {rango:[3,4], idx:2},   // NT3-4 Industrial temprano — 10%
  {rango:[5,7], idx:3},   // NT4-5 Industrial avanzado — 15%
  {rango:[8,12], idx:4},  // NT5 Moderno bajo — 25%
  {rango:[13,17], idx:5}, // NT5-6 Moderno — 25%
  {rango:[18,19], idx:6}, // NT6-7 Avanzado — 10%
  {rango:[20,20], idx:7}, // NT7-8 Alto — 5%
];
function rollAstNT(){
  const roll = d(20);
  const entry = AST_NT_TABLA.find(t=>roll>=t.rango[0] && roll<=t.rango[1]);
  return AST_NT[entry.idx];
}

function generarAsentamiento(){
  const ntEntry = rollAstNT();
  const tipoEntry = rollFiltradoPorNT(AST_TIPO, ntEntry.val);
  const sumEntry = findByRango(AST_SUMINISTROS, d(20));
  const artEntry = rollFiltradoPorNT(AST_ARTESANOS, ntEntry.val);
  const corpEntry = findByRango(AST_CORPS, d(20));
  const rasgo = randomChoice(AST_RASGO);

  asentamientos.push({
    nt: ntEntry, tipo: tipoEntry, sum: sumEntry, art: artEntry, corp: corpEntry, rasgo
  });
  renderAsentamientos();
}
window.generarAsentamiento = generarAsentamiento;

let asentamientos = [];
function quitarAsentamiento(i){ asentamientos.splice(i,1); renderAsentamientos(); }
window.quitarAsentamiento = quitarAsentamiento;
function renderAsentamientos(){
  const l = qs('#asentamientosLista');
  l.innerHTML = asentamientos.length ? asentamientos.map((a,i)=>`
    <div class="box" style="margin-top:6px">
      <div><b>${a.tipo.n}</b> — ${a.nt.nt}: ${a.nt.desc}</div>
      <div class="muted">${a.tipo.desc}</div>
      <div><b>Suministros:</b> ${a.sum.n} — Helio-3: ${a.sum.helio} · Comida: ${a.sum.comida} · Eq. básico: ${a.sum.basico} · Eq. avanzado: ${a.sum.avanzado}</div>
      <div><b>Artesano singular:</b> ${a.art.n} — ${a.art.desc}</div>
      <div><b>Presencia corporativa:</b> ${a.corp.n} — ${a.corp.desc}</div>
      <div><b>Rasgo distintivo:</b> ${a.rasgo}</div>
      <button class="btn" type="button" onclick="quitarAsentamiento(${i})">Quitar</button>
    </div>`).join('') : '<span class="muted">Ningún asentamiento generado todavía.</span>';
}
window.renderAsentamientos = renderAsentamientos;
// ===================== FIN GENERADOR DE ASENTAMIENTOS =====================

const ARMADURAS = [
  {n:"Sin blindaje", bld:0, precio:0},
  {n:"Ligera (Bld 1)", bld:1, precio:900},
  {n:"Ligera Avanzada (Bld 2)", bld:2, precio:1800},
  {n:"Media (Bld 3)", bld:3, precio:3600},
  {n:"Pesada (Bld 4)", bld:4, precio:7200},
  {n:"Acorazada (Bld 5)", bld:5, precio:14000},
];

const IMPL_ATRIB = [
  {id:"F10",n:"Forge-F10 Muscular Synth",attr:"F",bonus:10,hum:5,precio:20000},
  {id:"F15",n:"Forge-F15 Muscular Synth",attr:"F",bonus:15,hum:10,precio:40000},
  {id:"F20",n:"Forge-F20 Titan Core",attr:"F",bonus:20,hum:20,precio:60000},
  {id:"A10",n:"Forge-A10 Tendon Wire",attr:"A",bonus:10,hum:5,precio:20000},
  {id:"A15",n:"Forge-A15 Tendon Wire",attr:"A",bonus:15,hum:10,precio:40000},
  {id:"A20",n:"Forge-A20 Reflex Frame",attr:"A",bonus:20,hum:20,precio:60000},
  {id:"C10",n:"Forge-C10 Bone Lattice",attr:"C",bonus:10,hum:5,precio:20000},
  {id:"C15",n:"Forge-C15 Bone Lattice",attr:"C",bonus:15,hum:10,precio:40000},
  {id:"C20",n:"Forge-C20 Iron Shell",attr:"C",bonus:20,hum:20,precio:60000},
  {id:"H10",n:"Forge-H10 Precision Hand",attr:"H",bonus:10,hum:5,precio:20000},
  {id:"H15",n:"Forge-H15 Precision Hand",attr:"H",bonus:15,hum:10,precio:40000},
  {id:"H20",n:"Forge-H20 Mastercraft Arm",attr:"H",bonus:20,hum:20,precio:60000},
  {id:"I10",n:"Ibis-I10 Cortex Boost",attr:"I",bonus:10,hum:5,precio:20000},
  {id:"I15",n:"Ibis-I15 Cortex Boost",attr:"I",bonus:15,hum:10,precio:40000},
  {id:"I20",n:"Ibis-I20 Apex Mind",attr:"I",bonus:20,hum:20,precio:60000},
  {id:"P10",n:"Ibis-P10 Sensor Array",attr:"P",bonus:10,hum:5,precio:20000},
  {id:"P15",n:"Ibis-P15 Sensor Array",attr:"P",bonus:15,hum:10,precio:40000},
  {id:"P20",n:"Ibis-P20 Horizon Eye",attr:"P",bonus:20,hum:20,precio:60000},
  {id:"V10",n:"Ibis-V10 Will Core",attr:"V",bonus:10,hum:5,precio:20000},
  {id:"V15",n:"Ibis-V15 Will Core",attr:"V",bonus:15,hum:10,precio:40000},
  {id:"V20",n:"Ibis-V20 Iron Will",attr:"V",bonus:20,hum:20,precio:60000},
  {id:"Ca10",n:"Ibis-Ca10 Social Interface",attr:"Ca",bonus:10,hum:5,precio:20000},
  {id:"Ca15",n:"Ibis-Ca15 Social Interface",attr:"Ca",bonus:15,hum:10,precio:40000},
  {id:"Ca20",n:"Ibis-Ca20 Charisma Core",attr:"Ca",bonus:20,hum:20,precio:60000},
];

const IMPL_HAB = [
  {id:"toolMk1",n:"Forge Tool-Hand Mk1",zona:"Brazo D",efecto:"+5 técnicas con herramientas / elimina penalizador equipo básico",hum:5,precio:5000},
  {id:"toolMk2",n:"Forge Tool-Hand Mk2",zona:"Brazo D",efecto:"+10 técnicas / elimina penalizador equipo inadecuado",hum:5,precio:50000},
  {id:"swim",n:"Forge Swim-Limb",zona:"Pierna D",efecto:"Elimina penalizador natación / +10 natación",hum:5,precio:5000},
  {id:"grip",n:"Forge Grip-Sole",zona:"Pierna I",efecto:"Elimina penalizador escalada / +5 escalada",hum:5,precio:5000},
  {id:"shock",n:"Forge Shock-Leg",zona:"Pierna D",efecto:"Elimina daño caídas ≤3m / mitad daño caídas mayores",hum:5,precio:8000},
  {id:"subMk1",n:"Forge Subdermal Mk1",zona:"Sistema Óseo",efecto:"+1 blindaje natural, todas las zonas",hum:10,precio:30000},
  {id:"subMk2",n:"Forge Subdermal Mk2",zona:"Sistema Óseo",efecto:"+2 blindaje natural, todas las zonas",hum:20,precio:80000},
  {id:"extra",n:"Forge Extra-Limb",zona:"Sistema Muscular",efecto:"Ataque adicional a mitad CC / +1 acción de manipulación",hum:20,precio:120000},
  {id:"nightMk1",n:"Ibis Night-Eye Mk1",zona:"Ojos",efecto:"Elimina penalizador oscuridad parcial / −10 oscuridad total",hum:5,precio:10000},
  {id:"nightMk2",n:"Ibis Night-Eye Mk2",zona:"Ojos",efecto:"Elimina penalizador oscuridad total",hum:10,precio:100000},
  {id:"zoom",n:"Ibis Zoom-Eye",zona:"Ojos",efecto:"Elimina penalizador distancia ≤200m / +5 precisión distancia",hum:5,precio:15000},
  {id:"thermal",n:"Ibis Thermal-Eye",zona:"Ojos",efecto:"Detecta calor en oscuridad / +10 Alerta contra ocultos",hum:5,precio:20000,skillBonus:{rama:'combate',name:'Alerta',val:10}},
  {id:"reflexMk1",n:"Ibis Reflex-Chip Mk1",zona:"Sistema Neural",efecto:"+10 Iniciativa",hum:5,precio:25000,skillBonus:{rama:'combate',name:'Iniciativa',val:10}},
  {id:"reflexMk2",n:"Ibis Reflex-Chip Mk2",zona:"Sistema Neural",efecto:"+20 Iniciativa",hum:10,precio:100000,skillBonus:{rama:'combate',name:'Iniciativa',val:20}},
  {id:"audio",n:"Ibis Audio-Amp",zona:"Sistema Neural",efecto:"Elimina penalizador ruido / +5 escucha",hum:5,precio:8000},
  {id:"lang",n:"Ibis Lang-Chip",zona:"Sistema Neural",efecto:"Comprensión básica de idiomas del mosaico",hum:5,precio:30000},
  {id:"neuralRack",n:"Ibis Neural-Rack",zona:"Sistema Neural",efecto:"Rack de Chips implantado al 40% (en vez de 30%)",hum:10,precio:50000},
  {id:"hollowCache",n:"Forge Hollow Cache",zona:"Torso",efecto:"Compartimento oculto, ~1kg o un objeto pequeño. Detectarlo requiere escáner específico o Diagnóstico difícil",hum:5,precio:10000},
  {id:"retractoClaws",n:"Forge Retracto-Claws",zona:"Brazo D",efecto:"Garras retráctiles, arma CC natural (daño tipo cuchillo). Retraídas, invisibles y sin penalizador de ocultación",hum:10,precio:25000},
  {id:"talonClaws",n:"Forge Talon-Claws",zona:"Brazo D",efecto:"Garras pesadas fijas, más daño que Retracto-Claws. Siempre visibles, marca corporal permanente",hum:15,precio:45000},
  {id:"venomGland",n:"Forge Venom-Gland",zona:"Brazo D",efecto:"Requiere Retracto-Claws o Talon-Claws instaladas. Cada impacto con las garras inyecta toxina",hum:10,precio:20000},
  {id:"laserHand",n:"Forge Laser-Hand",zona:"Brazo D",efecto:"Emisor láser integrado en la palma, arma a distancia tier pistola sin desenfundar",hum:15,precio:60000},
  {id:"laserArm",n:"Forge Laser-Arm",zona:"Brazo D",efecto:"Emisor láser de brazo, tier rifle (más daño que Laser-Hand), visible, no se oculta bajo manga fina",hum:20,precio:90000},
  {id:"grappleWrist",n:"Forge Grapple-Wrist",zona:"Brazo D",efecto:"Lanza gancho/cable ~15m — trepar, cruzar huecos, o enganchar y tirar de un objeto/enemigo",hum:5,precio:20000},
  {id:"signalGhost",n:"Ibis Signal-Ghost",zona:"Sistema Neural",efecto:"Interfiere sensores/cámaras/comunicaciones electrónicas en un radio corto, 1 uso por escena",hum:10,precio:35000},
];

function dineroDisponible(){
  return parseInt((qs('#dineroFinal')?.value||'0').replace(/[^\d-]/g,''),10) || 0;
}
function comprasTotal(){ return state.compras.reduce((a,c)=>a+c.precio,0); }
function implantBonus(a){
  return state.compras.filter(c=>c.tipo==='implante-atrib' && c.attr===a).reduce((s,c)=>s+c.bonus,0);
}
function meritoAttrBonus(a){
  return (state.selectedMer.includes('Característica mejorada') && qs('#targetCar')?.value===a) ? 10 : 0;
}
function defectoCarEmpeorada(a){
  return state.selectedDef.includes('Característica empeorada') && qs('#targetCarDef')?.value===a;
}
function armorBld(){ return state.armadura ? state.armadura.bld : 0; }

function buildTiendaSelects(){
  const sa = qs('#tiendaArmadura');
  if(sa) sa.innerHTML = ARMADURAS.map(a=>`<option value="${a.n}">${a.n} — ${a.precio} PC</option>`).join('');
  const sat = qs('#tiendaImplAtrib');
  if(sat) sat.innerHTML = IMPL_ATRIB.map(i=>`<option value="${i.id}">${i.n} (+${i.bonus} ${i.attr}, −${i.hum} Hum, ${i.precio} PC)</option>`).join('');
  const sah = qs('#tiendaImplHab');
  if(sah) sah.innerHTML = IMPL_HAB.map(i=>`<option value="${i.id}">${i.n} (${i.zona}, −${i.hum} Hum, ${i.precio} PC)</option>`).join('');
}

function comprarArmadura(){
  const sel = qs('#tiendaArmadura')?.value;
  const arm = ARMADURAS.find(a=>a.n===sel);
  if(!arm) return;
  const disp = dineroDisponible() + (state.armadura ? state.armadura.precio : 0);
  if(arm.precio > disp){ alert('No hay dinero suficiente.'); return; }
  state.armadura = arm;
  rebuildEconomy(); renderTienda(); buildFullSummary();
}
window.comprarArmadura = comprarArmadura;

function comprarImplante(tipo){
  const cat = tipo==='atrib' ? IMPL_ATRIB : IMPL_HAB;
  const selId = tipo==='atrib' ? qs('#tiendaImplAtrib')?.value : qs('#tiendaImplHab')?.value;
  const it = cat.find(x=>x.id===selId);
  if(!it) return;
  if(tipo==='atrib' && state.compras.some(c=>c.tipo==='implante-atrib' && c.attr===it.attr)){
    alert(`Ya tienes un implante de ${it.attr} — un solo implante por atributo (exclusividad, CAP04e).`); return;
  }
  if(tipo==='hab' && state.compras.some(c=>c.tipo==='implante-hab' && c.zona===it.zona && c.n===it.n)){
    alert('Ya tienes ese implante.'); return;
  }
  if(it.precio > dineroDisponible()){ alert('No hay dinero suficiente.'); return; }
  state.compras.push({tipo: tipo==='atrib'?'implante-atrib':'implante-hab', n:it.n, precio:it.precio, hum:it.hum, attr:it.attr, bonus:it.bonus, zona:it.zona, efecto:it.efecto, skillBonus:it.skillBonus});
  rebuildEconomy(); recalcAttr(); recalcSkillBases(); calcSkills(); renderStatsDerivados(); renderTienda(); buildFullSummary();
}
window.comprarImplante = comprarImplante;

function quitarCompra(idx){
  state.compras.splice(idx,1);
  rebuildEconomy(); recalcAttr(); recalcSkillBases(); calcSkills(); renderStatsDerivados(); renderTienda(); buildFullSummary();
}
window.quitarCompra = quitarCompra;

function renderTienda(){
  const ad = qs('#armaduraActual');
  if(ad){
    ad.innerHTML = state.armadura
      ? `Llevas: <b>${state.armadura.n}</b> — ${state.armadura.precio} PC <button class="btn" type="button" onclick="state.armadura=null; rebuildEconomy(); renderTienda(); buildFullSummary();">Quitar</button>`
      : 'Sin armadura comprada.';
  }
  const lista = qs('#implantesLista');
  if(lista){
    const impl = state.compras.filter(c=>c.tipo.startsWith('implante'));
    lista.innerHTML = impl.length ? impl.map(c=>{
      const idxReal = state.compras.indexOf(c);
      return `<div>${c.n}${c.attr?` (+${c.bonus} ${c.attr})`:` (${c.zona})`} — ${c.precio} PC, −${c.hum} Humanidad <button class="btn" type="button" onclick="quitarCompra(${idxReal})">Quitar</button></div>`;
    }).join('') : '<div class="muted">Ningún implante comprado.</div>';
  }
}

function attr(a){ return parseInt(qs(`#at-${a}`)?.value || "0", 10) || 0; }

function updateHumanBoxVisibility(){
  const box = qs('#humanAdvBox');
  if(!box) return;
  const esHumano = (qs('#raza')?.value || 'Humano') === 'Humano';
  box.style.display = esHumano ? '' : 'none';
  if(!esHumano){ if(qs('#humanMode')) qs('#humanMode').value = 'none'; }
}

function renderStatsDerivados(){
  const box = qs('#statsDerivadosBox');
  if(!box) return;
  const A=attr('A'), C=attr('C'), F=attr('F');
  const vida = Math.ceil((A+C+F)/6);
  const carga = Math.ceil((F+C)/4);   // regla de la casa: decimal -> arriba
  const iniciado = initiatedTakes() >= 1;
  const alma = iniciado ? 10 : 8;
  const humCompras = state.compras.reduce((s,c)=>s+c.hum,0);
  const humanidad = Math.max(0, 100 - humCompras);
  const almaAccesible = Math.floor(humanidad/10);
  box.innerHTML = `
    <div><b>PV base:</b> ${vida} PV (Sano/Herido/Tullido — redondeo hacia arriba)</div>
    <div><b>Carga sin penalización:</b> ${carga} vol</div>
    <div><b>Humanidad:</b> ${humanidad}</div>
    <div><b>Alma total:</b> ${alma}${iniciado ? ' (Iniciado)' : ''} — accesible máx.: ${Math.min(alma, almaAccesible)}</div>
    <div><b>Salud Mental:</b> 100 (referencia de trauma 100)</div>
    <div><b>Deriva:</b> 0 (sube en juego con cada cruce de urdimbre, no en creación)</div>
  `;
}
function cfg(){ return TYPE_CFG[qs('#tipoPersonaje').value] || TYPE_CFG["Predestinado"]; }
function razaCfg(){ return RAZAS[qs('#raza')?.value || "Humano"] || RAZAS["Humano"]; }
function ntOrigen(){ return parseInt(qs('#ntOrigen')?.value || '5',10); }
function ntBonus(){ const n = ntOrigen(); return n <= 5 ? (6 - n) * 5 : 0; }
function ntTechCap(visionario){
  const n = ntOrigen();
  return (visionario ? n + 3 : n + 2);
}

function buildRazaSelect(){
  const r = qs('#raza');
  if(!r) return;
  r.innerHTML = Object.keys(RAZAS).map(x=>`<option>${x}</option>`).join('');
  r.value = "Humano";
  r.addEventListener('change', ()=>{ applyProfSlotUI(); recalcAttr(); rebuildPools(); rebuildEconomy(); renderStatsDerivados(); updateHumanBoxVisibility(); calcSkills(); markDirty(1); updateStepStatus(); });
}

function buildStepsMenu(){
  const m = qs('#stepsMenu');
  m.innerHTML = STEP_TITLES.map((t,i)=>`<button class="step-btn" data-step="${i+1}" onclick="goStep(${i+1})">${t}</button>`).join('');
  paintStepMenu();
  updateStepStatus();
}
function paintStepMenu(){
  qsa('.step-btn').forEach(btn=>{
    const s = parseInt(btn.dataset.step,10);
    btn.classList.toggle('active', s===state.step);
    btn.classList.toggle('dirty', !!state.dirtyFrom && s>state.dirtyFrom);
  });
}
function setStepBadge(step, type){
  const btn = qs(`.step-btn[data-step="${step}"]`);
  if(!btn) return;
  const label = STEP_TITLES[step-1];
  if(type==="ok"){ btn.style.borderColor="#15803d"; btn.style.background="#dcfce7"; btn.textContent="✅ "+label; }
  else if(type==="err"){ btn.style.borderColor="#b91c1c"; btn.style.background="#fee2e2"; btn.textContent="❌ "+label; }
  else { btn.style.borderColor="#b45309"; btn.style.background="#ffedd5"; btn.textContent="🟧 "+label; }
}
function updateStepStatus(){
  setStepBadge(1, (!!qs('#tipoPersonaje').value && !!qs('#grupoPrimario').value && !!qs('#raza').value) ? "ok":"pend");
  const pgRest = parseInt(qs('#pgRest').textContent || "0",10);
  setStepBadge(2, pgRest < 0 ? "err" : (pgRest===0 ? "ok":"pend"));
  setStepBadge(3, "ok");
  setStepBadge(4, effectiveProfs().length>=2 ? "ok":"pend");
  const usage = poolUsage();
  let overflow = false;
  Object.entries(usage).forEach(([r,u])=>{ if(u > (state.pools[r]||0)) overflow = true; });
  setStepBadge(5, overflow ? "err" : "ok");
  setStepBadge(6, "ok");
  const peTxt = qs('#peSummary').textContent || "";
  const peFinal = parseInt((peTxt.match(/final\s+(-?\d+)/)||[])[1]||"0",10);
  setStepBadge(7, peFinal < 0 ? "err":"ok");
  setStepBadge(8, (qs('#dineroFinal').value || '').trim() ? "ok":"pend");
  setStepBadge(9, "ok");
  setStepBadge(10, qs('#finalV3Frame') ? "ok":"pend");
}
function goStep(s){
  state.step = Math.max(1,Math.min(10,s));
  qsa('.step').forEach(el=>el.classList.toggle('active', parseInt(el.dataset.step,10)===state.step));
  paintStepMenu();
  if(state.step===10) renderFichaFinal();
}
function nextStep(){ goStep(state.step+1); }
function prevStep(){ goStep(state.step-1); }
window.goStep=goStep; window.nextStep=nextStep; window.prevStep=prevStep;

function markDirty(from){
  state.dirtyFrom = state.dirtyFrom ? Math.min(state.dirtyFrom, from) : from;
  paintStepMenu();
}

function rebuildAttrTable(){
  const body = qs('#attrsBody');
  body.innerHTML = '';
  ATTRS.forEach(a=>{
    body.innerHTML += `<tr><td>${a}</td><td><input type="number" id="ab-${a}" value="0" readonly></td><td><input type="number" id="af-${a}" value="0" step="5"></td><td><input type="number" id="ap-${a}" value="0" step="5"></td><td><input type="number" id="at-${a}" value="0" readonly></td></tr>`;
  });
  qsa('#attrsBody input[id^="af-"], #attrsBody input[id^="ap-"]').forEach(el=>{
    el.addEventListener('input', ()=>{ normalizeAttrInput(el); enforcePgLimits(); recalcAttr(); recalcSkillBases(); renderStatsDerivados(); markDirty(2); updateStepStatus(); });
  });
  recalcAttr();
}
function normalize5(v){ const n = parseInt(v || '0', 10) || 0; return Math.round(n / 5) * 5; }
function floor5(v){ const n = parseInt(v || '0', 10) || 0; return Math.floor(n / 5) * 5; }
function normalizeAttrInput(el){ el.value = normalize5(el.value); }
function recalcType(){
  const c = cfg();
  qs('#primarioVal').textContent = c.prim;
  qs('#secundarioVal').textContent = c.sec;
  qs('#pgTotal').textContent = c.pg;
}
function currentPgSpent(){
  let spent=0; ATTRS.forEach(a=>{ const ap = parseInt(qs(`#ap-${a}`).value||'0',10)||0; spent += Math.max(0, ap/5); }); return spent;
}
function enforcePgLimits(){
  const c = cfg();
  const rCfg = razaCfg();
  // Ajuste fino: redistribución libre en bloques de 5 dentro del grupo (no un intercambio fijo entre dos).
  // Límite real por atributo: base+af no puede bajar de 20 ni superar 50, ambos desplazados por el
  // modificador racial de ESE atributo (igual que el techo de creación).
  ATTRS.forEach(a=>{
    const afEl = qs(`#af-${a}`);
    const base = parseInt(qs(`#ab-${a}`).value,10) || 0;
    const racial = rCfg.mod[a] || 0;
    let af = normalize5(afEl.value);
    const minAf = (20 + racial) - base;
    const maxAf = (50 + racial) - base;
    af = Math.max(minAf, Math.min(maxAf, af));
    afEl.value = af;
  });
  let spent = 0;
  ATTRS.forEach(a=>{
    const apEl = qs(`#ap-${a}`);
    let ap = normalize5(apEl.value);
    if(ap < 0) ap = 0;
    const cost = ap/5;
    if(spent + cost > c.pg){ ap = Math.max(0, c.pg - spent) * 5; }
    apEl.value = ap;
    spent += ap/5;
  });
}
function recalcAttr(){
  recalcType();
  const c=cfg();
  const rCfg = razaCfg();
  const prim = qs('#grupoPrimario').value==="Físicos" ? ["A","C","F","H"] : ["Ca","I","P","V"];
  const ntB = ntBonus();
  const ntTarget = qs('#ntTargetAttr')?.value || 'H';
  ATTRS.forEach(a=>qs(`#ab-${a}`).value = prim.includes(a)?c.prim:c.sec);
  ATTRS.forEach(a=>{
    const af = normalize5(qs(`#af-${a}`).value);
    const ap = normalize5(qs(`#ap-${a}`).value);
    const racial = rCfg.mod[a] || 0;
    const ntAdd = (a === ntTarget) ? ntB : 0;
    const raw = (parseInt(qs(`#ab-${a}`).value,10)||0)+af+ap+racial+ntAdd+meritoAttrBonus(a);
    // Techo de creación: 50 + el modificador racial de ESTE atributo (positivo o negativo).
    // No usar rCfg.maxAttr fijo: eso anularía el propio bonus racial (p.ej. Kawalapiti +10 CON).
    // Mérito "Característica mejorada" entra ANTES del techo — si ya estabas en el máximo, el exceso se pierde (regla del Anexo).
    // Los implantes (CAP04e) se suman DESPUÉS del techo de creación — es su función explícita superarlo.
    let totalAttr = Math.min(50 + racial, raw) + implantBonus(a);
    if(defectoCarEmpeorada(a)) totalAttr = Math.max(20, totalAttr - 10);
    qs(`#af-${a}`).value = af; qs(`#ap-${a}`).value = ap; qs(`#at-${a}`).value = totalAttr;
  });
  qs('#pgRest').textContent = (c.pg - currentPgSpent());
  const sumAf = g => g.reduce((s,a)=>s + (parseInt(qs(`#af-${a}`).value,10)||0), 0);
  const primAttrs = prim, secAttrs = ATTRS.filter(a=>!prim.includes(a));
  const primSum = sumAf(primAttrs), secSum = sumAf(secAttrs);
  if(qs('#ajustePrimVal')){ qs('#ajustePrimVal').textContent = primSum; qs('#ajustePrimVal').style.color = primSum===0 ? '' : '#b91c1c'; }
  if(qs('#ajusteSecVal')){ qs('#ajusteSecVal').textContent = secSum; qs('#ajusteSecVal').style.color = secSum===0 ? '' : '#b91c1c'; }
  const special = qs('#specialMerDef')?.value || '';
  const techCap = ntTechCap(special==="Visionario");
  qs('#resTipo').innerHTML = `<b>Tipo:</b> ${qs('#tipoPersonaje').value} · Prim ${c.prim} / Sec ${c.sec} / PG ${c.pg} / PE ${c.pe}<br><b>Raza:</b> ${qs('#raza').value}<br><b>NT origen:</b> ${ntOrigen()} · <b>Bono NT:</b> +${ntB} a ${ntTarget} · <b>Techo tecnológico personal:</b> NT${techCap}`;
}

function applyProfSlotUI(){
  const slots = razaCfg().profSlots || 3;
  const p3 = qs('#prof3');
  if(!p3) return;
  p3.disabled = slots < 3;
  if(slots < 3) p3.value = "Ninguna";
}
function buildProfSelects(){
  ['#prof1','#prof2','#prof3'].forEach(id=>{
    qs(id).innerHTML = PROFESIONES.map(p=>`<option>${p}</option>`).join('');
    qs(id).addEventListener('change', ()=>{ rebuildPools(); rebuildEconomy(); recalcSkillBases(); renderRunes(); renderStatsDerivados(); markDirty(4); updateStepStatus(); });
  });
  applyProfSlotUI();
}
function profs(){
  const rc = razaCfg();
  const slots = rc.profSlots || 3;
  const all = [qs('#prof1').value,qs('#prof2').value,qs('#prof3').value];
  return all.map((v,i)=> (i<slots ? v : "Ninguna")).filter(v=>v && v!=="Ninguna");
}
function effectiveProfs(){
  const base = profs();
  const rc = razaCfg();
  const out = [...base];
  if(rc.voc && base.includes(rc.voc)) out.push(rc.voc);
  state.effectiveProfs = out;
  return out;
}
function rebuildPools(){
  const p = {};
  effectiveProfs().forEach(pr=>{
    const src = POOL_SOURCE[pr]||{};
    Object.entries(src).forEach(([k,v])=> p[k]=(p[k]||0)+v);
  });
  state.pools = p;
  paintPoolChipsWithUsage();
  calcSkills();
  const rc = razaCfg();
  qs('#profSummary').innerHTML = `<b>Profesiones:</b> ${profs().join(', ') || '—'}<br><b>Efectivas:</b> ${effectiveProfs().join(', ') || '—'}<br><b>Bolsas:</b> ${Object.entries(p).map(([k,v])=>`${k}:${v}`).join(' · ') || '—'}`;
  qs('#vocSummary').innerHTML = `<b>Vocación racial:</b> ${rc.voc || 'Sin vocación'} ${rc.voc && profs().includes(rc.voc) ? ' (activada +1 toma)' : ''}`;
}

function buildSkills(){
  const wrap = qs('#skillsWrap');
  wrap.innerHTML = '';
  Object.entries(SKILLS).forEach(([rk,list])=>{
    const id = `tb-${rk}`;
    wrap.innerHTML += `<div class="box"><h3>${rk}</h3><table><thead><tr><th>Hab</th><th>Base</th><th>Apr (+5)</th><th>Mod</th><th>Tot</th></tr></thead><tbody id="${id}"></tbody></table></div>`;
    const tb = qs('#'+id);
    list.forEach((h,i)=>{
      tb.innerHTML += `<tr><td>${h}</td><td><input type="number" id="skb-${rk}-${i}" class="sk-base" data-r="${rk}" data-i="${i}" value="0" readonly></td><td><input type="number" id="skapr-${rk}-${i}" class="sk-apr" data-r="${rk}" data-i="${i}" value="0" step="5"></td><td><input type="number" id="skmod-${rk}-${i}" class="sk-mod" data-r="${rk}" data-i="${i}" value="0"></td><td><input type="number" id="sktot-${rk}-${i}" class="sk-tot" data-r="${rk}" data-i="${i}" value="0" readonly></td></tr>`;
    });
  });
  qsa('.sk-apr,.sk-mod').forEach(el=>el.addEventListener('input', ()=>{ calcSkills(); markDirty(5); updateStepStatus(); }));
  fillTargets();
  recalcSkillBases();
  calcSkills();
}
function recalcSkillBases(){
  Object.keys(SKILLS).forEach(r=>{
    const f = SKILL_BASE_FORMULA[r];
    if(Array.isArray(f)){
      // Combate: una fórmula distinta por habilidad, en el mismo orden que SKILLS[r]
      SKILLS[r].forEach((h,i)=>{
        const base = f[i] ? f[i]() : 0;
        qsa(`.sk-base[data-r="${r}"][data-i="${i}"]`).forEach(el=>{ el.value = base; });
      });
    } else {
      const base = f();
      qsa(`.sk-base[data-r="${r}"]`).forEach(el=>{ el.value = base; });
    }
  });
  calcSkills();
}
function poolUsage(){
  const used = {};
  Object.keys(SKILLS).forEach(r=>{ used[r]=qsa(`.sk-apr[data-r="${r}"]`).reduce((a,el)=>a+(parseInt(el.value||'0',10)||0),0); });
  return used;
}
function paintPoolChipsWithUsage(){
  const used = poolUsage();
  const html = Object.entries(state.pools).map(([k,v])=>`<span class="chip">${k}: ${used[k]||0}/${v} (resto ${v-(used[k]||0)})</span>`).join('');
  qs('#poolChips').innerHTML = html || '<span class="muted">Sin bolsas aún.</span>';
}
function calcSkills(){
  Object.keys(SKILLS).forEach(r=>{
    const lim = state.pools[r]||0;
    let used = 0;
    qsa(`.sk-apr[data-r="${r}"]`).forEach(el=>{
      let v = floor5(el.value);
      if(v < 0) v = 0;
      if(used + v > lim){
        const remain = Math.max(0, lim - used);
        v = floor5(remain);
      }
      el.value = v;
      used += v;
    });
  });
  qsa('.sk-mod').forEach(el=>{ const n = parseInt(el.value || "0", 10) || 0; el.value = Math.max(0, n); });
  const hm = qs('#humanMode')?.value || 'none';
  const hs1 = qs('#humanSkill1')?.value || '';
  const hs2 = qs('#humanSkill2')?.value || '';
  qsa('.sk-tot').forEach(t=>{
    const r=t.dataset.r, i=t.dataset.i;
    const b=parseInt(qs(`.sk-base[data-r="${r}"][data-i="${i}"]`).value||'0',10)||0;
    const a=parseInt(qs(`.sk-apr[data-r="${r}"][data-i="${i}"]`).value||'0',10)||0;
    const m=parseInt(qs(`.sk-mod[data-r="${r}"][data-i="${i}"]`).value||'0',10)||0;
    const skillName = SKILLS[r][parseInt(i,10)];
    const key = `${r}:${skillName}`;
    let humBonus = 0;
    if((qs('#raza')?.value||'Humano') === 'Humano'){
      if(hm === 'single10' && key === hs1) humBonus = 10;
      if(hm === 'double5' && (key === hs1 || key === hs2)) humBonus = 5;
    }
    const implSkillBonus = state.compras.filter(c=>c.skillBonus && c.skillBonus.rama===r && c.skillBonus.name===skillName).reduce((s,c)=>s+c.skillBonus.val,0);
    const meritoHab = meritoHabBonus(r, skillName);
    t.value=Math.max(0,Math.min(90,b+a+m+humBonus+implSkillBonus+meritoHab));
  });
  paintPoolChipsWithUsage();
}

function initiatedTakes(){ return effectiveProfs().filter(p=>p==="Iniciado").length; }
function maxRuneLevel(){ const n = initiatedTakes(); return n<=0 ? 0 : 2; } // techo real de creación: N2 (N3+ requiere maestro/narrativa)
function runasDeOrigen(origen){
  if(origen==="Básica" || !origen) return RUNAS_BASICAS.map(n=>({n, nivelFijo:null}));
  return (RUNAS_ESCUELA[origen]||[]).map(r=>({n:r.n, nivelFijo:r.nivel}));
}
function renderRunes(){
  const rw = qs('#runeWrap');
  if(!rw) return;
  const bonusRunas = (state.selectedMer.includes('Runas adicionales') && initiatedTakes()>=1) ? 3 : 0;
  const maxSlots = initiatedTakes() * 3 + bonusRunas;
  if(maxSlots<=0){ rw.innerHTML = '<span class="muted">Sin tomas de Iniciado.</span>'; state.runes = []; return; }
  while(state.runes.length < maxSlots) state.runes.push({origen:"Básica", name:RUNAS_BASICAS[0], level:1, tipo:"Runa"});
  if(state.runes.length > maxSlots) state.runes = state.runes.slice(0,maxSlots);
  const lvlMax = maxRuneLevel();
  rw.innerHTML = state.runes.map((r,i)=>{
    const opciones = runasDeOrigen(r.origen);
    const nivelFijo = opciones.find(o=>o.n===r.name)?.nivelFijo;
    return `<div class="box" style="min-width:260px">
      <label>Inscripción ${i+1} — Origen<select id="rune-origen-${i}" data-rune-origen="${i}">${ESCUELAS.map(e=>`<option ${e===(r.origen||"Básica")?'selected':''}>${e}</option>`).join('')}</select></label>
      <label>Runa<select id="rune-name-${i}" data-rune-name="${i}">${opciones.map(o=>`<option ${o.n===r.name?'selected':''}>${o.n}${o.nivelFijo?` (N${o.nivelFijo})`:''}</option>`).join('')}</select></label>
      <label>Nivel<select id="rune-level-${i}" data-rune-level="${i}" ${nivelFijo?'disabled':''}>${[1,2].map(l=>`<option value="${l}" ${l===(nivelFijo||r.level)?'selected':''} ${l>lvlMax?'disabled':''}>${l}</option>`).join('')}</select></label>
      <label>Tipo<select id="rune-tipo-${i}" data-rune-tipo="${i}"><option ${r.tipo==="Runa"?'selected':''}>Runa</option><option ${r.tipo==="Tatuaje"?'selected':''}>Tatuaje</option></select></label>
    </div>`;
  }).join('');
  qsa('[data-rune-origen]').forEach(el=>el.addEventListener('change', ()=>{ const i=parseInt(el.getAttribute('data-rune-origen'),10); state.runes[i].origen=el.value; const opts=runasDeOrigen(el.value); state.runes[i].name=opts[0]?.n||RUNAS_BASICAS[0]; renderRunes(); buildFullSummary(); }));
  qsa('[data-rune-name]').forEach(el=>el.addEventListener('change', ()=>{ const i=parseInt(el.getAttribute('data-rune-name'),10); state.runes[i].name=el.value; renderRunes(); buildFullSummary(); }));
  qsa('[data-rune-level]').forEach(el=>el.addEventListener('change', ()=>{ const i=parseInt(el.getAttribute('data-rune-level'),10); state.runes[i].level=Math.min(maxRuneLevel(), parseInt(el.value,10)); buildFullSummary(); }));
  qsa('[data-rune-tipo]').forEach(el=>el.addEventListener('change', ()=>{ const i=parseInt(el.getAttribute('data-rune-tipo'),10); state.runes[i].tipo=el.value; buildFullSummary(); }));
}

function buildMerDef(){
  qs('#meritosBox').innerHTML = MERITOS.map((x,i)=>`<label title="${x.desc||''}"><input type="checkbox" id="mer-${i}" class="mer" value="${x.n}"> ${x.n} (PE ${x.pe})</label><br><span class="muted" style="font-size:11px">${x.desc||''}</span><br>`).join('');
  qs('#defectosBox').innerHTML = DEFECTOS.map((x,i)=>`<label title="${x.desc||''}"><input type="checkbox" id="def-${i}" class="def" value="${x.n}"> ${x.n} (+PE ${x.pe})</label><br><span class="muted" style="font-size:11px">${x.desc||''}</span><br>`).join('');
  qsa('.mer,.def').forEach(el=>el.addEventListener('change', ()=>{ applyMerDefEffects(); markDirty(7); updateStepStatus(); }));
  qs('#targetCar').addEventListener('change', ()=>{ applyMerDefEffects(); updateStepStatus(); });
  qs('#targetHab').addEventListener('change', ()=>{ applyMerDefEffects(); updateStepStatus(); });
  qs('#targetCarDef')?.addEventListener('change', ()=>{ applyMerDefEffects(); updateStepStatus(); });
  fillTargets(); applyMerDefEffects();
}
function fillTargets(){
  qs('#targetCar').innerHTML = ATTRS.map(a=>`<option>${a}</option>`).join('');
  if(qs('#targetCarDef')) qs('#targetCarDef').innerHTML = ATTRS.map(a=>`<option>${a}</option>`).join('');
  const allSkills = Object.entries(SKILLS).flatMap(([r,l])=>l.map(h=>`${r}:${h}`));
  const opts = allSkills.map(s=>`<option>${s}</option>`).join('');
  qs('#targetHab').innerHTML = opts;
  if(qs('#humanSkill1')) qs('#humanSkill1').innerHTML = `<option value="">—</option>${opts}`;
  if(qs('#humanSkill2')) qs('#humanSkill2').innerHTML = `<option value="">—</option>${opts}`;
}
function applyMerDefEffects(){
  const selectedMer = qsa('.mer:checked').map(x=>x.value);
  const selectedDef = qsa('.def:checked').map(x=>x.value);
  state.selectedMer = selectedMer; state.selectedDef = selectedDef;
  const peBase = cfg().pe;
  const special = qs('#specialMerDef')?.value || '';
  const peSpecial = special ? 3 : 0;
  const peGast = selectedMer.reduce((a,n)=>a+(MERITOS.find(x=>x.n===n)?.pe||0),0) + peSpecial;
  const peRecRaw = selectedDef.reduce((a,n)=>a+(DEFECTOS.find(x=>x.n===n)?.pe||0),0);
  const capByType = {"Héroe":3,"Madera de Héroe":6,"Predestinado":0};
  const maxRec = capByType[qs('#tipoPersonaje').value] ?? 0;
  const peRec = Math.min(peRecRaw, maxRec);
  qs('#peSummary').textContent = `PE base ${peBase} · gastado ${peGast} · recuperado ${peRec}/${maxRec} · final ${peBase-peGast+peRec}`;
  // Refrescar todo lo que dependa de Méritos/Defectos: atributos (Característica mejorada/empeorada),
  // habilidades (Habilidad mejorada), runas (Runas adicionales) y dinero (Deudas).
  recalcAttr(); recalcSkillBases(); calcSkills(); renderRunes(); rebuildEconomy(); renderStatsDerivados();
}
function deudasTotal(){
  let total = 0;
  if(state.selectedDef.includes('Deudas (1 punto)')) total += 10000;
  if(state.selectedDef.includes('Deudas (2 puntos)')) total += 20000;
  if(state.selectedDef.includes('Deudas (3 puntos)')) total += 30000;
  return total;
}
function meritoHabBonus(rama, name){
  return (state.selectedMer.includes('Habilidad mejorada') && qs('#targetHab')?.value===`${rama}:${name}`) ? 30 : 0;
}

function rebuildEconomy(){
  const eff = effectiveProfs();
  const counts = {};
  eff.forEach(x=>counts[x]=(counts[x]||0)+1);
  const unique = Object.keys(counts);
  let money = 0;
  const lines = [];
  unique.forEach(p=>{
    const c = ECON_CFG[p];
    if(!c) return;
    money += c.income;
    lines.push(`${p} ${counts[p]}x: ${c.kit1}${counts[p]>=2 ? ` + SALTO 2x (${c.kit2})` : ''}`);
  });
  const intBonus = attr("I") * 100;
  const savings = qsa('.mer:checked').some(x=>x.value==="Ahorros") ? 10000 : 0;
  const gastoArmadura = state.armadura ? state.armadura.precio : 0;
  const gastoCompras = comprasTotal();
  const deuda = deudasTotal();
  if(state.armadura && state.armadura.precio>0) lines.push(`Armadura: ${state.armadura.n} (−${gastoArmadura} PC)`);
  state.compras.forEach(c=>lines.push(`${c.n}${c.attr?` (+${c.bonus} ${c.attr})`:` (${c.zona})`} — implante, −${c.hum} Humanidad (−${c.precio} PC)`));
  if(deuda>0) lines.push(`Defecto Deudas: −${deuda} PC (más intereses en juego)`);
  const total = money + intBonus + savings - gastoArmadura - gastoCompras - deuda;
  qs('#equipoInicial').value = lines.join('\n');
  qs('#dineroFinal').value = `${total} PC`;
  qs('#ecoSummary').innerHTML = `<b>Ingreso por categorías distintas:</b> ${money} PC<br><b>Bono INT:</b> ${intBonus} PC<br><b>Ahorros:</b> ${savings} PC<br><b>Gastado en armadura/implantes:</b> −${gastoArmadura+gastoCompras} PC<br><b>Total:</b> ${total} PC`;
  buildFullSummary(); updateStepStatus();
}
window.rebuildEconomy = rebuildEconomy;

// ===================== FICHA FINAL — 4 páginas =====================
const SKILL_CAT_NAMES = {academicas:"Académicas", tecnologicas:"Tecnológicas", atleticas:"Atléticas", sociales:"Sociales", combate:"Combate", distorsion:"Distorsión"};

function skillRowsHtml(rk){
  return SKILLS[rk].map((h,i)=>{
    const tot = qs(`.sk-tot[data-r="${rk}"][data-i="${i}"]`)?.value || 0;
    return `<div class="ficha-skill-row"><span>${h}</span><span class="esp"></span><span class="tot">${tot}</span></div>`;
  }).join('');
}

function renderFichaFinal(){
  const box = qs('#fichaFinal');
  if(!box) return;

  try{
  const nombre = qs('#personaje').value || '—';
  const jugador = qs('#jugador').value || '—';
  const corp = qs('#corporacion').value || '—';
  const naturaleza = qs('#naturaleza').value || '—';
  const nt = qs('#nt').value || '—';
  const raza = qs('#raza').value || '—';
  const tipo = qs('#tipoPersonaje').value || '—';

  const attrsHtml = ATTRS.map(a=>`<div><b>${a}</b><span>${qs(`#at-${a}`).value||0}</span></div>`).join('');

  const A=attr('A'), C=attr('C'), F=attr('F');
  const vida = Math.ceil((A+C+F)/6);
  const iniciado = initiatedTakes() >= 1;
  const alma = iniciado ? 10 : 8;
  const humCompras = state.compras.reduce((s,c)=>s+c.hum,0);
  const humanidad = Math.max(0, 100 - humCompras);
  const almaAccesible = Math.min(alma, Math.floor(humanidad/10));

  // ---- Página 1: Principal ----
  const p1skills = Object.keys(SKILLS).filter(r=>r!=='combate').map(rk=>`
    <div class="ficha-skills-cat">
      <h4>${SKILL_CAT_NAMES[rk]}</h4>
      ${skillRowsHtml(rk)}
    </div>`).join('');

  const pagina1 = `
    <section class="ficha-pagina">
      <h2>1 · Principal — ${nombre}</h2>
      <div class="ficha-cab">
        <div><b>Jugador</b>${jugador}</div>
        <div><b>Corporación</b>${corp}</div>
        <div><b>Naturaleza</b>${naturaleza}</div>
        <div><b>NT</b>${nt}</div>
        <div><b>Raza</b>${raza}</div>
        <div><b>Tipo</b>${tipo}</div>
        <div><b>Profesiones</b>${effectiveProfs().join(', ')||'—'}</div>
        <div><b>Deriva</b>___</div>
      </div>
      <div class="ficha-attrs">${attrsHtml}</div>
      <div class="ficha-stats">
        <span><b>PV</b> ${vida}/${vida}/${vida} (Sano/Herido/Tullido)</span>
        <span><b>Humanidad</b> ${humanidad}</span>
        <span><b>Alma</b> ${alma} (accesible ${almaAccesible})</span>
        <span><b>Salud Mental</b> 100</span>
      </div>
      <div class="ficha-skills">${p1skills}</div>
      <div class="ficha-skills-cat" style="margin-top:6px">
        <h4>Combate</h4>
        <div class="ficha-combate">${skillRowsHtml('combate')}</div>
      </div>
    </section>`;

  // ---- Página 2: Equipamiento ----
  const equipo = (qs('#equipoInicial').value||'').split('\n').filter(Boolean);
  const armaduraTxt = state.armadura ? `${state.armadura.n} (${state.armadura.precio} PC)` : 'Sin armadura';
  const implantes = state.compras.map(c=>`${c.n}${c.attr?` (+${c.bonus} ${c.attr})`:(c.zona?` (${c.zona})`:'')} — −${c.hum} Humanidad`).join('<br>') || 'Ninguno';
  const pvBoxes = n => Array(Math.max(0,n)).fill('<span></span>').join('');

  const pagina2 = `
    <section class="ficha-pagina">
      <h2>2 · Equipamiento — ${nombre}</h2>
      <div class="ficha-stats"><span><b>Dinero</b> ${qs('#dineroFinal').value||'—'}</span><span><b>Armadura</b> ${armaduraTxt}</span></div>
      <h3 style="font-size:12px;margin:10px 0 2px">Implantes</h3>
      <div style="font-size:12px">${implantes}</div>
      <h3 style="font-size:12px;margin:10px 0 2px">Equipo inicial</h3>
      <div style="font-size:12px">${equipo.length ? equipo.map(l=>`<div>${l}</div>`).join('') : 'Ninguno'}</div>
      <h3 style="font-size:12px;margin:10px 0 2px">Vida en juego</h3>
      <div class="ficha-pv-box">
        ${['Sano','Herido','Tullido'].map(n=>`<div class="ficha-pv-nivel"><b>${n}</b>${vida}<div class="ficha-pv-boxes">${pvBoxes(vida)}</div></div>`).join('')}
      </div>
      <h3 style="font-size:12px;margin:10px 0 2px">Armas</h3>
      <table class="ficha-blank-table"><thead><tr><th>Arma</th><th>Daño</th><th>Pen</th><th>Alcance</th><th>Notas</th></tr></thead>
      <tbody>${Array(5).fill('<tr><td></td><td></td><td></td><td></td><td></td></tr>').join('')}</tbody></table>
    </section>`;

  // ---- Página 3: Iniciados ----
  let pagina3;
  if(!iniciado){
    pagina3 = `<section class="ficha-pagina"><h2>3 · Iniciados — ${nombre}</h2><div class="muted">Este personaje no tiene ninguna toma de Iniciado — esta página no aplica.</div></section>`;
  } else {
    const runasTxt = (state.runes||[]).map(r=>`${r.tipo} · ${r.name} N${r.level} (${r.origen})`).join('<br>') || 'Ninguna inscrita todavía.';
    pagina3 = `
      <section class="ficha-pagina">
        <h2>3 · Iniciados — ${nombre}</h2>
        <div class="ficha-stats"><span><b>Alma total</b> ${alma}</span><span><b>Alma accesible</b> ${almaAccesible}</span></div>
        <h3 style="font-size:12px;margin:10px 0 2px">Habilidades de Distorsión</h3>
        <div class="ficha-skills-cat">${skillRowsHtml('distorsion')}</div>
        <h3 style="font-size:12px;margin:10px 0 2px">Runas y tatuajes inscritos</h3>
        <div style="font-size:12px">${runasTxt}</div>
        <h3 style="font-size:12px;margin:10px 0 2px">Focos de Distorsión</h3>
        <table class="ficha-blank-table"><thead><tr><th>Foco</th><th>Efecto</th></tr></thead>
        <tbody>${Array(3).fill('<tr><td></td><td></td></tr>').join('')}</tbody></table>
        <h3 style="font-size:12px;margin:10px 0 2px">Tintas rúnicas y Perlas</h3>
        <table class="ficha-blank-table"><thead><tr><th>Tinta rúnica</th><th>Perla blanca (100 PD)</th><th>Perla negra (1.000 PD)</th></tr></thead>
        <tbody><tr><td></td><td></td><td></td></tr></tbody></table>
      </section>`;
  }

  // ---- Página 4: Instrucciones ----
  const pagina4 = `
    <section class="ficha-pagina ficha-instr">
      <h2>4 · Instrucciones</h2>
      <h3>Cómo leer esta ficha</h3>
      <p>Cada habilidad muestra su <b>Total</b> ya calculado. La línea entre el nombre y el número es para anotar una <b>especialidad</b>, si la tienes.</p>
      <h3>Tiradas y dificultad</h3>
      <p>Tira d100 e intenta sacar igual o menos que tu habilidad. El Narrador aplica un modificador entre <b>−20 y +20</b> (múltiplos de 5) según la dificultad: muy fácil +20, fácil +10, normal 0, difícil −10, extremadamente difícil −20.</p>
      <h3>Tiradas enfrentadas</h3>
      <p>Cuando dos personajes se oponen directamente, ambos tiran contra su propia habilidad y gana quien saque más éxitos.</p>
      <h3>Heridas</h3>
      <p>Tres niveles — Sano, Herido (−10) y Tullido (−20) — cada uno con capacidad igual a tus PV base. Agotar Tullido es muerte.</p>
      <h3>Redondeo</h3>
      <p>Si un cálculo deja decimales, siempre se redondea hacia arriba (excepción: el Alma accesible, que redondea hacia abajo).</p>
    </section>`;

  box.innerHTML = pagina1 + pagina2 + pagina3 + pagina4;
  }catch(e){
    console.error('renderFichaFinal:', e);
    box.innerHTML = '<p class="muted">No se pudo generar la ficha final (la página aún está cargando datos). Espera un momento y pulsa «Actualizar ficha final».</p>';
  }
}
window.renderFichaFinal = renderFichaFinal;

function renderFinalSheetV3(){
  const attrs = ATTRS.map(a=>`${a}: ${attr(a)}`).join(' · ');
  const runTxt = state.runes.length ? state.runes.map(r=>`${r.name} N${r.level} (${r.tipo||'Runa'}${r.origen&&r.origen!=='Básica'?`, ${r.origen}`:''})`).join(', ') : '—';
  qs('#finalSheetV3').innerHTML = `<h3 style="margin-top:0">Resumen para ficha v3</h3><div class="box"><div><b>Personaje:</b> ${qs('#personaje').value || '—'} · <b>Jugador:</b> ${qs('#jugador').value || '—'}</div><div><b>Tipo:</b> ${qs('#tipoPersonaje').value} · <b>Grupo:</b> ${qs('#grupoPrimario').value} · <b>Raza:</b> ${qs('#raza').value}</div><div><b>Atributos:</b> ${attrs}</div><div><b>Profesiones efectivas:</b> ${effectiveProfs().join(', ') || '—'}</div><div><b>Runas:</b> ${runTxt}</div><div><b>Dinero:</b> ${qs('#dineroFinal').value || '—'}</div></div>`;
  tryFillV3Iframe();
}
// Listas de v3 (ficha.html) en su orden real, para mapear por NOMBRE (no por índice — las listas no coinciden 1:1).
const V3_ACAD = ["Ciencias","Biotecnología","Navegación","Burocracia","Buscar información","Programación","Diagnóstico","Investigación","Juego","Diseño Hardware","Sentido del Negocio","Supervivencia","Vigilar/Rastrear"];
const V3_TEC = ["Armería","Artesanía","Ciber-tecnología","Demoliciones","Disfraz","Electrónica","Falsificación","Química","Mecánica","Manos ágiles","Seguridad","Primeros Auxilios","Conducir","Pilotar","Trajes Servoasistidos","Sigilo"];
const V3_ATL = ["Acrobacias","Resistir","Proezas"];
const V3_SOC = ["Absorción","Autocontrol","Bajos Fondos","Empatía","Interrogatorio","Liderazgo","Manejo de Animales","Persuasión","Seducción","Estilo"];
// v3 ya tiene sus 3 tramos (Corta/Media/Larga) desde la reestructuracion en 4 paginas —
// mismo orden que SKILLS.combate en este archivo (sin Iniciativa/Alerta/Esquivar, que van a V3_INIC).
const V3_COMBAT = ["Distancia Corta","Distancia Media","Distancia Larga","Sin Armas","Arma CC Corta","Arma CC Media","Arma CC Larga"];
const V3_INIC = ["Iniciativa","Alerta","Esquivar"];
const V3_DISC = ["Proyección de Energía","Protección de Energía","Invocación de Energía","Detección de Distorsión","Manipulación de Distorsión","Camino de los Portales","Herrero Rúnico","Tatuador Rúnico"];

function fillV3Skill(doc, rama, name, val){
  let idx;
  const put = (sel)=>{ const e=doc.querySelector(sel); if(e) e.value = val; };
  if(rama==='academicas'){ idx=V3_ACAD.indexOf(name); if(idx>=0) put(`.apr[data-cat="0"][data-sk="${idx}"]`); }
  else if(rama==='tecnologicas'){ idx=V3_TEC.indexOf(name); if(idx>=0) put(`.apr[data-cat="1"][data-sk="${idx}"]`); }
  else if(rama==='atleticas'){ idx=V3_ATL.indexOf(name); if(idx>=0) put(`.apr[data-cat="2"][data-sk="${idx}"]`); }
  else if(rama==='sociales'){ idx=V3_SOC.indexOf(name); if(idx>=0) put(`.apr[data-cat="3"][data-sk="${idx}"]`); }
  else if(rama==='combate'){
    idx = V3_COMBAT.indexOf(name);
    if(idx>=0){ put(`.capr[data-i="${idx}"]`); return; }
    idx = V3_INIC.indexOf(name);
    if(idx>=0) put(`.iapr[data-i="${idx}"]`);
  }
  else if(rama==='distorsion'){ idx=V3_DISC.indexOf(name); if(idx>=0) put(`.dhab[data-i="${idx}"]`); }
}

function tryFillV3Iframe(){
  const frame = qs('#finalV3Frame');
  if(!frame) return;
  const fill = ()=>{
    try{
      const doc = frame.contentDocument || frame.contentWindow.document;
      if(!doc) return;
      const setVal = (id,v)=>{ const e=doc.getElementById(id); if(e) e.value=v; };
      setVal('jugador', qs('#jugador').value || '');
      setVal('personaje', qs('#personaje').value || '');
      setVal('corporacion', qs('#corporacion').value || '');
      setVal('naturaleza', qs('#naturaleza').value || '');
      setVal('nt', qs('#nt').value || '');
      setVal('Ca_b', attr('Ca')); setVal('A_b', attr('A')); setVal('P_b', attr('P')); setVal('C_b', attr('C'));
      setVal('I_b', attr('I')); setVal('F_b', attr('F')); setVal('V_b', attr('V')); setVal('H_b', attr('H'));

      // Habilidades: cada .sk-apr del v4 (más la ventaja humana, si aplica) al hueco correspondiente en v3.
      const hm = qs('#humanMode')?.value || 'none';
      const hs1 = qs('#humanSkill1')?.value || '';
      const hs2 = qs('#humanSkill2')?.value || '';
      const esHumano = (qs('#raza')?.value||'Humano') === 'Humano';
      qsa('.sk-apr').forEach(el=>{
        const r=el.dataset.r, i=parseInt(el.dataset.i,10);
        const name = SKILLS[r][i];
        const key = `${r}:${name}`;
        let val = parseInt(el.value||'0',10)||0;
        if(esHumano){
          if(hm==='single10' && key===hs1) val += 10;
          if(hm==='double5' && (key===hs1||key===hs2)) val += 5;
        }
        if(val>0) fillV3Skill(doc, r, name, val);
      });

      // Equipo: cada línea del textarea del v4 a una fila de la tabla de v3 (id="equipoTable").
      const equipoLineas = (qs('#equipoInicial')?.value || '').split('\n').map(l=>l.trim()).filter(Boolean);
      const equipoInputs = [...doc.querySelectorAll('#equipoTable tr td:first-child input[type="text"]')];
      equipoLineas.forEach((linea,i)=>{ if(equipoInputs[i]) equipoInputs[i].value = linea; });

      // Dinero final.
      setVal('dineroTotal', qs('#dineroFinal')?.value || '');

      // Implantes comprados → tabla de implantes de v3 (3 filas: Nombre / Zona / Efecto / Precio).
      const implRows = [...doc.querySelectorAll('#implTable tr')];
      state.compras.filter(c=>c.tipo.startsWith('implante')).forEach((c,i)=>{
        const row = implRows[i];
        if(!row) return;
        const inputs = row.querySelectorAll('input[type="text"]');
        const sel = row.querySelector('select.implSlot');
        const num = row.querySelector('input[type="number"]');
        if(inputs[0]) inputs[0].value = c.n;
        if(sel){
          const zonaGuess = c.zona || (c.attr==='F'||c.attr==='C' ? 'Sistema Óseo' : c.attr==='A'||c.attr==='H' ? 'Sistema Muscular' : 'Sistema Neural');
          if([...sel.options].some(o=>o.value===zonaGuess)) sel.value = zonaGuess;
        }
        if(inputs[1]) inputs[1].value = c.efecto || (c.attr ? `+${c.bonus} ${c.attr}` : '');
        if(num) num.value = c.precio;
      });
      if(doc.defaultView && typeof doc.defaultView.checkSlots === 'function') doc.defaultView.checkSlots();

      // Armadura comprada → Blindaje de todas las zonas de localización.
      if(state.armadura && state.armadura.bld>0){
        doc.querySelectorAll('#locGrid tr td:nth-child(2) input').forEach(el=>{ el.value = state.armadura.bld; });
      }

      // Méritos, Defectos y el especial de Paso 6 → tabla de Méritos/Defectos de v3.
      const filasMerito = [];
      const especial = qs('#specialMerDef')?.value || '';
      if(especial) filasMerito.push({n: especial, t: 'Esp', e: 'MéritoDefecto especial (Paso 6)'});
      qsa('.mer:checked').forEach(el=>{
        const info = MERITOS.find(m=>m.n===el.value);
        filasMerito.push({n: el.value, t: 'M', e: info ? info.desc : ''});
      });
      qsa('.def:checked').forEach(el=>{
        const info = DEFECTOS.find(m=>m.n===el.value);
        filasMerito.push({n: el.value, t: 'D', e: info ? info.desc : ''});
      });
      const filasMeritoV3 = [...doc.querySelectorAll('#meritTable tr')];
      filasMerito.forEach((f,i)=>{
        const row = filasMeritoV3[i];
        if(!row) return;
        const inputs = row.querySelectorAll('input[type="text"]');
        if(inputs[0]) inputs[0].value = f.n;
        if(inputs[1]) inputs[1].value = f.t;
        if(inputs[2]) inputs[2].value = f.e;
      });

      if(frame.contentWindow && typeof frame.contentWindow.calc === 'function') frame.contentWindow.calc();
    }catch(_e){}
  };
  if(frame.dataset.bound!=="1"){ frame.addEventListener('load', fill); frame.dataset.bound="1"; }
  fill();
}

function buildFullSummary(){
  const runTxt = state.runes.length ? state.runes.map(r=>`${r.name} N${r.level} (${r.tipo||'Runa'}${r.origen&&r.origen!=='Básica'?`, ${r.origen}`:''})`).join(', ') : '—';
  qs('#fullSummary').innerHTML = `<div><b>Tipo:</b> ${qs('#tipoPersonaje').value}</div><div><b>Raza:</b> ${qs('#raza').value}</div><div><b>Grupo primario:</b> ${qs('#grupoPrimario').value}</div><div><b>PG restante:</b> ${qs('#pgRest').textContent}</div><div><b>Profesiones efectivas:</b> ${effectiveProfs().join(',')||'—'}</div><div><b>Runas:</b> ${runTxt}</div><div><b>PE:</b> ${qs('#peSummary').textContent}</div><div><b>Dinero:</b> ${qs('#dineroFinal').value||'—'}</div>${state.historia?`<div style="margin-top:6px"><b>Historia breve:</b> <i>${state.historia}</i></div>`:''}`;
  renderFinalSheetV3(); updateStepStatus();
}

function collectData(){
  const form={};
  qsa('input,select,textarea').forEach((el,i)=>{ const k=el.id||`${el.tagName}_${i}`; form[k]=(el.type==='checkbox')?el.checked:el.value; });
  return {version:4, state, form, exportedAt:new Date().toISOString()};
}
function applyData(d){
  if(!d||!d.form) return;
  qsa('input,select,textarea').forEach((el,i)=>{ const k=el.id||`${el.tagName}_${i}`; if(!(k in d.form)) return; if(el.type==='checkbox') el.checked=!!d.form[k]; else el.value=d.form[k]; });
  if(d.state) state = d.state;
  enforcePgLimits(); recalcAttr(); rebuildPools(); recalcSkillBases(); calcSkills(); renderRunes(); applyMerDefEffects(); rebuildEconomy(); renderStatsDerivados(); buildFullSummary(); goStep(state.step||1); updateStepStatus();
}
function guardarJSON(){
  const blob = new Blob([JSON.stringify(collectData(),null,2)],{type:'application/json;charset=utf-8'});
  const a=document.createElement('a');
  const pj=(qs('#personaje').value||'personaje').replace(/[^a-z0-9áéíóúüñ_-]+/gi,'_');
  const url=URL.createObjectURL(blob); a.href=url; a.download=`Ficha_${pj}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function cargarJSON(ev){
  const f=ev.target.files&&ev.target.files[0]; if(!f) return;
  const fr=new FileReader();
  fr.onload=e=>{ try{ applyData(JSON.parse(e.target.result)); alert('JSON cargado.'); } catch{ alert('JSON inválido.'); } };
  fr.readAsText(f,'utf-8'); ev.target.value='';
}

function randomChoice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function random5(min,max){ const vals=[]; for(let v=min; v<=max; v+=5) vals.push(v); return randomChoice(vals); }
function randomTypeData(){
  qs('#jugador').value = randomChoice(["Alex","Pascu","Nora","Izan","Vera"]);
  qs('#personaje').value = randomChoice(["Kova","Salim","Drago","Bishop","Reyes"]);
  qs('#corporacion').value = randomChoice(["Chafry","Primus","Mort","Workhouse"]);
  qs('#naturaleza').value = randomChoice(["Errante","Mercenario","Iniciado"]);
  qs('#nt').value = randomChoice(["NT1","NT2","NT3","NT4","NT5"]);
  qs('#tipoPersonaje').value = randomChoice(Object.keys(TYPE_CFG));
  qs('#grupoPrimario').value = randomChoice(["Físicos","Mentales"]);
  qs('#raza').value = randomChoice(Object.keys(RAZAS));
  recalcAttr();
}
function randomAttrs(){
  const c = cfg();
  let pg = c.pg;
  ATTRS.forEach(a=>{ qs(`#af-${a}`).value = random5(-5,5); qs(`#ap-${a}`).value = 0; });
  while(pg>0){ const a = randomChoice(ATTRS); qs(`#ap-${a}`).value = (parseInt(qs(`#ap-${a}`).value||"0",10)||0) + 5; pg -= 1; }
  enforcePgLimits(); recalcAttr();
}
function randomProfs(){
  qs('#prof1').value = randomChoice(PROFESIONES.filter(x=>x!=="Ninguna"));
  qs('#prof2').value = randomChoice(PROFESIONES.filter(x=>x!=="Ninguna"));
  qs('#prof3').value = randomChoice(PROFESIONES);
  rebuildPools(); renderRunes();
}
function randomSkills(){
  Object.keys(SKILLS).forEach(r=>{
    let lim = state.pools[r]||0;
    const aprEls = qsa(`.sk-apr[data-r="${r}"]`);
    aprEls.forEach(el=>el.value=0);
    while(lim>0){ const el = randomChoice(aprEls); el.value = (parseInt(el.value||"0",10)||0) + 5; lim -= 5; }
  });
  qsa('.sk-mod').forEach(el=>el.value = random5(0,10));
  calcSkills();
}
function randomMerDef(){
  qsa('.mer,.def').forEach(ch=>ch.checked=false);
  qsa('.mer').forEach(ch=>{ if(Math.random()<0.08) ch.checked=true; });
  qsa('.def').forEach(ch=>{ if(Math.random()<0.06) ch.checked=true; });
  applyMerDefEffects();
}
function randomEconomy(){ rebuildEconomy(); }
function randomFillAll(){
  randomTypeData(); randomAttrs(); randomProfs(); randomSkills(); randomMerDef(); randomEconomy();
  generarHistoriaBreve();
  renderStatsDerivados(); buildFullSummary(); updateStepStatus(); goStep(10);
}

window.guardarJSON=guardarJSON;
window.cargarJSON=cargarJSON;
window.randomFillAll=randomFillAll;
window.randomTypeData=randomTypeData;
window.randomAttrs=randomAttrs;
window.randomProfs=randomProfs;
window.randomSkills=randomSkills;
window.randomMerDef=randomMerDef;
window.randomEconomy=randomEconomy;

function init(){
  buildStepsMenu();
  goStep(1);
  buildRazaSelect();
  buildProfSelects();
  rebuildAttrTable();
  buildSkills();
  buildMerDef();
  buildTiendaSelects();
  buildVehSelects();
  buildRefSelect();

  enforcePgLimits();
  recalcAttr();
  rebuildPools();
  recalcSkillBases();
  calcSkills();
  renderRunes();
  rebuildEconomy();
  renderStatsDerivados();
  updateHumanBoxVisibility();
  renderTienda();
  buildFullSummary();

  qs('#tipoPersonaje').addEventListener('change', ()=>{ enforcePgLimits(); recalcAttr(); recalcSkillBases(); applyMerDefEffects(); rebuildEconomy(); renderStatsDerivados(); buildFullSummary(); markDirty(1); });
  qs('#grupoPrimario').addEventListener('change', ()=>{ recalcAttr(); recalcSkillBases(); rebuildEconomy(); renderStatsDerivados(); buildFullSummary(); markDirty(2); });
  qs('#ntOrigen')?.addEventListener('change', ()=>{ recalcAttr(); recalcSkillBases(); rebuildEconomy(); renderStatsDerivados(); buildFullSummary(); markDirty(1); });
  qs('#ntTargetAttr')?.addEventListener('change', ()=>{ recalcAttr(); recalcSkillBases(); rebuildEconomy(); renderStatsDerivados(); buildFullSummary(); markDirty(1); });
  qs('#humanMode')?.addEventListener('change', ()=>{ calcSkills(); buildFullSummary(); markDirty(1); });
  qs('#humanSkill1')?.addEventListener('change', ()=>{ calcSkills(); buildFullSummary(); markDirty(1); });
  qs('#humanSkill2')?.addEventListener('change', ()=>{ calcSkills(); buildFullSummary(); markDirty(1); });
  qs('#specialMerDef')?.addEventListener('change', ()=>{ recalcAttr(); applyMerDefEffects(); rebuildEconomy(); buildFullSummary(); markDirty(6); });
}
document.addEventListener('DOMContentLoaded', init);
