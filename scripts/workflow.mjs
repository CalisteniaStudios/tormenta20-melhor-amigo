import {ID,SHEET,creationData,naturalWeapon,creationSkills,initialSkillTraining,TYPE_NAMES,normalize,list,isCompanion,gains,trainerLevel,cleanPowerSource} from './rules.mjs';
import {trainerFor} from './resources.mjs';
import {catalog,importPower,library,linkTrainer} from './sheet.mjs';
export const escape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const trainers=()=>game.actors.filter(t=>t.type==='character'&&!isCompanion(t)&&trainerLevel(t)>0&&t.isOwner&&!t.pack);
const options=entries=>entries.map(([k,v])=>`<option value="${escape(k)}">${escape(v)}</option>`).join('');
const opening=new Set();
export async function createCompanion(initial={}) {
  if(opening.has('create'))return;
  opening.add('create');
  try {
    if(!game.user.can('ACTOR_CREATE'))throw new Error('Peça ao mestre a permissão para criar atores.');
    const owners=trainers();if(!owners.length)throw new Error('Crie uma ficha de Treinador que você possa editar antes de criar o Melhor Amigo.');
    const entries=await catalog(), types=TYPE_NAMES.map(name=>entries.find(i=>normalize(i.name)===normalize(`Tipo: ${name}`))).filter(Boolean);
    if(!types.length)throw new Error('Os tipos do Melhor Amigo não estão disponíveis. Ative o compêndio de Heróis de Arton e libere o acesso.');
    const skills=creationSkills(CONFIG.T20?.pericias,label=>game.i18n.localize(label));
    const body=document.createElement('div'); // DialogV2 requires an attribute-free content element.
    body.innerHTML=`<div class="t20ma-dialog-heading"><i class="fas fa-paw"></i><div><small>FORJA HEROICA</small><h2>Um vínculo para toda a aventura</h2></div></div>
      <p>Crie seu Melhor Amigo no nível do treinador. Os PM e o atributo-chave de suas magias pertencem a ele.</p>
      <div class="t20ma-form-grid"><label>Nome<input name="name" required value="${escape(initial.name||'Melhor Amigo')}"></label><label>Treinador<select name="trainer">${options(owners.map(t=>[t.id,t.name]))}</select></label>
      <label>Tipo<select name="kind">${options(types.map(t=>[t.uuid,t.name.replace('Tipo: ', '')]))}</select></label>
      <label>Tamanho<select name="size">${options([['peq','Pequeno'],['med','Médio'],['gra','Grande']])}</select></label>
      <fieldset class="t20ma-initial-skills"><legend>Perícias iniciais</legend><p>Escolha três perícias diferentes.</p><div class="t20ma-skill-choices">${['Primeira perícia','Segunda perícia','Terceira perícia'].map((label,index)=>`<label>${label}<select name="skill${index+1}" required><option value="">Escolha uma perícia</option>${options(skills)}</select></label>`).join('')}</div></fieldset>
      <label data-primary-weapon>Dano da arma natural<select name="damage">${options([['perfuracao','Perfuração'],['corte','Corte'],['impacto','Impacto']])}</select></label>
      <fieldset class="t20ma-extra-weapon" hidden><legend>Segunda arma natural do Monstro</legend><p>Ao agredir com outra arma, pode usar esta arma para um ataque extra gastando 1 PM do treinador.</p><label>Tipo de dano da segunda arma<select name="extraDamage">${options([['impacto','Impacto'],['corte','Corte'],['perfuracao','Perfuração']])}</select></label></fieldset>
      <label>Retrato<div class="t20ma-file-row"><input name="portrait" placeholder="Escolha uma imagem do Foundry"><button type="button" data-picker="portrait" title="Escolher retrato"><i class="fas fa-folder-open"></i></button></div></label>
      <label>Token<div class="t20ma-file-row"><input name="token" placeholder="Opcional, usa o retrato"><button type="button" data-picker="token" title="Escolher token"><i class="fas fa-folder-open"></i></button></div></label></div>`;
    const mount=dialog=>{
      const root=dialog.element.querySelector('.dialog-content');
      root.classList.add('t20ma-creation');
      root.querySelector('[name=size]').value='med';
      const updateType=()=>{
        const kind=normalize(types.find(t=>t.uuid===root.querySelector('[name=kind]').value)?.name);
        const extra=root.querySelector('.t20ma-extra-weapon');
        extra.hidden=kind!=='tipo monstro';extra.querySelector('select').disabled=extra.hidden;
        const primary=root.querySelector('[data-primary-weapon]');
        primary.hidden=kind==='tipo espirito';primary.querySelector('select').disabled=primary.hidden;
      };
      updateType();
      root.addEventListener('change',event=>{
        if(event.target.name==='kind')updateType();
        if(!/^skill[123]$/.test(event.target.name))return;
        const selects=[...root.querySelectorAll('.t20ma-skill-choices select')];
        for(const select of selects)for(const option of select.options)option.disabled=Boolean(option.value && selects.some(other=>other!==select&&other.value===option.value));
      });
      root.addEventListener('click',event=>{const key=event.target.closest('[data-picker]')?.dataset.picker;if(!key)return;const Picker=foundry.applications.apps.FilePicker.implementation;new Picker({type:'image',callback:path=>{root.querySelector(`[name=${key}]`).value=path;}}).browse();});
    };
    const choice=await foundry.applications.api.DialogV2.prompt({window:{title:'Forja Heroica · Criar Melhor Amigo'},position:{width:680},content:body,render:(_event,dialog)=>mount(dialog),ok:{label:'Criar e escolher truques',callback:(event,button)=>{
      const fields=button.form.elements;
      initialSkillTraining([fields.skill1.value,fields.skill2.value,fields.skill3.value],skills);
      if(!fields.name.value.trim())throw new Error('Informe o nome do Melhor Amigo.');
      return Object.fromEntries(['name','trainer','kind','size','skill1','skill2','skill3','damage','extraDamage','portrait','token'].map(k=>[k,fields[k].value]));
    }}});
    if(!choice)return;
    const trainer=game.actors.get(choice.trainer);if(!trainer?.isOwner||trainerLevel(trainer)<1)throw new Error('O treinador mudou. Abra a criação novamente.');
    const update=initialSkillTraining([choice.skill1,choice.skill2,choice.skill3],creationSkills(CONFIG.T20?.pericias,label=>game.i18n.localize(label)));
    const data=creationData({...initial,name:choice.name.trim(),img:choice.portrait||'icons/creatures/abilities/paw-print-orange.webp'});
    data.flags[ID].trainerUuid=trainer.uuid;data.system.tracos.tamanho=choice.size;
    data.prototypeToken.texture={src:choice.token||data.img};
    data.items[0].system.niveis=gains({items:[],flags:{}},trainer).effective;
    const type=await fromUuid(choice.kind);if(!type?.testUserPermission(game.user,'OBSERVER'))throw new Error('O tipo não está mais disponível.');
    const source=cleanPowerSource(type.toObject());
    source.flags??={};source.flags.core={...source.flags.core,sourceId:choice.kind};data.items.push(source);
    const isSpirit=normalize(type.name)==='tipo espirito';
    if(!isSpirit)data.items.push(naturalWeapon(choice.damage));
    if(normalize(type.name)==='tipo monstro')data.items.push(naturalWeapon(choice.extraDamage,true));
    const actor=await CONFIG.Actor.documentClass.create(data,{renderSheet:false});if(!actor)return;
    try {
      await actor.update(update);actor.reset();
      await actor.update({'system.attributes.pv.value':actor.system.attributes.pv.max});
    } catch(error) {
      try {await actor.delete();}catch(cleanup){console.error(`${ID} | Ficha incompleta`,actor.uuid,cleanup);ui.notifications.error(`Não foi possível remover a ficha incompleta ${actor.name}. Peça ao mestre para conferir.`);}
      throw error;
    }
    actor.sheet.render(true);await library(actor);
    return actor;
  } finally {opening.delete('create');}
}
export async function evolveCompanion(actor) {
  if(!actor){
    const companions=game.actors.filter(a=>isCompanion(a)&&a.isOwner&&!a.pack);
    if(!companions.length)throw new Error('Você ainda não possui um Melhor Amigo. Use Criar Melhor Amigo.');
    const id=await foundry.applications.api.DialogV2.prompt({window:{title:'Forja Heroica · Evoluir Melhor Amigo'},content:`<label>Melhor Amigo<select name="actor">${options(companions.map(a=>[a.id,a.name]))}</select></label>`,ok:{label:'Continuar',callback:(event,button)=>button.form.elements.actor.value}});
    if(!id)return;actor=game.actors.get(id);
  }
  if(!isCompanion(actor)||!actor.isOwner)throw new Error('Escolha um Melhor Amigo que você possa editar.');
  const trainer=trainerFor(actor);if(!trainer?.testUserPermission(game.user,'OBSERVER'))throw new Error('Vincule um treinador disponível antes de evoluir.');
  if(opening.has(actor.uuid))return;opening.add(actor.uuid);
  try {
    actor.reset();
    const g=gains(actor,trainer), current=list(actor).find(i=>i.type==='classe'&&normalize(i.name)==='melhor amigo');
    if(!current)throw new Error('A ficha precisa da classe Melhor Amigo.');
    const before=Number(current._source?.system.niveis??current.system.niveis);
    const confirmation=await foundry.applications.api.DialogV2.confirm({window:{title:`Forja Heroica · ${actor.name}`},content:`<div class="t20ma-evolution-preview"><i class="fas fa-paw"></i><h2>${escape(actor.name)}</h2><p>Treinador: <b>${escape(trainer.name)}</b></p><div class="t20ma-level-preview">${before} <i class="fas fa-arrow-right"></i> ${g.effective}</div><p>PV máximos: <b>${actor.system.attributes.pv.max}</b> · Defesa: <b>${actor.system.attributes.defesa.value}</b> · RD: <b>${escape(actor.system.tracos.resistencias.dano.value)}</b></p><p>${g.tricks} espaços de truques. ${g.intensive?'Treino Intensivo aplicado, sem duplicar bônus.':''}</p><p>O nível acompanha o treinador. Seus PV atuais serão preservados. Confira e escolha os truques disponíveis na próxima tela.</p></div>`});
    if(!confirmation)return;
    const fresh=gains(actor,trainerFor(actor));if(fresh.classLevel!==g.classLevel||fresh.effective!==g.effective)throw new Error('O nível do treinador mudou durante a prévia. Revise a evolução novamente.');
    await actor.updateEmbeddedDocuments('Item',[{_id:current.id,'system.niveis':g.effective,'system.pvPorNivel':4,'system.pmPorNivel':0,'system.inicial':true}]);
    await actor.update({[`flags.${ID}.creationComplete`]:true,[`flags.${ID}.reviewedTrainerLevel`]:g.classLevel});
    actor.sheet.render(false);await library(actor);return actor;
  } finally {opening.delete(actor.uuid);}
}
