import {ID,isCompanion,trainerLevel,manaDebit,normalize,gains} from './rules.mjs';
export const sceneKey=()=>`${game.scenes?.current?.id??game.user?.viewedScene??'world'}:${game.combat?.id??'exploration'}`;
export async function reanimate(actor,service){
  if(Number(actor.system.attributes.pv.value)>0)throw new Error('Reanimação Sombria requer 0 PV ou menos.');
  const key=sceneKey();if(actor.flags?.[ID]?.reanimatedScene===key)throw new Error('Reanimação Sombria já foi usada nesta cena.');
  const trainer=assertTrainer(actor,{spend:true}),cost=3*gains(actor,trainer).tier;
  manaDebit(trainer.system.attributes.pm,cost);
  const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:'Reanimação Sombria'},content:`<p>Gastar ${cost} PM do treinador para restaurar ${Math.floor(actor.system.attributes.pv.max/2)} PV? Uso limitado a uma vez por cena.</p>`});
  if(!confirmed)return null;
  if(Number(actor.system.attributes.pv.value)>0||actor.flags?.[ID]?.reanimatedScene===key||sceneKey()!==key)throw new Error('A ficha ou a cena mudou. Confira antes de reanimar.');
  await service.spend(actor,cost);
  await actor.update({'system.attributes.pv.value':Math.floor(actor.system.attributes.pv.max/2),[`flags.${ID}.reanimatedScene`]:key});
  ui.notifications.info('Melhor Amigo reanimado. Os PM foram descontados do treinador.');
  return actor;
}
export function trainerFor(actor) {
  const uuid = actor.flags?.[ID]?.trainerUuid;
  if (!uuid) return null;
  const trainer = globalThis.fromUuidSync?.(uuid);
  return trainer?.documentName === 'Actor' && trainer !== actor && !isCompanion(trainer) && trainerLevel(trainer) > 0 ? trainer : null;
}
export function assertTrainer(actor, {spend=false} = {}) {
  const trainer = trainerFor(actor);
  if (!trainer) throw new Error('Vincule um treinador válido antes de usar esta habilidade.');
  if (!actor.isOwner) throw new Error('Você precisa controlar o Melhor Amigo.');
  if (!trainer.testUserPermission(game.user, spend ? 'OWNER' : 'OBSERVER')) throw new Error(spend ? 'É necessário ter permissão de proprietário na ficha do treinador para gastar os PM dele.' : 'Você não tem permissão para consultar a ficha do treinador.');
  return trainer;
}
export function mirrorMana(actor) {
  if (!isCompanion(actor) || !actor.system?.attributes?.pm) return;
  const trainer = trainerFor(actor), readable = trainer?.testUserPermission(game.user,'OBSERVER');
  const pool = readable ? trainer.system.attributes.pm : {value:0,max:0,temp:0};
  for (const key of ['value','max','temp']) actor.system.attributes.pm[key] = Number(pool[key]) || 0;
}
export class ResourceService {
  constructor(originalSpend) {this.originalSpend=originalSpend;this.queues=new Map();this.transactions=new WeakMap();}
  enqueue(trainer, fn) {
    const key=trainer.uuid, previous=this.queues.get(key) ?? Promise.resolve();
    const next=previous.catch(()=>{}).then(fn);
    this.queues.set(key,next);
    next.then(()=>{if(this.queues.get(key)===next)this.queues.delete(key);},()=>{if(this.queues.get(key)===next)this.queues.delete(key);});
    return next;
  }
  spend(actor, amount=0, adjust=0, recover=false) {
    if (!isCompanion(actor)) return this.enqueue(actor,()=>this.originalSpend.call(actor,amount,adjust,recover));
    // Rest and recovery effects on the companion must never regenerate the trainer's mana.
    if (recover || Number(amount)+Number(adjust)<0) return Promise.resolve(actor);
    const trainer=assertTrainer(actor,{spend:true}), cost=Math.floor(Number(amount)+Number(adjust));
    manaDebit(trainer.system.attributes.pm,cost);
    const execute=()=>{
      assertTrainer(actor,{spend:true});
      if(trainerFor(actor)?.uuid!==trainer.uuid)throw new Error('O vínculo com o treinador mudou. Abra a habilidade novamente.');
      manaDebit(trainer.system.attributes.pm,cost);
      return this.originalSpend.call(trainer,cost,0,false);
    };
    const context=this.transactions.get(actor);
    if(context){
      manaDebit({...trainer.system.attributes.pm,...context.pool},cost);
      context.pool=manaDebit(context.pool ?? trainer.system.attributes.pm,cost);
      const pending=context.tail.then(execute);context.tail=pending;context.payments.push(pending);pending.catch(()=>{});return pending;
    }
    return this.enqueue(trainer,execute);
  }
  async usage(actor, fn) {
    if (!isCompanion(actor)) return fn();
    const trainer=assertTrainer(actor,{spend:true});
    return this.enqueue(trainer,async()=>{
      if(trainerFor(actor)?.uuid!==trainer.uuid)throw new Error('O vínculo com o treinador mudou.');
      const context={payments:[],tail:Promise.resolve(),pool:{...trainer.system.attributes.pm}};this.transactions.set(actor,context);mirrorMana(actor);
      try {const result=await fn();await Promise.all(context.payments);return result;}
      finally {await Promise.allSettled(context.payments);this.transactions.delete(actor);mirrorMana(actor);}
    });
  }
}
export function installResourceRouting(AbilityUseDialog) {
  const ActorClass=CONFIG.Actor.documentClass, ItemClass=CONFIG.Item.documentClass;
  const originalSpend=ActorClass.prototype.spendMana;
  if(typeof originalSpend!=='function'||typeof ItemClass.prototype._getUsageUpdates!=='function')throw new Error('Esta versão do sistema não oferece as APIs de PM necessárias.');
  const service=new ResourceService(originalSpend);
  if(AbilityUseDialog?.create){
    const create=AbilityUseDialog.create;
    AbilityUseDialog.create=async function(item,...args){const result=await create.call(this,item,...args);const context=service.transactions.get(item.actor);if(context&&result)context.options=result;return result;};
  }
  ActorClass.prototype.spendMana=function(...args){return service.spend(this,...args);};
  for(const [Class,method,getActor] of [[ItemClass,'roll',i=>i.actor],[ActorClass,'rollPericia',a=>a],[ActorClass,'rollAtributo',a=>a]]) {
    const original=Class.prototype[method];if(typeof original!=='function')continue;
    Class.prototype[method]=async function(...args){
      const actor=getActor(this);
      if(!isCompanion(actor))return original.apply(this,args);
      try{return await service.usage(actor,async()=>{
        let target=this;
        if(Class===ItemClass && normalize(this.name)==='reanimacao sombria')return reanimate(actor,service);
        if(Class===ItemClass && normalize(this.name)==='asas'){
          const mode=await foundry.applications.api.DialogV2.prompt({window:{title:'Asas'},content:'<p>Pairar até 1,5 m do chão é gratuito. Voar com deslocamento de 12 m custa 1 PM do treinador por rodada.</p><label>Modo<select name="flight"><option value="hover">Pairar, sem gasto de PM</option><option value="fly">Voar nesta rodada, 1 PM</option></select></label>',ok:{label:'Usar Asas',callback:(event,button)=>button.form.elements.flight.value}});
          if(!mode)return null;
          target=this.clone({'system.ativacao.custo':mode==='fly'?1:0,effects:[]},{keepId:true});
        }
        if(Class===ItemClass && normalize(this.name)==='sopro'){
          const trainer=assertTrainer(actor,{spend:true}), maximum=Math.max(0,Math.floor(Number(trainer.system.atributos.car.value)||0));
          if(!maximum)throw new Error('Sopro requer Carisma positivo do treinador.');
          const amount=await foundry.applications.api.DialogV2.prompt({window:{title:'Sopro · PM do treinador'},content:`<p>Cada PM causa 2d8 de dano. Limite: ${maximum} PM.</p><label>PM<input name="cost" type="number" min="1" max="${maximum}" step="1" value="1"></label>`,ok:{label:'Usar Sopro',callback:(event,button)=>{const value=Number(button.form.elements.cost.value);if(!Number.isInteger(value)||value<1||value>maximum)throw new Error('Quantidade de PM inválida.');return value;}}});
          if(!amount)return null;manaDebit(trainer.system.attributes.pm,amount);
          const rolls=this.toObject().system.rolls;for(const row of rolls)if(row.type==='dano')row.parts=[[`${amount*2}d8`,this.flags?.[ID]?.energy||'fogo']];
          target=this.clone({'system.ativacao.custo':amount,'system.rolls':rolls,effects:[]},{keepId:true});
        }
        return original.apply(target,args);
      });}
      catch(error){ui.notifications.warn(error.message);return null;}
    };
  }
  const originalCard=ActorClass.prototype.displayCard;
  if(originalCard)ActorClass.prototype.displayCard=async function(data,...args){
    const context=service.transactions.get(this), options=data?.options;
    if(isCompanion(this)&&context&&!context.payments.length&&!game.settings.get('tormenta20','automaticManaSpend')&&options?.itemData?.system?.ativacao?.custo){
      let cost=Math.max(0,Number(options.itemData.system.ativacao.custo)+Number(this.system.modificadores.custoPM||0));
      if(options.truque)cost=0;else if(options.halfCost)cost=Math.floor(cost/2);
      if(cost)await service.spend(this,cost);
    }
    return originalCard.call(this,data,...args);
  };
  const originalUsage=ItemClass.prototype._getUsageUpdates;
  ItemClass.prototype._getUsageUpdates=function(options){
    if(!isCompanion(this.actor))return originalUsage.call(this,options);
    let trainer;try {trainer=assertTrainer(this.actor,{spend:true});}catch(error){ui.notifications.warn(error.message);return false;}
    mirrorMana(this.actor);
    // Force resource routing even when automatic spending is disabled for ordinary characters.
    // The system v14 computes final discounts immediately before spendMana; that final cost is checked there.
    const usage=originalUsage.call(this,{...options,consumeMana:false});
    if(!usage)return usage;
    const context=service.transactions.get(this.actor), configuration=context?.options;
    let cost=options.consumeMana ? Math.max(0,Math.floor(Number(options.consumeMana)+(Number(this.actor.system.modificadores?.custoPM)||0))) : 0;
    if(configuration?.truque)cost=0;else if(configuration?.halfCost)cost=Math.floor(cost/2);
    if(options.consumeMana){
      if(Number(game.release.generation)<14){try{manaDebit(trainer.system.attributes.pm,cost);}catch(error){ui.notifications.warn(error.message);return false;}}
      usage.manaUpdate={value:cost};
    }
    if(options.consumeQuantity && this.system.consume?.mpMultiplier){
      const resource=this.actor.items.get(this.system.consume.target), amount=Number(this.system.consume.amount)*(options.consumeMana?Number(options.consumeMana):1);
      if(!resource || resource.system.qtd<amount){ui.notifications.warn('Quantidade insuficiente do recurso consumido.');return false;}
      usage.itemsUpdate=usage.itemsUpdate.filter(u=>u._id!==resource.id);
      usage.itemsUpdate.push({_id:resource.id,'system.qtd':resource.system.qtd-amount});
    }
    return usage;
  };
  const prepare=ActorClass.prototype.prepareData;
  ActorClass.prototype.prepareData=function(...args){const result=prepare.apply(this,args);mirrorMana(this);return result;};
  const rest=ActorClass.prototype.descanso;
  if(rest)ActorClass.prototype.descanso=async function(multiplier=1,hpModifier=0,mpModifier=0,doubleHP=false,doubleMP=false,toChat=true){
    if(!isCompanion(this))return rest.call(this,multiplier,hpModifier,mpModifier,doubleHP,doubleMP,toChat);
    if(!this.isOwner)throw new Error('Você precisa controlar o Melhor Amigo.');
    const recovery=Math.floor(gains(this,trainerFor(this)).effective*(multiplier+hpModifier)*(doubleHP?2:1));
    const previous=Number(this.system.attributes.pv.value);await this.modifyTokenAttribute('attributes.pv',recovery,true,true);
    const text=`${this.name} recuperou ${Number(this.system.attributes.pv.value)-previous} PV. O descanso do Melhor Amigo não recupera os PM do treinador.`;
    if(toChat)await ChatMessage.create({content:document.createTextNode(text).textContent.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])),speaker:ChatMessage.getSpeaker({actor:this})});
    return text;
  };
  Hooks.on('preUpdateActor',(actor,change)=>{
    if(!isCompanion(actor))return;
    if(Object.keys(change).some(k=>k==='system.attributes.pm'||k.startsWith('system.attributes.pm.'))||change.system?.attributes?.pm){
      ui.notifications.warn('Os PM pertencem ao treinador. Edite a ficha dele.');return false;
    }
  });
  return service;
}
