import {DECK, publicRound, type Round} from './deck';
export const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
export type Session={code:string;token:string;role:'host'|'player';id?:string;name?:string};
export type State={schema:2;room:any;deck:Round[];hostToken:string;players:any[];answers:any[];runs:any[];events:any[];keys?:any};
const text=(s:any,n=4000)=>typeof s==='string'?s.trim().slice(0,n):'';
const shown=(r:any,i:number)=>i<r.current||['reveal','finished'].includes(r.phase);
export function createState(code:string,title:string,token:string):State{return {schema:2,room:{code,title:text(title,80)||'Первый эксперимент',current:-1,phase:'lobby',revision:0,context:'',joinLocked:false,created:Date.now(),ended:null},deck:structuredClone(DECK),hostToken:token,players:[],answers:[],runs:[],events:[]}}
export function validateState(s:any):asserts s is State{if(s?.schema!==2||!s.room||!/^[A-HJ-NP-Z2-9]{12}$/.test(s.room.code)||!/^[a-f0-9]{64}$/.test(s.hostToken)||!Array.isArray(s.deck)||s.deck.length!==14||!Array.isArray(s.players)||s.players.length>40||!Array.isArray(s.answers)||s.answers.length>560||!Array.isArray(s.runs)||s.runs.length>14||!s.keys?.privateKey||!s.keys?.publicKey)throw Error('Это не резервная копия комнаты Growth Mission для GitHub.')}
export class GameEngine{
 state:State;
 constructor(s:State,private save:(s:State)=>void=()=>{}){this.state=structuredClone(s)}
 private commit(s:State){this.save(s);this.state=s}
 request(b:any,token?:string,remote=false){
  if(!b||typeof b!=='object'||JSON.stringify(b).length>20000)throw Error('Неверный или слишком длинный запрос.');
  const s=structuredClone(this.state),r=s.room,at=Date.now();let dirty=false;
  const run=s.runs.find(x=>x.idx===r.current);
  if(r.phase==='open'&&run?.deadline&&run.deadline<=at){r.phase='locked';r.revision++;run.closed??=at;dirty=true}
  const action=b.action;
  if(action==='join'){
   const existing=/^[a-f0-9]{64}$/.test(b.joinSecret||'')?s.players.find(p=>p.token===b.joinSecret):null;
   if(existing)return {code:r.code,token:existing.token,role:'player',id:existing.id,name:existing.name} as Session;
   if(r.phase==='finished'||r.joinLocked)throw Error('Ведущий закрыл вход в комнату.');
   const name=text(b.name,32).replace(/\s+/g,' ');if(name.length<2)throw Error('Введите имя от 2 до 32 символов.');
   if(s.players.length>=40)throw Error('Достигнут лимит 40 участников.');
   if(s.players.some(p=>p.name===name))throw Error('Это имя уже занято. Добавьте фамилию или номер.');
   const p={id:crypto.randomUUID(),name,token:/^[a-f0-9]{64}$/.test(b.joinSecret||'')?b.joinSecret:secret(),joined:at,seen:at};s.players.push(p);this.commit(s);
   return {code:r.code,token:p.token,role:'player',id:p.id,name} as Session;
  }
  const host=token===s.hostToken&&!remote,p=host?null:s.players.find(p=>p.token===token);
  if(!host&&!p)throw Error('Ключ не подходит к комнате. Войдите под своим именем.');
  if(p){p.seen=at;dirty=true}
  if(action==='state'){if(dirty)this.commit(s);return this.snapshot(host,p?.id,b.view,!!b.export)}
  if(action==='draft'||action==='answer'){
   if(host)throw Error('Ответы отправляет участник.');
   if(r.phase!=='open'||b.round!==r.current){if(dirty)this.commit(s);throw Error('Раунд уже закрыт или сменился. Черновик остаётся на устройстве.')}
   const d=s.deck[r.current],old=s.answers.find(a=>a.player===p.id&&a.round===r.current);
   if(old?.submitted)throw Error('Ответ уже отправлен и зафиксирован.');
   const answerText=text(b.text,d.maxLength||4000),choice=Number.isInteger(b.choice)&&b.choice>=0&&b.choice<(d.options?.length||0)?b.choice:null;
   if(action==='answer'&&(d.kind==='choice'?choice===null:answerText.length<8))throw Error(d.kind==='choice'?'Выберите вариант.':'Запишите хотя бы одно содержательное предложение.');
   const answer={player:p.id,round:r.current,choice,text:answerText,ref:text(b.ref,500),blocked:b.blocked?1:0,confidence:[1,2,3].includes(b.confidence)?b.confidence:2,updated:at,submitted:action==='answer'?at:null,score:action==='answer'&&d.kind==='choice'?(choice===d.correct?d.points:0):null,feedback:''};
   if(old)Object.assign(old,answer);else s.answers.push(answer);this.commit(s);return {ok:true};
  }
  if(!host)throw Error('Этим действием управляет только ведущий.');
  if(action==='grade'){
   const i=Number(b.round),score=Number(b.score),a=s.answers.find(a=>a.player===b.player&&a.round===i&&a.submitted);
   if(!a||s.deck[i]?.kind==='choice'||!shown(r,i)||!Number.isInteger(score)||score<0||score>s.deck[i].points)throw Error('Оцените письменный ответ после открытия разбора: от 0 до 10.');
   a.score=score;a.feedback=text(b.feedback,1500);
  }else if(action==='team'){
   const run=s.runs.find(x=>x.idx===b.round);if(!run)throw Error('Раунд ещё не открыт.');run.team_ref=text(b.ref,500);run.team_done=b.done?1:0;
  }else{
   if(b.revision!==r.revision)throw Error('Состояние комнаты изменилось. Обновите и повторите действие.');
   if(action==='open'){
    if(!['lobby','reveal'].includes(r.phase)||r.current>=s.deck.length-1)throw Error('Сначала закройте раунд и откройте разбор.');
    r.current++;r.phase='open';const sec=b.seconds===0?0:Math.max(30,Math.min(1800,Number(b.seconds)||s.deck[r.current].minutes*60));
    s.runs.push({idx:r.current,opened:at,deadline:sec?at+sec*1000:null,closed:null,revealed:null,team_ref:'',team_done:0});
   }else if(action==='close'){
    if(r.phase!=='open')throw Error('Раунд уже закрыт.');r.phase='locked';run.closed=at;
   }else if(action==='reveal'){
    if(r.phase!=='locked')throw Error('Сначала закройте ответы.');r.phase='reveal';run.revealed=at;
   }else if(action==='extend'){
    if(r.phase!=='open')throw Error('Продлить можно только открытый раунд.');if(run.deadline)run.deadline=Math.max(run.deadline,at)+60000;
   }else if(action==='context'){r.context=text(b.context,2000);
   }else if(action==='lockJoin'){if(r.phase==='finished')throw Error('Завершённая игра закрыта для новых участников.');r.joinLocked=!!b.locked;
   }else if(action==='finish'){r.phase='finished';r.joinLocked=true;r.ended=at;if(run){run.closed??=at;run.revealed??=at}
   }else throw Error('Неизвестное действие.');
   r.revision++;s.events.push({action,round:r.current,at});s.events=s.events.slice(-200);
  }
  this.commit(s);return {ok:true};
 }
 snapshot(host:boolean,id?:string,view?:number,exporting=false){
  const s=this.state,r=s.room,deck=s.deck,at=Date.now();let idx=r.current;
  if(host&&typeof view==='number'&&Number.isInteger(view)&&view>=0&&view<=r.current)idx=view;
  const visible=s.answers.filter(a=>a.submitted&&(host||shown(r,a.round))),active=s.answers.filter(a=>a.round===idx),reveal=idx>=0&&shown(r,idx);
  const players=s.players.map(({token,...p})=>{const a=visible.filter(a=>a.player===p.id),mc=a.filter(a=>deck[a.round]?.kind==='choice');return {...p,online:at-p.seen<18000,submitted:s.answers.filter(a=>a.player===p.id&&a.submitted).length,score:a.reduce((v,a)=>v+(a.score??0),0),pending:a.filter(a=>a.score===null).length,correct:mc.filter(a=>a.score>0).length,mc:mc.length,confidentMistakes:mc.filter(a=>a.confidence===3&&a.score===0).length}});
  const answers=s.answers.filter(a=>host?a.round===idx:a.player===id).map(a=>({...a,score:host||shown(r,a.round)?a.score:null,feedback:host||shown(r,a.round)?a.feedback:''}));
  const out:any={serverTime:at,role:host?'host':'player',me:host?'host':id,room:{...r},deck:deck.map(({id,title,act,kind,points,minutes})=>({id,title,act,kind,points,minutes})),view:idx,round:idx>=0?publicRound(deck[idx],host||reveal):null,run:s.runs.find(x=>x.idx===idx)||null,runs:structuredClone(s.runs),players,answers,progress:active.map(a=>({player:a.player,status:a.submitted?'submitted':at-a.updated<9000?'writing':'draft',updated:a.updated})),histogram:host||reveal?deck[idx]?.options?.map((_,i)=>active.filter(a=>a.submitted&&a.choice===i).length)||[]:[],answered:active.filter(a=>a.submitted).length,events:host?s.events.slice(-12).reverse():[],summary:deck.map((d,i)=>({id:d.id,title:d.title,kind:d.kind,opened:s.runs.some(r=>r.idx===i),submitted:s.answers.filter(a=>a.round===i&&a.submitted).length,correct:host||shown(r,i)?s.answers.filter(a=>a.round===i&&a.submitted&&a.score>0&&d.kind==='choice').length:null}))};
  if(exporting){if(!host)throw Error('Статистику выгружает ведущий.');out.export={schema:2,exported:new Date().toISOString(),room:{...r},deck:deck.map(d=>publicRound(d,true)),players,runs:s.runs,answers:structuredClone(s.answers)}}
  return out;
 }
}
