import {ID,isCompanion,normalize,levels,gains,hasPower,TYPE_BONUSES,list} from './rules.mjs';
import {trainerFor,mirrorMana} from './resources.mjs';
const grant=(values,key)=>{if(values instanceof Set)values.add(key);else if(Array.isArray(values)&&!values.includes(key))values.push(key);};
const append = (object,key,value) => {if(Array.isArray(object?.[key]))object[key].push(String(value));};
export function managedChange(effect, actor, change) {
  if(!isCompanion(actor))return change;
  const name=normalize(effect.parent?.documentName==='Item' ? effect.parent.name : effect.name);
  const key=change.key;
  if(name.startsWith('tipo ')) {
    if(key==='system.attributes.defesa.bonus')return null;
    if(actor.flags?.[ID]?.normalizeType && key.startsWith('system.atributos.')) {
      const attribute=key.split('.')[2], value=TYPE_BONUSES[name.replace('tipo ','')]?.[attribute];
      return value ? {...change,key:`system.atributos.${attribute}.racial`,value:String(value)} : null;
    }
    if(actor.flags?.[ID]?.normalizeType && key.startsWith('system.attributes.movement.'))return null;
  }
  if(name.startsWith('treino intensivo') && (key.startsWith('system.attributes.pv.bonus')||key.startsWith('system.tracos.resistencias.dano')))return null;
  if(name==='treinamento defensivo' && key==='system.attributes.defesa.bonus')return null;
  if(name==='veloz' && (key==='system.attributes.defesa.bonus'||key==='system.pericias.atle.treinado'))return null;
  if(name==='treinamento marcial' && (key.startsWith('system.modificadores.ataque.')||key==='system.modificadores.pericias.ataque'||key==='system.modificadores.dano.geral'))return null;
  if(name==='alado' && key.startsWith('system.attributes.movement.fly'))return null;
  if(name==='anatomia humanoide' && key==='system.tracos.profArmaduras.value' && change.value==='leves')return {...change,value:'lev'};
  if(name==='reducao de dano' && key.startsWith('system.tracos.resistencias.dano'))return null;
  return change;
}
export function beforeDerived(model) {
  const actor=model.parent;if(!isCompanion(actor))return;
  const trainer=trainerFor(actor), g=gains(actor,trainer);
  model.prepareBaseAtributos();
  // Change only prepared item data. The source and ordinary character classes are untouched.
  for(const item of list(actor).filter(i=>i.type==='classe'&&normalize(i.name)==='melhor amigo')){
    item.system.niveis=g.effective;item.system.pvPorNivel=4;item.system.pmPorNivel=0;item.system.inicial=true;
  }
  if(g.hpPerLevel)append(model.attributes.pv.bonus,'nivel',g.hpPerLevel);
  const car=Number(trainer?.system?.atributos?.car?.value)||0;
  const levelDefense=g.defensive?g.effective:Math.floor(g.effective/2);
  const progressive=game.settings.get('tormenta20','progressiveDefense')?Math.floor(g.effective/2):0;
  append(model.attributes.defesa,'bonus',car+levelDefense-progressive);
  if(hasPower(actor,'Alado'))model.attributes.movement.fly.base=15;
  if(g.humanoid && game.settings.get('tormenta20','carryWeight')) {
    // Neutralize the native strength adjustment before encumbrance and movement are computed.
    const carry=model.attributes.carga, attribute=model.atributos[carry.atributo].value+(model.atributos[carry.atributo].bonus??[]).reduce((sum,value)=>sum+Number(value||0),0);
    carry.base=10;carry.bonus=[String(-(attribute>0?attribute*2:attribute))];
  }
  if(g.fast){
    append(model.attributes.defesa,'bonus',2);
    const athletic=model.pericias.atle;
    if(athletic?.treinado)append(athletic,'bonus',2);else if(athletic)athletic.treinado=true;
    for(const move of Object.values(model.attributes.movement))if(move?.base>0)append(move,'bonus',3);
  }
  if(g.martial){append(model.modificadores.pericias,'ataque',g.martial);append(model.modificadores.dano,'geral',g.martial);}
  const naturalRD=hasPower(actor,'Redução de Dano')?5:0;
  if(g.rd||naturalRD)append(model.tracos.resistencias.dano,'bonus',Math.max(g.rd,naturalRD));
  if(g.humanoid){
    grant(model.tracos.profArmas.value,'simples');grant(model.tracos.profArmaduras.value,'lev');
    model.equipamentos.limiteEmpunhado=2;model.equipamentos.limiteVestido=3;
    if(g.martial){grant(model.tracos.profArmas.value,'marcial');grant(model.tracos.profArmaduras.value,'pes');grant(model.tracos.profArmaduras.value,'esc');}
  } else {model.equipamentos.limiteEmpunhado=0;model.equipamentos.limiteVestido=2;}
}
export function inheritedDescriptor(prototype,key) {
  for(let current=prototype;current;current=Object.getPrototypeOf(current)){
    const descriptor=Object.getOwnPropertyDescriptor(current,key);
    if(descriptor)return descriptor;
  }
}
// Creating an Actor with initial Items bypasses legacy Item effect transferral.
// Supply those effects during preparation, without creating extra world documents.
export function missingTransferredEffects(actor, legacy=CONFIG.ActiveEffect.legacyTransferral) {
  if(!legacy||!isCompanion(actor))return [];
  const copiedOrigins=new Set(Array.from(actor.effects??[],effect=>effect.origin));
  return list(actor).filter(item=>!copiedOrigins.has(item.uuid)).flatMap(item=>Array.from(item.effects??[]).filter(effect=>effect.transfer));
}
export function installMechanics() {
  const ActorClass=CONFIG.Actor.documentClass, proto=ActorClass.prototype;
  const applicable=proto.allApplicableEffects;
  proto.allApplicableEffects=function*(){
    yield* applicable.call(this);
    yield* missingTransferredEffects(this);
  };
  const level=inheritedDescriptor(proto,'nivel');
  if(!level?.get)throw new Error('Não foi possível localizar o cálculo de nível do sistema.');
  Object.defineProperty(proto,'nivel',{...level,get(){return isCompanion(this)?levels(this,trainerFor(this)).effective:level.get.call(this);}});
  const getRollData=proto.getRollData;
  proto.getRollData=function(...args){
    const data=getRollData.apply(this,args);if(!isCompanion(this))return data;
    const trainer=trainerFor(this), level=levels(this,trainer);
    data.nvl={...data.nvl,'melhor-amigo':level.effective,treinador:level.classLevel};
    data.treinador={nivel:level.classLevel,nivelTotal:trainer?list(trainer).filter(i=>i.type==='classe').reduce((sum,i)=>sum+Number(i.system.niveis||0),0):0,car:Number(trainer?.system?.atributos?.car?.value)||0};
    data.atributoChave=data.treinador.car;
    return data;
  };
  const model=CONFIG.Actor.dataModels.character.prototype, derive=model.prepareDerivedData;
  model.prepareDerivedData=function(...args){beforeDerived(this);const result=derive.apply(this,args);afterDerived(this);mirrorMana(this.parent);return result;};
  const items=CONFIG.Item.documentClass.prototype, final=items.prepareFinalAttributes;
  if(final)items.prepareFinalAttributes=function(...args){const result=final.apply(this,args);if(isCompanion(this.actor)){
    const trainer=trainerFor(this.actor), g=gains(this.actor,trainer);
    if(normalize(this.name)==='reanimacao sombria')this.system.ativacao.custo=3*g.tier;
    if(this.type==='arma'&&this.system.proficiencia==='natural'){
      const source=this._source.system, animal=hasPower(this.actor,'Tipo: Animal'), fierce=hasPower(this.actor,'Amigo Feroz'), huge=hasPower(this.actor,'Amigão');
      this.system.criticoM=Number(source.criticoM||20)-Number(animal)-2*Number(fierce);
      for(let index=0;index<this.system.rolls.length;index++){
        const row=this.system.rolls[index];if(row.type!=='dano')continue;
        const base=source.rolls?.[index]?.parts?.[0]?.[0];const table=CONFIG.T20.passosDano?.find(t=>t.includes(base));
        if(table){const parts=structuredClone(row.parts);parts[0][0]=table[Math.min(table.length-1,table.indexOf(base)+Number(fierce)+Number(huge))];row.parts=parts;}
      }
      if(fierce){const attack=this.system.rolls.find(r=>r.type==='ataque');if(attack){const parts=structuredClone(source.rolls?.find(r=>r.type==='ataque')?.parts ?? attack.parts);parts[2]=[parts[2]?.[0]?`(${parts[2][0]}) + 2`:'2',parts[2]?.[1]??''];attack.parts=parts;}}
      this._prepareLabels();
    }
  }return result;};
  const itemRollData=items.getRollData;
  items.getRollData=function(...args){const data=itemRollData.apply(this,args);if(data&&isCompanion(this.actor)&&(this.type==='magia'||normalize(this.name)==='sopro')){data.car=Number(trainerFor(this.actor)?.system.atributos.car.value)||0;data.atributoChave=data.car;}return data;};
  const effects=CONFIG.ActiveEffect.documentClass.prototype, apply=effects.apply;
  effects.apply=function(actor,change,...args){const adjusted=managedChange(this,actor,change);return adjusted?apply.call(this,actor,adjusted,...args):{};};
}

