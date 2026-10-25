import {parse, validate, differences, approve, assertRoundTrip, copy} from './src/comparison.js';
const $=id=>document.getElementById(id);
const frame=$('generator');
let template,labels={},base,proposal,groups=[],decisions={},generation=0;
const fileTokens={base:0,proposal:0};
let generatorQueue=Promise.resolve();
function withGenerator(action){
  const operation=generatorQueue.then(async()=>action(await generator()));
  generatorQueue=operation.catch(()=>{});
  return operation;
}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
async function generator(){
  // Una recarga evita que los campos dinámicos de una ficha contaminen la siguiente.
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No se pudo preparar el generador. Recarga la página.')),15000);frame.onload=()=>{clearTimeout(timer);resolve();};frame.src='../ficha_v4.html';});
  const win=frame.contentWindow;
  if(typeof win.collectData!=='function')throw Error('El generador v4 no está disponible.');
  return win;
}
function captureLabels(win){
  for(const el of win.document.querySelectorAll('input[id],select[id],textarea[id]')){
    const skill=el.id.startsWith('sktot-')?el.closest('tr')?.cells[0]?.textContent:null;
    const label=skill||el.labels?.[0]?.textContent?.trim().split('\n')[0];
    if(label)labels[el.id]=label;
  }
}
const ready=(async()=>{try{const w=await generator();template=copy(w.collectData());captureLabels(w);message('Listo. Selecciona dos fichas v4 completas.');}catch(e){message(e.message,true);throw e;}})();
function render(){
  $('changes').replaceChildren();
  const count=groups.filter(g=>decisions[g.id]).length;
  $('summary').textContent=base&&proposal?(groups.length?`${base.form.personaje} · ${count} de ${groups.length} cambios revisados`:'Las fichas no tienen cambios de personaje.'):'Carga las dos fichas para empezar.';
  $('download').disabled=!base||!proposal||count!==groups.length;
  for(const group of groups){
    const row=document.createElement('article');row.className='change';
    const content=document.createElement('div');const title=document.createElement('h3');title.textContent=group.label;
    const values=document.createElement('div');values.className='values';
    const text=v=>v===undefined?'(ausente)':typeof v==='object'?JSON.stringify(v,null,2):String(v);
    values.textContent=`${text(group.before)} → `;
    const after=document.createElement('span');after.className='after';after.textContent=text(group.after);values.append(after);content.append(title,values);
    if(group.changes.length>1){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Campos vinculados';details.append(summary);for(const c of group.changes){const p=document.createElement('div');p.textContent=`${c.path.join(' · ')}: ${text(c.before)} → ${text(c.after)}`;details.append(p);}content.append(details);}
    const actions=document.createElement('div');actions.className='actions';actions.setAttribute('role','group');actions.setAttribute('aria-label',group.label);
    for(const [decision,label] of [['accept','Aceptar'],['reject','Rechazar']]){const button=document.createElement('button');button.textContent=label;button.setAttribute('aria-pressed',String(decisions[group.id]===decision));button.onclick=()=>{generation++;decisions[group.id]=decision;button.setAttribute('aria-pressed','true');render();const replacement=[...$('changes').querySelectorAll('article')][groups.indexOf(group)];replacement?.querySelectorAll('button')[decision==='accept'?0:1]?.focus();message('Decisión guardada en esta revisión.');};actions.append(button);}
    row.append(content,actions);$('changes').append(row);
  }
}
for(const id of ['base','proposal'])$(id).addEventListener('change',async event=>{
  generation++;const token=++fileTokens[id];const file=event.target.files[0];
  if(id==='base')base=undefined;else proposal=undefined;
  groups=[];decisions={};render();$(id+'-info').textContent='Sin ficha válida';
  if(!file)return;
  try{
    await ready;
    if(file.size>2_000_000)throw Error('El JSON supera el límite de 2 MB.');
    const data=parse(await file.text(),template);
    message('Validando la ficha completa con el generador v4…');
    await withGenerator(win=>{win.applyData(copy(data));assertRoundTrip(data,copy(win.collectData()));});
    if(token!==fileTokens[id])return;
    if(id==='base')base=data;else proposal=data;
    $(id+'-info').textContent=data.form.personaje;
    if(base&&proposal){
      // Normaliza ambos con el adaptador del motor; la revisión conserva el export original.
      validate(base,template);validate(proposal,template);
      groups=differences(base,proposal,labels);
    }
    message('Ficha cargada. Revisa los cambios antes de descargar.');render();
  }catch(e){if(token===fileTokens[id])message(e.message,true);}
});
$('download').onclick=async()=>{
  $('download').disabled=true;const token=generation;
  try{
    const approved=approve(base,groups,decisions,template);
    message('Comprobando que la ficha se carga sin perder datos…');
    await withGenerator(win=>{win.applyData(copy(approved));assertRoundTrip(approved,copy(win.collectData()));});
    if(token!==generation)throw Error('Las fichas han cambiado durante la comprobación. Revisa la nueva comparación.');
    const blob=new Blob([JSON.stringify(approved,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`Ficha_${approved.form.personaje.replace(/[^a-z0-9áéíóúüñ_-]+/gi,'_')}_aprobada.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('Ficha aprobada descargada. Compatible con Cargar JSON del generador v4.');
  }catch(e){message(e.message,true);}finally{render();}
};
