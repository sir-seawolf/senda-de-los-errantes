import {desdeExportFichaAutocalculada, normalizeCharacter} from '../vendor/motor/characterImport.js';
import formSchema from './form-schema.json' with {type:'json'};

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const copy = x => structuredClone(x);
export const equal = (a,b) => {
  if (Object.is(a,b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v,i)=>equal(v,b[i]));
  return object(a) && object(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
};
function safeTree(value, depth=0) {
  if (depth > 30) throw Error('JSON demasiado anidado (máximo 30 niveles).');
  // La ficha original inserta texto en HTML al renderizar. No ejecutar marcado importado.
  if(typeof value==='string'&&/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error('La ficha contiene marcado HTML o caracteres de control no permitidos. Exporta texto sin etiquetas.');
  if (value && typeof value === 'object') for (const [k,v] of Object.entries(value)) {
    if (['__proto__','prototype','constructor'].includes(k)) throw Error('El JSON contiene una clave no permitida.');
    safeTree(v,depth+1);
  }
}
export function validate(data, template) {
  safeTree(data);
  if (!object(data) || data.version !== 4) throw Error('Se requiere una ficha versión 4, exportada con Guardar JSON.');
  if (!object(data.form) || !object(data.state)) throw Error('Ficha incompleta: faltan form o state. Vuelve a exportarla desde el generador.');
  if (typeof data.exportedAt !== 'string' || !Number.isFinite(Date.parse(data.exportedAt))) throw Error('Ficha incompleta: falta una fecha exportedAt válida.');
  const types={step:'number',dirtyFrom:'nullableNumber',pools:'object',selectedMer:'array',selectedDef:'array',runes:'array',effectiveProfs:'array',compras:'array',armadura:'nullableObject',historia:'string'};
  for (const [key,type] of Object.entries(types)) {
    const v=data.state[key];
    const valid=type==='array'?Array.isArray(v):type==='object'?object(v):type==='nullableObject'?(v===null||object(v)):type==='nullableNumber'?(v===null||Number.isFinite(v)):typeof v===type;
    if (!Object.hasOwn(data.state,key)||!valid) throw Error(`Ficha incompleta o inválida: state.${key}.`);
  }
  if (!Number.isInteger(data.state.step)||data.state.step<1||data.state.step>10) throw Error('Paso de ficha inválido.');
  for(const k of ['selectedMer','selectedDef','effectiveProfs'])if(!data.state[k].every(v=>typeof v==='string'))throw Error(`Lista inválida: state.${k}.`);
  for(const item of data.state.compras)if(!object(item)||typeof item.tipo!=='string'||typeof item.n!=='string'||!Number.isFinite(item.precio)||!Number.isFinite(item.hum))throw Error('Compra incompleta en state.compras.');
  for(const item of data.state.runes)if(!object(item)||typeof item.name!=='string'||!Number.isFinite(item.level))throw Error('Runa incompleta en state.runes.');
  if(data.state.armadura!==null&&(!Number.isFinite(data.state.armadura.bld)||!Number.isFinite(data.state.armadura.precio)||typeof data.state.armadura.n!=='string'))throw Error('Armadura incompleta en state.armadura.');
  for (const [k,v] of Object.entries(data.form)) if (!['string','boolean','number'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)) throw Error(`Valor de formulario inválido: ${k}.`);
  for (const [k,type] of Object.entries(formSchema)) if (!Object.hasOwn(data.form,k)||typeof data.form[k]!==type) throw Error(`Ficha incompleta o inválida: form.${k}. Vuelve a exportarla completa.`);
  if (template) for (const [k,v] of Object.entries(template.form)) {
    // El generador numera controles sin id según su posición, que cambia con las runas.
    if (/^(INPUT|SELECT|TEXTAREA)_\d+$/.test(k)) continue;
    if (!Object.hasOwn(data.form,k)||typeof data.form[k]!==typeof v) throw Error(`Ficha incompleta o inválida: form.${k}. Vuelve a exportarla completa.`);
  }
  try {return normalizeCharacter(desdeExportFichaAutocalculada(data));}
  catch(e){throw Error([e.message,...(e.detalles||[])].join(' '));}
}
export function parse(text,template) {
  if (text.length>2_000_000) throw Error('El JSON supera el límite de 2 MB.');
  let data;
  try{data=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('JSON inválido. Selecciona el archivo exportado por la ficha v4.');}
  validate(data,template); return data;
}
export function differences(base, proposal, labels={}) {
  const changes=[];
  const walk=(a,b,path)=>{
    if(equal(a,b))return;
    if(object(a)&&object(b)){
      for(const k of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[k],b[k],[...path,k]);
    }else changes.push({path,before:copy(a),after:copy(b)});
  };
  walk(base,proposal,[]);
  const groups=new Map();
  for(const change of changes){
    const [root,key]=change.path;
    if(root==='exportedAt'||root==='state'&&['step','dirtyFrom'].includes(key))continue;
    const skill=root==='form'&&/^(?:skb|skapr|skmod|sktot)-(.+)-(\d+)$/.exec(key);
    const id=skill?`skill:${skill[1]}:${skill[2]}`:JSON.stringify(change.path);
    if(!groups.has(id))groups.set(id,{id,label:skill?(labels[`sktot-${skill[1]}-${skill[2]}`]||key):(labels[key]||change.path.join(' · ')),changes:[]});
    groups.get(id).changes.push(change);
  }
  return [...groups.values()].map(g=>{
    const total=g.changes.find(c=>/^sktot-/.test(c.path[1]));
    return {...g,before:total?total.before:g.changes[0].before,after:total?total.after:g.changes[0].after};
  });
}
export function approve(base, groups, decisions, template){
  const result=copy(base);
  for(const group of groups){
    if(!['accept','reject'].includes(decisions[group.id]))throw Error('Decide aceptar o rechazar todos los cambios antes de descargar.');
    if(decisions[group.id]==='reject')continue;
    for(const {path,after} of group.changes){
      let target=result;
      for(const key of path.slice(0,-1))target=target[key];
      const key=path.at(-1);
      if(after===undefined)delete target[key]; else target[key]=copy(after);
    }
  }
  validate(result,template);return result;
}
export function assertRoundTrip(original,loaded){
  // Metadatos de navegación y fecha no son contenido de personaje.
  const clean=x=>{const d=copy(x);delete d.exportedAt;delete d.state.step;delete d.state.dirtyFrom;return d;};
  if(!equal(clean(original),clean(loaded))){
    const fields=differences(original,loaded).flatMap(g=>g.changes.map(c=>c.path.join('.'))).slice(0,5).join(', ');
    throw Error(`Esta combinación cambia al cargarla en la ficha: hay campos dependientes o datos que el generador no conserva (${fields}). Revisa las decisiones relacionadas y vuelve a intentarlo. No se ha descargado nada.`);
  }
}