export function afterDerived(model) {
  const actor=model.parent;if(!isCompanion(actor))return;
  const g=gains(actor,trainerFor(actor)), hp=model.attributes.pv;
  const rollData=actor.getRollData();
  const evaluate=value=>{if(Number.isFinite(Number(value)))return Number(value);try{return Roll.safeEval(Roll.replaceFormulaData(String(value),rollData,{missing:0}));}catch{return 0;}};
  const bonus=hp.bonus, conAttribute=model.atributos[actor.flags?.tormenta20?.substituirCon ?? 'con'], con=(conAttribute?.base??0)+(conAttribute?.racial??0);
  let maximum=0;
  for(let level=1;level<=g.effective;level++)maximum+=Math.max(1,(level===1?16:4)+con+bonus.nivel.reduce((sum,v)=>sum+evaluate(v),0)+(level%2===0?bonus.nivelPar:bonus.nivelImpar).reduce((sum,v)=>sum+evaluate(v),0));
  maximum+=bonus.total.reduce((sum,v)=>sum+evaluate(v),0);
  for(const [key,enabled] of Object.entries(hp.atributos))if(enabled)maximum+=model.atributos[key].value;
  hp.max=Math.floor(maximum);hp.min=-Math.floor(hp.max/2);
  if(g.humanoid){
    const carry=model.attributes.carga;carry.limit=10;carry.max=20;carry.encumbered=carry.value>10;carry.pct=Math.min(100,carry.value*5);
  }
}
