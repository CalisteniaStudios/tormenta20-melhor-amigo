import {ID,SHEET,VIRTUAL_TYPE,isCompanion,normalize,list,gains,initialAttributeCorrection} from './rules.mjs';
import {installMechanics} from './mechanics.mjs';
import {installResourceRouting,trainerFor} from './resources.mjs';
import {registerCompanionSheet,linkTrainer,library,restoreWeaponEditor} from './sheet.mjs';
import {createCompanion,evolveCompanion} from './workflow.mjs';
let initialized=false;
const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>{console.error(`${ID} |`,error);ui.notifications.error(error.message);});
export function installCreationOption(){
  const ActorClass=CONFIG.Actor.documentClass, createDialog=ActorClass.createDialog, create=ActorClass.create;
  ActorClass.createDialog=function(data={},options={},dialog={}){
    if(options.pack || options.parent || (dialog.types&&!dialog.types.includes('character')))return createDialog.call(this,data,options,dialog);
    const types=this.TYPES.filter(type=>type!=='base'&&(!dialog.types||dialog.types.includes(type))).map(value=>{const key=CONFIG.Actor.typeLabels[value];return {value,label:game.i18n.has(key)?game.i18n.localize(key):value};});
    types.push({value:VIRTUAL_TYPE,label:'Melhor Amigo'});types.sort((a,b)=>a.label.localeCompare(b.label,game.i18n.lang));
    return createDialog.call(this,data,options,{...dialog,context:{...dialog.context,types}});
  };
  ActorClass.create=function(data={},options={}){
    if(data.type===VIRTUAL_TYPE)return createCompanion(data);
    return create.call(this,data,options);
  };
}
export function refreshCompanions(trainer){
  if(!initialized||!trainer)return;
  for(const actor of game.actors.filter(a=>isCompanion(a)&&a.flags?.[ID]?.trainerUuid===trainer.uuid)){
    // reset() rebuilds prepared bonuses from source before applying effects again.
    actor.reset();if(actor.sheet?.rendered)actor.sheet.render(false);
    for(const token of actor.getActiveTokens())token.renderFlags?.set({refreshBars:true});
  }
}
Hooks.once('setup',()=>{
  if(game.system.id!=='tormenta20')return;
  try{
    if(!globalThis.T20FichaHeroica?.ActorSheet)throw new Error('Ative Tormenta20: Ficha Heroica para usar Melhor Amigo.');
    const NativeUseDialog=globalThis.tormenta20?.applications?.AbilityUseDialog;
    if(typeof NativeUseDialog?.create!=='function')throw new Error('Não foi possível acessar a janela de habilidades do sistema Tormenta20.');
    const Sheet=registerCompanionSheet();installMechanics();installResourceRouting(NativeUseDialog);installCreationOption();
    game.modules.get(ID).api={Sheet,isCompanion,create:createCompanion,openCreate:safe(createCompanion),openEvolution:safe(evolveCompanion),linkTrainer,library,gains};
    initialized=true;
  }catch(error){console.error(`${ID} |`,error);ui.notifications.error(`Melhor Amigo: ${error.message}`);}
});
Hooks.on('preUpdateActor',(actor,change)=>{
  if(change['flags.core.sheetClass']===SHEET || change.flags?.core?.sheetClass===SHEET){change[`flags.${ID}.companion`]=true;}
});
Hooks.on('preUpdateItem',(item,change)=>{
  if(!isCompanion(item.actor)||item.type!=='classe')return;
  if(normalize(item.name)!=='melhor amigo')return false;
  const value=change['system.niveis']??change.system?.niveis;
  if(value!==undefined&&Number(value)!==gains(item.actor,trainerFor(item.actor)).effective){ui.notifications.warn('Evolua pela Forja Heroica. O nível do Melhor Amigo acompanha o treinador.');return false;}
});
Hooks.on('updateActor',actor=>refreshCompanions(actor));
Hooks.on('renderItemSheet',(app,raw)=>{
  if(initialized)restoreWeaponEditor(app.item,raw instanceof HTMLElement?raw:raw?.[0]);
});
for(const hook of ['createItem','updateItem','deleteItem','createActiveEffect','updateActiveEffect','deleteActiveEffect'])Hooks.on(hook,doc=>{
  const actor=doc.parent?.documentName==='Actor'?doc.parent:doc.parent?.actor;
  refreshCompanions(actor);
});
Hooks.on('deleteActor',trainer=>refreshCompanions(trainer));
Hooks.on('renderActorDirectory',(_app,raw)=>{
  if(!initialized||game.modules.get('tormenta20-forja-heroica')?.active)return;
  const root=raw instanceof HTMLElement?raw:raw?.[0];if(!root||root.querySelector('.t20ma-launcher'))return;
  const button=document.createElement('button');button.type='button';button.className='t20ma-launcher';button.innerHTML='<i class="fas fa-paw"></i> Criar Melhor Amigo';button.addEventListener('click',()=>safe(createCompanion)());root.append(button);
});

Hooks.once('ready',safe(async()=>{
  if(!initialized)return;
  for(const actor of game.actors.filter(a=>isCompanion(a)&&!a.pack)){
    const correction=actor.isOwner?initialAttributeCorrection(actor):null;
    if(correction)await actor.update(correction);
    actor.reset();
  }
}));
