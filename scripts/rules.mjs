export const ID = 'tormenta20-melhor-amigo';
export const SHEET = `${ID}.ActorSheetT20MelhorAmigo`;
export const VIRTUAL_TYPE = 't20-melhor-amigo';
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const list = actor => Array.from(actor?.items?.values?.() ?? actor?.items ?? []);
export const hasPower = (actor, name) => list(actor).some(i => i.type === 'poder' && normalize(i.name) === normalize(name));
export const isCompanion = actor => actor?.type === 'character' && (actor.flags?.[ID]?.companion || actor.flags?.core?.sheetClass === SHEET);
export const trainerLevel = actor => list(actor).filter(i => i.type === 'classe' && normalize(i.name) === 'treinador').reduce((n, i) => n + Math.max(0, Number(i.system?.niveis) || 0), 0);
export const totalLevel = actor => list(actor).filter(i => i.type === 'classe').reduce((n, i) => n + Math.max(0, Number(i.system?.niveis) || 0), 0);
export function levels(companion, trainer) {
  const stored = list(companion).find(i => i.type === 'classe' && normalize(i.name) === 'melhor amigo')?._source?.system?.niveis ?? list(companion).find(i => i.type === 'classe' && normalize(i.name) === 'melhor amigo')?.system?.niveis ?? 1;
  const classLevel = trainer ? trainerLevel(trainer) : Number(stored);
  const effective = trainer && hasPower(trainer, 'Treinador Eclético') ? totalLevel(trainer) : classLevel;
  return {classLevel: Math.max(1, classLevel), effective: Math.max(1, effective), tier: classLevel >= 17 ? 4 : classLevel >= 11 ? 3 : classLevel >= 5 ? 2 : 1};
}
export function gains(companion, trainer) {
  const level = levels(companion, trainer);
  const intensive = hasPower(trainer, 'Treino Intensivo (Treinador)') || hasPower(trainer, 'Treino Intensivo') || hasPower(companion, 'Treino Intensivo (Melhor Amigo)') || hasPower(companion, 'Treino Intensivo');
  const active = intensive && level.classLevel >= 5;
  const teaching = (companion.flags?.[ID]?.taughtBy ?? []).filter(uuid => list(trainer).some(i => i.uuid === uuid && normalize(i.name) === 'ensinar truque')).length;
  return {...level, intensive: active, hpPerLevel: active ? 4 : 0, rd: active ? level.classLevel >= 17 ? 15 : level.classLevel >= 11 ? 10 : 5 : 0,
    tricks: 2 + Math.floor((level.classLevel - 1) / 3) + (active ? 1 + Number(level.classLevel >= 11) : 0) + teaching,
    defensive: hasPower(companion, 'Treinamento Defensivo'), martial: hasPower(companion, 'Treinamento Marcial') ? 1 + level.tier : 0,
    fast: hasPower(companion, 'Veloz'), humanoid: hasPower(companion, 'Anatomia Humanoide'),
    partner: hasPower(companion, 'Amigo Mestre') ? 'Mestre' : hasPower(companion, 'Amigo Veterano') ? 'Veterano' : 'Iniciante'};
}
export function manaDebit(pool, amount) {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) throw new Error('Custo de PM inválido.');
  const current = Math.max(0, Number(pool.value) || 0), temp = Math.max(0, Number(pool.temp) || 0);
  if (current + temp < amount) throw new Error('O treinador não tem PM suficientes.');
  const useTemp = Math.min(temp, amount);
  return {value: current - amount + useTemp, temp: temp - useTemp};
}
export const TRICKS = ['Alado','Amigão','Amigo Feroz','Amigo Protetor','Amigo Veterano','Amigo Mestre','Anatomia Humanoide','Arma Natural Adicional','Asas','Bote','Condicionamento Especial','Deslocamento Especial','Magia Inata','Manobra Ensaiada','Montaria','Reanimação Sombria','Redução de Dano','Sopro','Táticas de Matilha','Treinamento de Companhia','Treinamento Defensivo','Treinamento Marcial','Veloz'];
export const learnedTricks = actor => list(actor).filter(item=>item.type==='poder'&&TRICKS.map(normalize).includes(normalize(item.name)));
export const TYPE_NAMES = ['Animal','Construto','Espírito','Monstro','Morto-Vivo'];
export const TYPE_BONUSES = {animal:{for:1,des:1,sab:1},construto:{con:2},espirito:{sab:1,car:1},monstro:{for:1,des:1},'morto vivo':{con:2}};
export function allowedTrick(name, companion, trainer) {
  const g = gains(companion, trainer), n = normalize(name);
  const type = normalize(list(companion).find(i => normalize(i.name).startsWith('tipo '))?.name).replace('tipo ', '');
  if (['alado','reducao de dano','amigo veterano'].includes(n) && g.classLevel < 5) return 'Requer treinador nível 5.';
  if (['bote','manobra ensaiada','amigo feroz'].includes(n) && !list(companion).some(i=>i.type==='arma'&&i.system?.proficiencia==='natural'))return 'Requer uma arma natural.';
  if (n === 'alado' && !hasPower(companion,'Asas')) return 'Requer Asas.';
  if (n === 'amigao' && (g.classLevel < 7 || companion.system?.tracos?.tamanho !== 'gra')) return 'Requer tamanho Grande e treinador nível 7.';
  if (n === 'amigo mestre' && (g.classLevel < 11 || !hasPower(companion,'Amigo Veterano'))) return 'Requer Amigo Veterano e treinador nível 11.';
  const types = {'magia inata':['espirito'],'anatomia humanoide':['construto','morto vivo'],'reanimaçao sombria':['morto vivo'],'reanimacao sombria':['morto vivo'],'arma natural adicional':['animal','monstro'],'sopro':['construto','espirito','monstro'],'treinamento de companhia':['animal']};
  if (types[n] && !types[n].includes(type)) return 'Incompatível com o tipo do Melhor Amigo.';
  if (n === 'anatomia humanoide' && companion.flags?.[ID]?.creationComplete !== false) return 'Escolha disponível somente durante a criação.';
  if (n === 'condicionamento especial' && list(companion).some(i => normalize(i.name) === n && Number(i.flags?.[ID]?.tier || 1) === g.tier)) return 'Já escolhido neste patamar.';
  const repeated = ['magia inata','condicionamento especial','deslocamento especial'];
  if (hasPower(companion,name) && !repeated.includes(n)) return 'Já aprendido.';
  if (n === 'deslocamento especial' && list(companion).filter(i => normalize(i.name) === n).length >= 2) return 'Escalada e natação já disponíveis.';
  const chosen = learnedTricks(companion).length;
  if (chosen >= g.tricks) return 'Todos os espaços de truques estão preenchidos.';
  return '';
}
export function creationData(data = {}) {
  const result = structuredClone(data);
  result.type = 'character';
  result.flags ??= {}; result.flags[ID] = {...result.flags[ID], companion:true, normalizeType:true, creationVersion:3, creationComplete:false};
  result.flags.core = {...result.flags.core, sheetClass:SHEET};
  result.system ??= {};
  result.system.atributos = Object.fromEntries(Object.entries({for:1,des:1,con:1,int:-4,sab:1,car:0}).map(([key,base]) => [key,{base}]));
  result.system.attributes = {...result.system.attributes, movement:{walk:{base:12}},pv:{value:17},pm:{value:0,max:0,temp:0}};
  result.prototypeToken = {...result.prototypeToken, actorLink:true, bar1:{attribute:'attributes.pv'}, bar2:{attribute:null}};
  result.system.tracos = {...result.system.tracos,tamanho:'med'};
  result.items ??= [];
  result.items.push({name:'Melhor Amigo',type:'classe',img:'icons/creatures/abilities/paw-print-orange.webp',system:{niveis:1,pvPorNivel:4,pmPorNivel:0,inicial:true}});
  return result;
}

