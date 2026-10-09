import {naturalWeapon,ID,SHEET,isCompanion,trainerLevel,gains,TRICKS,TYPE_NAMES,normalize,allowedTrick,list,cleanPowerSource,learnedTricks} from './rules.mjs';
import {trainerFor,assertTrainer,mirrorMana} from './resources.mjs';
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notify = promise => Promise.resolve(promise).catch(error=>ui.notifications.warn(error.message));
let catalogPromise;
const importing=new Set();
// Native weapon forms render prepared rolls. Submit the stored base values instead,
// so companion bonuses cannot become permanent each time the editor autosaves.
export function restoreWeaponEditor(item,root) {
  if(item?.type!=='arma'||!isCompanion(item.actor)||!root?.querySelectorAll)return;
  for(const field of root.querySelectorAll('[name]')) {
    if(!/^system\.(rolls\.|critico[MX]$)/.test(field.name))continue;
    const stored=field.name.split('.').reduce((value,key)=>value?.[key],item._source);
    field.value=String(stored??'');
  }
}
export function catalog() {
  catalogPromise ??= (async()=>{
    const names=new Set([...TRICKS,...TYPE_NAMES.map(n=>`Tipo: ${n}`)].map(normalize));
    const results=[];
    for(const pack of game.packs.filter(p=>p.documentName==='Item'&&p.visible)) {
      let index;try{index=await pack.getIndex();}catch{continue;}
      for(const row of index)if(row.type==='poder' && names.has(normalize(row.name)))results.push({uuid:`Compendium.${pack.collection}.Item.${row._id}`,name:row.name,img:row.img,source:pack.title??pack.metadata.label});
    }
    return results;
  })().catch(error=>{catalogPromise=null;throw error;});
  return catalogPromise;
}
export async function linkTrainer(actor,trainer) {
  if(!actor.isOwner)throw new Error('Você precisa controlar o Melhor Amigo para vincular a ficha.');
  if(trainer?.documentName!=='Actor'||trainer.uuid===actor.uuid||isCompanion(trainer)||trainer.type!=='character'||trainerLevel(trainer)<1)throw new Error('Arraste a ficha de um personagem com a classe Treinador.');
  if(trainer.pack)throw new Error('Importe o treinador para o mundo antes de vincular.');
  if(!trainer.testUserPermission(game.user,'OBSERVER'))throw new Error('Você precisa ter acesso à ficha do treinador.');
  await actor.update({[`flags.${ID}.companion`]:true,[`flags.${ID}.trainerUuid`]:trainer.uuid,'flags.core.sheetClass':SHEET});
  actor.reset();actor.sheet.render(false);
}
export function panelHTML(actor) {
  const trainer=trainerFor(actor), readable=trainer?.testUserPermission(game.user,'OBSERVER');
  const g=gains(actor,readable?trainer:null), chosen=learnedTricks(actor).length;
  const pool=(key)=>{const r=trainer.system.attributes[key];return `${Number(r.value)||0} / ${Number(r.max)||0}${r.temp?` (+${r.temp})`:''}`;};
  return `<section class="t20ma-trainer-card ${readable?'is-linked':'is-unlinked'}" aria-label="Vínculo com o treinador">
    ${readable?`<button type="button" class="t20ma-trainer-portrait" data-ma-action="trainer" title="Abrir ficha do treinador"><img src="${escape(trainer.img)}" alt="${escape(trainer.name)}"></button>`:'<span class="t20ma-link-mark"><i class="fas fa-paw" aria-hidden="true"></i></span>'}
    <div class="t20ma-trainer-identity"><span class="t20ma-eyebrow">MELHOR AMIGO · ${escape(g.partner)}</span><strong>${readable?escape(trainer.name):'Vincule seu treinador'}</strong><small>${readable?`Treinador ${g.classLevel} · Nível da ficha ${g.effective}`:'Arraste a ficha do treinador para cá'}</small></div>
    ${readable?`<div class="t20ma-owner-resources"><span class="t20ma-owner-pv"><i class="fas fa-heart"></i> <b>${pool('pv')}</b><small>PV do treinador</small></span><span class="t20ma-owner-pm"><i class="fas fa-droplet"></i> <b>${pool('pm')}</b><small>PM compartilhados</small></span></div>`:''}
    <div class="t20ma-trainer-tools">${actor.isOwner?`<button type="button" data-ma-action="choose" title="Escolher treinador"><i class="fas fa-link"></i></button>${readable?'<button type="button" data-ma-action="unlink" title="Desvincular treinador"><i class="fas fa-link-slash"></i></button>':''}`:''}</div>
    <div class="t20ma-growth"><span><i class="fas fa-shield-halved"></i> RD ${escape(actor.system?.tracos?.resistencias?.dano?.value??0)}</span><span><i class="fas fa-star"></i> Truques ${chosen}/${g.tricks}</span>${g.intensive?`<span><i class="fas fa-heart-circle-plus"></i> Treino Intensivo · +${g.hpPerLevel} PV/nível</span>`:''}${actor.isOwner?'<button type="button" data-ma-action="library"><i class="fas fa-paw"></i> Tipo e truques</button><button type="button" data-ma-action="evolve"><i class="fas fa-arrow-up"></i> Evoluir</button><button type="button" data-ma-action="teach" title="Atribuir um poder Ensinar Truque do treinador"><i class="fas fa-graduation-cap"></i> Ensinar truque</button>':''}</div>
    ${actor.isOwner&&actor.flags?.[ID]?.reanimatedScene?'<button type="button" class="t20ma-new-scene" data-ma-action="scene" title="Liberar Reanimação Sombria depois que a cena narrativa terminou">Nova cena narrativa</button>':''}
  </section>`;
}
export function mountPanel(root,actor,actions={}) {
  root.querySelector('.t20ma-trainer-card')?.remove();
  const main=root.querySelector('.t20ga-main');if(!main)return;
  const holder=document.createElement('div');holder.innerHTML=panelHTML(actor);
  const panel=holder.firstElementChild;main.prepend(panel);
  root.classList.add('t20ma-sheet');
  const bookHeading=root.querySelector('.t20ga-style-dossier > .t20ga-book-heading');if(bookHeading)bookHeading.textContent='Dossiê de companheiro';
  panel.addEventListener('click',event=>{const key=event.target.closest('[data-ma-action]')?.dataset.maAction;if(key&&actions[key]){event.preventDefault();notify(actions[key]());}});
  for(const input of root.querySelectorAll('[name^="system.attributes.pm."]')){
    input.readOnly=true;input.disabled=true;input.removeAttribute('name');input.title='Este recurso pertence ao treinador vinculado.';
  }
  for(const label of root.querySelectorAll('.mana .attribute-name,.mana .box-title')){label.textContent='PM';label.title='PM compartilhados com o treinador';}
  for(const input of root.querySelectorAll('[name="system.attributes.nivel.value"]')){input.disabled=true;input.removeAttribute('name');}
}
async function chooseTrainer(actor) {
  const trainers=game.actors.filter(t=>t.type==='character'&&!isCompanion(t)&&trainerLevel(t)>0&&t.testUserPermission(game.user,'OBSERVER'));
  if(!trainers.length)throw new Error('Nenhum treinador disponível. Crie ou importe a ficha e conceda acesso a ela.');
  const selected=await foundry.applications.api.DialogV2.prompt({window:{title:'Vincular treinador'},content:`<p>O Melhor Amigo usará os PM do treinador selecionado.</p><label>Treinador <select name="trainer">${trainers.map(t=>`<option value="${escape(t.id)}">${escape(t.name)}</option>`).join('')}</select></label>`,ok:{label:'Vincular',callback:(event,button)=>button.form.elements.trainer.value}});
  if(selected)await linkTrainer(actor,game.actors.get(selected));
}
function choiceDialog(title,label,options){return foundry.applications.api.DialogV2.prompt({window:{title},content:`<label>${escape(label)} <select name="choice">${Object.entries(options).map(([k,v])=>`<option value="${escape(k)}">${escape(v)}</option>`).join('')}</select></label>`,ok:{label:'Escolher',callback:(event,button)=>button.form.elements.choice.value}});}
export async function configureImportedPower(actor, data) {
  const name=normalize(data.name);
  if(name==='condicionamento especial') {
    const attributes={for:'Força',des:'Destreza',con:'Constituição',sab:'Sabedoria',car:'Carisma'};
    const first=await choiceDialog(data.name,'Atributo que recebe +2',attributes);if(!first)return null;
    const second=await choiceDialog(data.name,'Atributo que recebe +1',Object.fromEntries(Object.entries(attributes).filter(([k])=>k!==first)));if(!second)return null;
    for(const effect of data.effects??[])for(let i=0;i<effect.changes.length;i++)if(effect.changes[i].key.includes('???'))effect.changes[i].key=`system.atributos.${Number(effect.changes[i].value)===2?first:second}.racial`;
    data.flags??={};data.flags[ID]={...(data.flags[ID]??{}),tier:gains(actor,trainerFor(actor)).tier};
  }
  if(name==='deslocamento especial') {
    const existing=new Set(list(actor).filter(i=>normalize(i.name)===name).map(i=>i.flags?.[ID]?.movement));
    const move=await choiceDialog(data.name,'Deslocamento',Object.fromEntries(Object.entries({climb:'Escalada',swim:'Natação'}).filter(([key])=>!existing.has(key))));if(!move)return null;
    data.effects??=[];data.effects.push({name:data.name,transfer:true,changes:[{key:`system.attributes.movement.${move}.base`,mode:5,value:'@attributes.movement.walk.base'}]});
    data.flags??={};data.flags[ID]={...(data.flags[ID]??{}),movement:move};
  }
  if(name==='sopro') {
    const energy=await choiceDialog(data.name,'Tipo de dano',{acido:'Ácido',fogo:'Fogo',frio:'Frio',eletricidade:'Eletricidade'});if(!energy)return null;
    for(const roll of data.system.rolls??[])for(const part of roll.parts??[])part[1]=energy;
    data.system.resistencia={...data.system.resistencia,atributo:'car',txt:'Reflexos reduz à metade'};
    data.flags??={};data.flags[ID]={...(data.flags[ID]??{}),energy};
  }
  if(name==='magia inata'){
    const spells=[];
    for(const pack of game.packs.filter(p=>p.documentName==='Item'&&p.visible)){
      let index;try{index=await pack.getIndex({fields:['system.circulo']});}catch{continue;}
      for(const row of index)if(row.type==='magia'&&Number(row.system?.circulo)===1)spells.push({uuid:`Compendium.${pack.collection}.Item.${row._id}`,name:row.name});
    }
    const owned=new Set(list(actor).filter(i=>i.type==='magia').map(i=>normalize(i.name)));
    const available=spells.filter(s=>!owned.has(normalize(s.name)));
    if(!available.length)throw new Error('Nenhuma magia de 1º círculo disponível nos compêndios liberados.');
    const uuid=await choiceDialog(data.name,'Magia de 1º círculo',Object.fromEntries(available.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(s=>[s.uuid,s.name])));if(!uuid)return null;
    data.flags??={};data.flags[ID]={...data.flags[ID],spell:uuid};
  }
  return data;
}
export async function importPower(actor,uuid) {
  const original=await fromUuid(uuid);if(original?.documentName!=='Item'||original.type!=='poder')throw new Error('Este documento não é um poder válido.');
  if(![...TRICKS,...TYPE_NAMES.map(n=>`Tipo: ${n}`)].map(normalize).includes(normalize(original.name)))throw new Error('Escolha um tipo ou truque próprio do Melhor Amigo.');
  const type=normalize(original.name).startsWith('tipo ');
  const reason=type ? '' : allowedTrick(original.name,actor,trainerFor(actor));if(reason)throw new Error(reason);
  if(type&&list(actor).some(i=>normalize(i.name).startsWith('tipo ')))throw new Error('A ficha já possui um tipo. Remova o tipo anterior antes de escolher outro.');
  if(!actor.isOwner||!original.testUserPermission(game.user,'OBSERVER'))throw new Error('Você não tem permissão para importar este poder.');
  if(importing.has(actor.uuid))throw new Error('Aguarde a escolha anterior terminar.');
  importing.add(actor.uuid);
  try {
  let data=cleanPowerSource(original.toObject());
  data.flags??={};data.flags.core={...data.flags.core,sourceId:uuid};
  data=await configureImportedPower(actor,data);if(!data)return;
  const additional=[];
  if(data.flags?.[ID]?.spell){
    const originalSpell=await fromUuid(data.flags[ID].spell);if(!originalSpell?.testUserPermission(game.user,'OBSERVER'))throw new Error('Magia indisponível.');
    const spell=originalSpell.toObject();delete spell._id;delete spell.folder;delete spell._stats;
    for(const effect of spell.effects??[]){delete effect._id;delete effect.origin;}
    spell.system.resistencia={...spell.system.resistencia,atributo:'car'};spell.flags??={};spell.flags[ID]={innate:true};additional.push(spell);
  }
  if(normalize(data.name)==='arma natural adicional'){const damage=await choiceDialog(data.name,'Tipo de dano',{perfuracao:'Perfuração',corte:'Corte',impacto:'Impacto'});if(!damage)return;additional.push(naturalWeapon(damage,true));}
  // Recheck immediately before writing, including changes from another open window.
  const invalid=type?'':allowedTrick(original.name,actor,trainerFor(actor));if(invalid)throw new Error(invalid);
  await actor.createEmbeddedDocuments('Item',[data,...additional]);
  if(normalize(data.name)==='anatomia humanoide')await actor.deleteEmbeddedDocuments('Item',list(actor).filter(i=>i.flags?.[ID]?.natural).map(i=>i.id));
  actor.sheet.render(false);
  }finally{importing.delete(actor.uuid);} 
}
export async function library(actor) {
  const entries=await catalog();
  if(!entries.length)throw new Error('Não encontrei os tipos e truques nos compêndios disponíveis. Você também pode arrastar poderes para a ficha.');
  const body=document.createElement('div'); // DialogV2 requires an attribute-free content element.
  body.innerHTML='<p>Os poderes são importados dos seus compêndios, mantendo descrições, ícones e efeitos.</p><input type="search" placeholder="Buscar tipo ou truque" aria-label="Buscar tipo ou truque"><div class="t20ma-library-list"></div>';
  const mount=dialog=>{
  const root=dialog.element.querySelector('.dialog-content');
  const container=root.querySelector('.t20ma-library-list');
  const draw=()=>{
    const search=normalize(root.querySelector('input').value);
    const g=gains(actor,trainerFor(actor));
    container.innerHTML=`<p class="t20ma-library-count">${g.tricks} espaços de truques · treinador nível ${g.classLevel}</p>`+entries.filter(e=>normalize(e.name).includes(search)).map(e=>{
      const type=normalize(e.name).startsWith('tipo '), reason=!actor.isOwner?'Você precisa controlar esta ficha.':type?(list(actor).some(i=>normalize(i.name).startsWith('tipo '))?'A ficha já possui um tipo.':''):allowedTrick(e.name,actor,trainerFor(actor));
      return `<article><img src="${escape(e.img)}" alt=""><div><strong>${escape(e.name)}</strong><small>${escape(reason||e.source)}</small></div><button type="button" data-view="${escape(e.uuid)}" title="Consultar poder"><i class="fas fa-book-open"></i></button><button type="button" data-import="${escape(e.uuid)}" ${reason?'disabled':''} title="Aprender"><i class="fas fa-plus"></i></button></article>`;
    }).join('');
  };
  draw();root.querySelector('input').addEventListener('input',draw);
  root.addEventListener('click',event=>{
    const view=event.target.closest('[data-view]')?.dataset.view;if(view)notify(fromUuid(view).then(i=>{if(!i?.testUserPermission(game.user,'OBSERVER'))throw new Error('Poder indisponível.');return i.sheet.render(true);}));
    const uuid=event.target.closest('[data-import]')?.dataset.import;if(uuid)notify(importPower(actor,uuid).then(draw));
  });
  };
  const dialog=new foundry.applications.api.DialogV2({window:{title:'Melhor Amigo · Tipo e truques'},position:{width:680,height:600},content:body,buttons:[{action:'close',label:actor.flags?.[ID]?.creationComplete===false?'Concluir criação':'Fechar',default:true,callback:async()=>{if(actor.flags?.[ID]?.creationComplete===false)await actor.setFlag(ID,'creationComplete',true);}}]});
  dialog.addEventListener('render',()=>mount(dialog));
  return dialog.render({force:true});
}
export function registerCompanionSheet() {
  const Base=globalThis.T20FichaHeroica?.ActorSheet;if(!Base)throw new Error('Ative a Ficha Heroica para usar a ficha Melhor Amigo.');
  class ActorSheetT20MelhorAmigo extends Base {
    static get defaultOptions(){return foundry.utils.mergeObject(super.defaultOptions,{classes:[...super.defaultOptions.classes,'t20ma-window']});}
    async getData(...args){mirrorMana(this.actor);return super.getData(...args);}
    activateListeners(html){
      super.activateListeners(html);
      mountPanel(html[0],this.actor,{trainer:()=>trainerFor(this.actor)?.sheet.render(true),choose:()=>chooseTrainer(this.actor),unlink:()=>this.actor.unsetFlag(ID,'trainerUuid'),library:()=>library(this.actor),evolve:()=>game.modules.get(ID).api.openEvolution(this.actor),teach:()=>teachTrick(this.actor),scene:async()=>{if(await foundry.applications.api.DialogV2.confirm({window:{title:'Nova cena narrativa'},content:'<p>Confirme com o mestre que a cena terminou. Isso libera um novo uso de Reanimação Sombria.</p>'}))await this.actor.unsetFlag(ID,'reanimatedScene');}});
    }
    async _onDropActor(event,data){try{const actor=await CONFIG.Actor.documentClass.fromDropData(data);await linkTrainer(this.actor,actor);}catch(error){ui.notifications.warn(error.message);}return false;}
    async _onDropItem(event,data){
      const item=await CONFIG.Item.documentClass.fromDropData(data);
      if(item?.type==='classe'){ui.notifications.warn('O nível desta ficha acompanha o treinador. Ela usa somente a classe Melhor Amigo.');return false;}
      if(item?.type==='poder'&&(TRICKS.map(normalize).includes(normalize(item.name))||normalize(item.name).startsWith('tipo '))){try{await importPower(this.actor,item.uuid);}catch(error){ui.notifications.warn(error.message);}return false;}
      return super._onDropItem(event,data);
    }
  }
  foundry.documents.collections.Actors.registerSheet(ID,ActorSheetT20MelhorAmigo,{types:['character'],makeDefault:false,label:'Melhor Amigo'});
  return ActorSheetT20MelhorAmigo;
}

export async function teachTrick(actor){
  const trainer=assertTrainer(actor,{spend:true});
  const taught=game.actors.filter(a=>isCompanion(a)).flatMap(a=>a.flags?.[ID]?.taughtBy??[]);
  const available=list(trainer).filter(i=>normalize(i.name)==='ensinar truque'&&!taught.includes(i.uuid));
  if(!available.length)throw new Error('Nenhum poder Ensinar Truque livre na ficha do treinador. Adquira esse poder pela evolução dele.');
  const uuid=await choiceDialog('Ensinar truque','Poder do treinador',Object.fromEntries(available.map((i,n)=>[i.uuid,`${i.name} ${n+1}`])));if(!uuid)return;
  if(!trainer.isOwner)throw new Error('Você perdeu acesso ao treinador.');
  if(game.actors.some(a=>(a.flags?.[ID]?.taughtBy??[]).includes(uuid)))throw new Error('Esse poder já foi atribuído a um Melhor Amigo.');
  await actor.setFlag(ID,'taughtBy',[...(actor.flags?.[ID]?.taughtBy??[]),uuid]);
  return library(actor);
}
