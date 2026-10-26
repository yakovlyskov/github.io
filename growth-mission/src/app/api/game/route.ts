import {env} from 'cloudflare:workers';
import {DECK,publicRound,type Round} from '../../../lib/deck';
export const dynamic='force-dynamic';
const now=()=>Date.now();
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const out=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class Problem extends Error{constructor(public status:number,message:string){super(message)}}
const text=(v:unknown,max=4000)=>typeof v==='string'?v.trim().slice(0,max):'';
const validCode=(v:unknown)=>{const c=text(v,10).toUpperCase();if(!/^[A-HJ-NP-Z2-9]{6}$/.test(c))throw new Problem(400,'Проверьте шестизначный код комнаты.');return c};
function db(){if(!env.DB)throw new Problem(503,'База комнаты ещё не подключена.');return env.DB;}
async function load(code:string){const r=await db().prepare('SELECT * FROM rooms WHERE code=?').bind(code).first<any>();if(!r)throw new Problem(404,'Комната не найдена. Проверьте код.');return r;}
async function who(req:Request,room:any){const t=req.headers.get('Authorization')?.replace(/^Bearer /,'')||'';if(!/^[a-f0-9]{64}$/.test(t))throw new Problem(401,'Войдите в комнату по своему сохранённому ключу.');const h=await hash(t);if(h===room.host_hash)return {role:'host',id:'host',name:'Ведущий'};const p=await db().prepare('SELECT * FROM players WHERE room=? AND token_hash=?').bind(room.code,h).first<any>();if(!p)throw new Problem(401,'Ключ не подходит к этой комнате.');return {role:'player',...p};}
async function expire(room:any){
 if(room.phase!=='open')return room;
 const run=await db().prepare('SELECT deadline FROM rounds WHERE room=? AND idx=?').bind(room.code,room.current).first<any>();
 if(run?.deadline&&run.deadline<=now()){
  const at=now();
  await db().batch([
   db().prepare("UPDATE rooms SET phase='locked',revision=revision+1 WHERE code=? AND current=? AND phase='open' AND EXISTS(SELECT 1 FROM rounds WHERE room=? AND idx=? AND deadline<=?)").bind(room.code,room.current,room.code,room.current,at),
   db().prepare("UPDATE rounds SET closed=COALESCE(closed,?) WHERE room=? AND idx=? AND deadline<=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND phase='locked')").bind(at,room.code,room.current,at,room.code)
  ]);
  return load(room.code);
 }
 return room;
}
function shown(room:any,idx:number){return idx<room.current||['reveal','finished'].includes(room.phase)}
async function snapshot(req:Request,room:any,user:any){
 const deck:Round[]=JSON.parse(room.deck),url=new URL(req.url);let idx=room.current;
 if(user.role==='host'&&url.searchParams.has('view')){const v=Number(url.searchParams.get('view'));if(Number.isInteger(v)&&v>=0&&v<=room.current)idx=v;}
 const exporting=url.searchParams.get('export')==='1'&&user.role==='host';
 const statements=[db().prepare('SELECT id,name,joined,seen FROM players WHERE room=? ORDER BY joined').bind(room.code),db().prepare('SELECT player,round,choice,confidence,blocked,updated,submitted,score FROM answers WHERE room=?').bind(room.code),db().prepare('SELECT * FROM rounds WHERE room=? ORDER BY idx').bind(room.code),db().prepare(user.role==='host'?'SELECT * FROM answers WHERE room=? AND round=?':'SELECT * FROM answers WHERE room=? AND player=?').bind(room.code,user.role==='host'?idx:user.id),db().prepare('SELECT action,round,at FROM events WHERE room=? ORDER BY id DESC LIMIT 12').bind(room.code)];
 if(exporting)statements.push(db().prepare('SELECT * FROM answers WHERE room=? ORDER BY round,player').bind(room.code));
 const rs=await db().batch(statements);const players=rs[0].results as any[],all=rs[1].results as any[],runs=rs[2].results as any[],responses=rs[3].results as any[];
 const visible=all.filter(a=>a.submitted&&(user.role==='host'||shown(room,a.round)));
 const stats=players.map(p=>{const a=visible.filter(a=>a.player===p.id),mc=a.filter(a=>deck[a.round]?.kind==='choice');return {...p,online:now()-p.seen<18000,submitted:all.filter(a=>a.player===p.id&&a.submitted).length,score:a.reduce((s,a)=>s+(a.score??0),0),pending:a.filter(a=>a.score===null).length,correct:mc.filter(a=>a.score>0).length,mc:mc.length,confidentMistakes:mc.filter(a=>a.confidence===3&&a.score===0).length};});
 const active=all.filter(a=>a.round===idx);const reveal=idx>=0&&shown(room,idx);
 const histogram=deck[idx]?.options?.map((_,i)=>active.filter(a=>a.submitted&&a.choice===i).length)||[];
 const safeResponses=responses.map(a=>{const s=shown(room,a.round)||user.role==='host';return {...a,score:s?a.score:null,feedback:s?a.feedback:''};});
 const roomOut={code:room.code,title:room.title,current:room.current,phase:room.phase,revision:room.revision,context:room.context,joinLocked:!!room.join_locked,created:room.created,ended:room.ended};
 const response:any={serverTime:now(),role:user.role,me:user.id,room:roomOut,deck:deck.map(({id,title,act,kind,points,minutes})=>({id,title,act,kind,points,minutes})),view:idx,round:idx>=0?publicRound(deck[idx],user.role==='host'||reveal):null,run:runs.find(r=>r.idx===idx)||null,runs,players:stats,answers:safeResponses,progress:active.map(a=>({player:a.player,status:a.submitted?'submitted':now()-a.updated<9000?'writing':'draft',updated:a.updated})),histogram:user.role==='host'||reveal?histogram:[],answered:active.filter(a=>a.submitted).length,events:user.role==='host'?rs[4].results:[],summary:deck.map((r,i)=>({id:r.id,title:r.title,kind:r.kind,opened:runs.some(s=>s.idx===i),submitted:all.filter(a=>a.round===i&&a.submitted).length,correct:(user.role==='host'||shown(room,i))?all.filter(a=>a.round===i&&a.submitted&&a.score>0&&r.kind==='choice').length:null}))};
 if(exporting)response.export={schema:1,exported:new Date().toISOString(),room:roomOut,deck:deck.map(r=>publicRound(r,true)),players:stats,runs,answers:rs[5].results};
 return response;
}
export async function GET(req:Request){try{const code=validCode(new URL(req.url).searchParams.get('code'));let room=await load(code);const user=await who(req,room);room=await expire(room);if(user.role==='player'&&now()-user.seen>10000)await db().prepare('UPDATE players SET seen=? WHERE id=?').bind(now(),user.id).run();return out(await snapshot(req,room,user));}catch(e){return failure(e)}}
export async function POST(req:Request){try{
 if(req.headers.get('Origin')&&new URL(req.headers.get('Origin')!).origin!==new URL(req.url).origin)throw new Problem(403,'Откройте игру по её основному адресу.');
 const bodyText=await req.text();if(bodyText.length>20000)throw new Problem(413,'Слишком длинный запрос.');let b:any;try{b=JSON.parse(bodyText)}catch{throw new Problem(400,'Не удалось прочитать запрос.');}
 if(!b||typeof b!=='object'||Array.isArray(b))throw new Problem(400,'Неверный запрос.');const action=text(b.action,30);
 if(action==='create'){
  const ip=req.headers.get('cf-connecting-ip');if(ip){const key=(await hash(ip)).slice(0,24)+':'+Math.floor(now()/3600000);const count=await db().prepare('INSERT INTO limits (key,count) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key).first<any>();if(count.count>20)throw new Problem(429,'Слишком много новых комнат. Попробуйте позже.');}
  const title=text(b.title,80)||'Первый эксперимент';const secret=token();let code='';const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let tries=0;tries<5;tries++){code=Array.from(crypto.getRandomValues(new Uint8Array(6)),x=>alphabet[x%alphabet.length]).join('');try{await db().prepare('INSERT INTO rooms (code,title,host_hash,deck,created) VALUES (?,?,?,?,?)').bind(code,title,await hash(secret),JSON.stringify(DECK),now()).run();break;}catch(e){if(tries===4)throw e;}}
  return out({code,token:secret,role:'host'},201);
 }
 const code=validCode(b.code);let room=await load(code);
 if(action==='join'){
  if(room.phase==='finished'||room.join_locked)throw new Problem(409,'Ведущий закрыл вход в эту комнату.');const name=text(b.name,32).replace(/\s+/g,' ');if(name.length<2)throw new Problem(400,'Введите имя от 2 до 32 символов.');const secret=token(),id=crypto.randomUUID();
  try{const ins=await db().prepare("INSERT INTO players (id,room,name,token_hash,joined,seen) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE code=? AND join_locked=0 AND phase!='finished') AND (SELECT COUNT(*) FROM players WHERE room=?)<40").bind(id,code,name,await hash(secret),now(),now(),code,code).run();if(!ins.meta.changes)throw new Problem(409,'Вход закрыт или достигнут лимит 40 участников.');}catch(e){if(e instanceof Problem)throw e;throw new Problem(409,'Это имя уже занято в комнате. Добавьте фамилию или номер.');}
  return out({code,token:secret,id,role:'player',name},201);
 }
 const user=await who(req,room);room=await expire(room);const deck:Round[]=JSON.parse(room.deck);
 if(action==='answer'||action==='draft'){
  if(user.role!=='player')throw new Problem(403,'Ответы отправляет участник.');if(room.phase!=='open'||b.round!==room.current)throw new Problem(409,'Раунд уже закрыт или сменился. Ваш черновик сохранён на устройстве.');
  const r=deck[room.current],answerText=text(b.text,r.maxLength||4000),ref=text(b.ref,500),blocked=b.blocked?1:0,confidence=[1,2,3].includes(b.confidence)?b.confidence:2;
  const choice=Number.isInteger(b.choice)&&b.choice>=0&&b.choice<(r.options?.length||0)?b.choice:null;
  if(action==='answer'&&(r.kind==='choice'?choice===null:answerText.length<8))throw new Problem(400,r.kind==='choice'?'Выберите вариант ответа.':'Запишите хотя бы одно содержательное предложение.');
  const submitted=action==='answer'?now():null,score=action==='answer'&&r.kind==='choice'?(choice===r.correct?r.points:0):null;
  const changed=await db().prepare("INSERT INTO answers (room,player,round,choice,text,ref,blocked,confidence,updated,submitted,score) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms r JOIN rounds s ON s.room=r.code AND s.idx=r.current WHERE r.code=? AND r.current=? AND r.phase='open' AND (s.deadline IS NULL OR s.deadline>?)) ON CONFLICT(room,player,round) DO UPDATE SET choice=excluded.choice,text=excluded.text,ref=excluded.ref,blocked=excluded.blocked,confidence=excluded.confidence,updated=excluded.updated,submitted=excluded.submitted,score=excluded.score WHERE answers.submitted IS NULL AND EXISTS(SELECT 1 FROM rooms r JOIN rounds s ON s.room=r.code AND s.idx=r.current WHERE r.code=? AND r.current=? AND r.phase='open' AND (s.deadline IS NULL OR s.deadline>?))").bind(code,user.id,room.current,choice,answerText,ref,blocked,confidence,now(),submitted,score,code,room.current,now(),code,room.current,now()).run();
  if(!changed.meta.changes)throw new Problem(409,'Ответ уже отправлен либо раунд закрыт.');return out({ok:true,submitted:!!submitted});
 }
 if(user.role!=='host')throw new Problem(403,'Этим действием управляет только ведущий.');
 if(action==='grade'){
  const idx=Number(b.round),score=Number(b.score);if(!Number.isInteger(idx)||idx<0||idx>room.current||deck[idx]?.kind==='choice'||!Number.isInteger(score)||score<0||score>deck[idx].points||!shown(room,idx))throw new Problem(400,'Оценку письменного ответа можно поставить после открытия разбора.');
  await db().prepare('UPDATE answers SET score=?,feedback=? WHERE room=? AND player=? AND round=? AND submitted IS NOT NULL').bind(score,text(b.feedback,1500),code,text(b.player,80),idx).run();return out({ok:true});
 }
 if(action==='team'){
  const idx=Number(b.round);if(!Number.isInteger(idx)||idx<0||idx>room.current)throw new Problem(400,'Неверный раунд.');await db().prepare('UPDATE rounds SET team_ref=?,team_done=? WHERE room=? AND idx=?').bind(text(b.ref,500),b.done?1:0,code,idx).run();return out({ok:true});
 }
 if(!Number.isInteger(b.revision)||b.revision!==room.revision)throw new Problem(409,'Состояние комнаты изменилось. Обновляю данные — повторите действие.');
 const at=now(),mutation=crypto.randomUUID();let nextCurrent=room.current,nextPhase=room.phase,joinLocked=room.join_locked,context=room.context,ended=room.ended;const extra:any[]=[];
 if(action==='open'){
  if(!['lobby','reveal'].includes(room.phase))throw new Problem(409,'Сначала закройте текущий раунд и откройте разбор.');nextCurrent=room.current+1;if(nextCurrent>=deck.length)throw new Problem(409,'Все раунды пройдены. Завершите игру.');nextPhase='open';
  const seconds=b.seconds===0?0:Math.max(30,Math.min(1800,Number(b.seconds)||deck[nextCurrent].minutes*60));extra.push(db().prepare('INSERT INTO rounds (room,idx,opened,deadline) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE code=? AND mutation=?)').bind(code,nextCurrent,at,seconds?at+seconds*1000:null,code,mutation));
 }else if(action==='close'){
  if(room.phase!=='open')throw new Problem(409,'Раунд уже закрыт.');nextPhase='locked';extra.push(db().prepare('UPDATE rounds SET closed=? WHERE room=? AND idx=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND mutation=?)').bind(at,code,room.current,code,mutation));
 }else if(action==='reveal'){
  if(room.phase!=='locked')throw new Problem(409,'Сначала закройте приём ответов.');nextPhase='reveal';extra.push(db().prepare('UPDATE rounds SET revealed=? WHERE room=? AND idx=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND mutation=?)').bind(at,code,room.current,code,mutation));
 }else if(action==='extend'){
  if(room.phase!=='open')throw new Problem(409,'Продлить можно только открытый раунд.');extra.push(db().prepare('UPDATE rounds SET deadline=CASE WHEN deadline IS NULL THEN NULL ELSE MAX(deadline,?)+60000 END WHERE room=? AND idx=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND mutation=?)').bind(at,code,room.current,code,mutation));
 }else if(action==='context'){context=text(b.context,2000);
 }else if(action==='lockJoin'){joinLocked=b.locked?1:0;
 }else if(action==='finish'){
  if(room.phase==='finished')return out({ok:true});nextPhase='finished';joinLocked=1;ended=at;if(room.current>=0)extra.push(db().prepare('UPDATE rounds SET closed=COALESCE(closed,?),revealed=COALESCE(revealed,?) WHERE room=? AND idx=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND mutation=?)').bind(at,at,code,room.current,code,mutation));
 }else throw new Problem(400,'Неизвестное действие.');
 // D1 batch executes atomically. A revision-qualified write prevents two host tabs advancing twice.
 const update=db().prepare('UPDATE rooms SET current=?,phase=?,join_locked=?,context=?,ended=?,mutation=?,revision=revision+1 WHERE code=? AND revision=? RETURNING revision').bind(nextCurrent,nextPhase,joinLocked,context,ended,mutation,code,room.revision);
 // The uniqueness of (room,idx) also makes simultaneous open requests roll back as a whole.
 const results=await db().batch([update,...extra,db().prepare('INSERT INTO events (room,actor,action,round,at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE code=? AND mutation=?)').bind(code,'host',action,nextCurrent,at,code,mutation)]);
 if(!results[0].results.length)throw new Problem(409,'Другая вкладка уже изменила комнату. Обновите состояние.');return out({ok:true});
 }catch(e){return failure(e)}}
function failure(e:any){if(e instanceof Problem)return out({error:e.message},e.status);console.error('game request failed',e?.message);return out({error:'Не удалось обработать действие. Ответы сохранены; повторите после обновления.'},500)}