// Only repair the exact initial seed from versions 0.1.0 through 0.1.2.
// Converted sheets and any customized base attributes remain untouched.
export function initialAttributeCorrection(actor) {
  const flags=actor.flags?.[ID];
  if(!isCompanion(actor)||!flags?.normalizeType||flags.creationVersion>=3)return null;
  const attributes=actor._source?.system?.atributos;
  const previous={for:1,des:1,con:1,int:-4,sab:2,car:0};
  if(!Object.entries(previous).every(([key,base])=>attributes?.[key]?.base===base))return null;
  return {'system.atributos.sab.base':1,[`flags.${ID}.creationVersion`]:3,[`flags.${ID}.previousInitialWisdom`]:2};
}

export const SKILLS = {acro:'Acrobacia',ades:'Adestramento',atle:'Atletismo',atua:'Atuação',cava:'Cavalgar',conh:'Conhecimento',cura:'Cura',dipl:'Diplomacia',enga:'Enganação',fort:'Fortitude',furt:'Furtividade',guer:'Guerra',inic:'Iniciativa',inti:'Intimidação',intu:'Intuição',inve:'Investigação',joga:'Jogatina',ladi:'Ladinagem',luta:'Luta',mist:'Misticismo',nobr:'Nobreza',alfa:'Ofício: Alfaiate',alqu:'Ofício: Alquimista',arme:'Ofício: Armeiro',arte:'Ofício: Artesão',cozi:'Ofício: Cozinheiro',enge:'Ofício: Engenhoqueiro',perc:'Percepção',pilo:'Pilotagem',pont:'Pontaria',refl:'Reflexos',reli:'Religião',sobr:'Sobrevivência',vont:'Vontade'};
export function creationSkills(config, localize = label => label) {
  const source = config && Object.keys(config).length ? config : SKILLS;
  return Object.entries(source).filter(([key]) => /^[a-zA-Z0-9_-]+$/.test(key)).map(([key, skill]) => {
    const label = typeof skill === 'string' ? skill : skill?.label;
    const translated = label ? localize(label) : '';
    return [key, translated && !translated.startsWith('T20.') ? translated : SKILLS[key] || key];
  }).sort((a,b) => a[1].localeCompare(b[1], 'pt-BR'));
}
export function initialSkillTraining(selected, available) {
  if (selected.length !== 3 || new Set(selected).size !== 3 || selected.some(key => !available.some(([id]) => id === key))) {
    throw new Error('Escolha três perícias diferentes da lista.');
  }
  return Object.fromEntries(selected.map(key => [`system.pericias.${key}.treinado`, true]));
}
export function naturalWeapon(damage='perfuracao', extra=false) {
  return {name:extra?'Arma natural adicional':'Arma natural',type:'arma',img:'icons/creatures/abilities/paw-print-orange.webp',flags:{[ID]:{natural:true}},system:{proficiencia:'natural',tipoUso:'nat',proposito:'corpo-a-corpo',empunhadura:'leve',qtd:1,espacos:0,carregado:true,equipado:1,criticoM:20,criticoX:2,ativacao:{execucao:'action',custo:extra?1:0},rolls:[{name:'Ataque',key:'ataque',type:'ataque',parts:[['1d20',''],['luta','for'],['','']]},{name:'Dano',key:'dano',type:'dano',parts:[['1d8',damage],['@for','']]}]}};
}
// These conditional effects are implemented by the companion's resource and attack routing.
// Preserve passive effects, but do not apply the same cost or attack bonus twice after v14 migration.
export function cleanPowerSource(source) {
  const data=structuredClone(source);
  for(const key of ['_id','folder','_stats','ownership'])delete data[key];
  const managed=new Set(['tipo animal','tipo monstro','sopro','arma natural adicional','amigo feroz']);
  data.effects=(data.effects??[]).filter(effect=>!(managed.has(normalize(data.name))&&(effect.flags?.tormenta20?.onuse||effect.system?.onuse)));
  for(const effect of data.effects){for(const key of ['_id','key','origin','_stats'])delete effect[key];}
  return data;
}
