import Peer, {type DataConnection} from 'peerjs';
import {GameEngine,createState,secret,validateState,type Session,type State} from './model';
const PREFIX='growth-mission-pages-v2-', alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const enc=new TextEncoder();
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const unhex=(s:string)=>Uint8Array.from(s.match(/.{2}/g)||[],x=>parseInt(x,16));
async function roomCode(pub:JsonWebKey){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(JSON.stringify({kty:pub.kty,crv:pub.crv,x:pub.x,y:pub.y}))));return Array.from(h.slice(0,12),x=>alphabet[x%32]).join('')}
function readState(code:string){try{const s=JSON.parse(localStorage.getItem('gm2.host.'+code)||'null');validateState(s);return s}catch{throw Error('На этом устройстве нет данных ведущего. Загрузите резервную копию комнаты.')}}
function saveState(s:State){try{localStorage.setItem('gm2.host.'+s.room.code,JSON.stringify(s))}catch{throw Error('Не удалось сохранить комнату в браузере ведущего. Освободите место и повторите отправку.')}}
let peer:Peer|null=null,connection:DataConnection|null=null,engine:GameEngine|null=null,sessionKey='',ready:Promise<void>|null=null,signKey:CryptoKey|null=null;
let pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:any}>();
function offline(){return Error('Нет соединения с ведущим. Ведущий должен держать комнату открытой. Если связь не появилась, проверьте, разрешён ли WebRTC в вашей сети.')}
function rejectPending(){for(const p of pending.values()){clearTimeout(p.timer);p.reject(offline())}pending.clear()}
export function stopGame(){rejectPending();peer?.destroy();peer=null;connection=null;ready=null;engine=null;sessionKey='';signKey=null}
async function respond(c:DataConnection,m:any){
 if(!engine||!signKey||!m||typeof m.id!=='string'||m.id.length>80||JSON.stringify(m).length>22000)return;
 let reply:any;try{reply={id:m.id,data:engine.request(m.body,m.token,true)}}catch(e:any){reply={id:m.id,error:e.message||'Не удалось выполнить действие.'}}
 const raw=JSON.stringify(reply),signature=hex(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signKey,enc.encode(raw)));
 if(c.open)c.send({raw,signature,publicKey:engine.state.keys.publicKey});
}
async function ensure(s:Session){
 if(!crypto.subtle)throw Error('Совместная игра требует HTTPS. Откройте опубликованную страницу на GitHub.');
 const key=s.role+':'+s.code+':'+s.token;if(ready&&sessionKey===key)return ready;
 stopGame();sessionKey=key;
 ready=(async()=>{
  if(s.role==='host'){
   const state=readState(s.code);if(state.hostToken!==s.token)throw Error('Ключ ведущего не подходит к этой комнате.');
   if(await roomCode(state.keys.publicKey)!==s.code)throw Error('Повреждён ключ комнаты в резервной копии.');
   engine=new GameEngine(state,saveState);signKey=await crypto.subtle.importKey('jwk',state.keys.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  }
  await new Promise<void>((resolve,reject)=>{
   const p=s.role==='host'?new Peer(PREFIX+s.code,{debug:0}):new Peer({debug:0});peer=p;
   let settled=false;const timer=setTimeout(()=>fail(Error('Не удалось установить соединение за 20 секунд. Проверьте доступ к PeerJS и WebRTC в вашей сети.')),20000);
   function fail(e:Error){if(settled)return;settled=true;clearTimeout(timer);reject(e);p.destroy()}
   function done(){if(settled)return;settled=true;clearTimeout(timer);resolve()}
   p.on('error',(e:any)=>{const message=e.type==='unavailable-id'?'Эта комната уже открыта у ведущего в другой вкладке или на другом устройстве. Закройте прежнюю вкладку и повторите.':e.type==='peer-unavailable'?'Комната не найдена в сети. Проверьте 12-значный код и попросите ведущего открыть комнату.':'Нет связи с сервисом соединения. Проверьте доступ к PeerJS и WebRTC в вашей сети.';fail(Error(message));rejectPending()});
   p.on('disconnected',()=>{if(!settled)fail(offline());else if(!p.destroyed){try{p.reconnect()}catch{}}});
   p.on('connection',c=>{if(s.role!=='host'){c.close();return}c.on('data',m=>{respond(c,m).catch(()=>{if(c.open)c.send({error:'Ошибка обработки ответа'})})});c.on('error',()=>{})});
   p.on('open',()=>{
    if(s.role==='host'){done();return}
    const c=p.connect(PREFIX+s.code,{reliable:true});connection=c;
    c.on('open',done);c.on('close',()=>{connection=null;ready=null;rejectPending()});c.on('error',()=>{fail(offline());rejectPending()});
    c.on('data',async(m:any)=>{
     try{
      if(typeof m?.raw!=='string'||m.raw.length>250000||typeof m.signature!=='string'||!/^[a-f0-9]{128}$/.test(m.signature))return;
      if(await roomCode(m.publicKey)!==s.code)throw Error('Ключ ведущего не совпадает с кодом комнаты. Соединение отклонено.');
      const key=await crypto.subtle.importKey('jwk',m.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unhex(m.signature),enc.encode(m.raw)))throw Error('Подпись ведущего не прошла проверку.');
      const reply=JSON.parse(m.raw),task=pending.get(reply.id);if(!task)return;clearTimeout(task.timer);pending.delete(reply.id);reply.error?task.reject(Error(reply.error)):task.resolve(reply.data);
     }catch(e:any){rejectPending();c.close()}
    });
   });
  });
 })();
 try{await ready}catch(e){ready=null;throw e}
}
async function rpc(b:any,s:Session){await ensure(s);if(s.role==='host'){if(!engine)throw offline();return engine.request(b,s.token)}
 if(!connection?.open)throw offline();
 return new Promise<any>((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(offline())},15000);pending.set(id,{resolve,reject,timer});try{connection!.send({id,body:b,token:s.token})}catch{clearTimeout(timer);pending.delete(id);reject(offline())}})
}
export async function post(b:any,s?:Session):Promise<any>{
 if(b.action==='create'){
  stopGame();const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey),privateKey=await crypto.subtle.exportKey('jwk',keys.privateKey),code=await roomCode(publicKey),token=secret(),state=createState(code,b.title,token);
  state.keys={publicKey,privateKey};saveState(state);const host:Session={code,token,role:'host'};await ensure(host);return host;
 }
 if(b.action==='join'){
  const code=String(b.code||'').toUpperCase();if(!/^[A-HJ-NP-Z2-9]{12}$/.test(code))throw Error('Введите 12-значный код новой комнаты. Старые серверные комнаты сюда не перенесены.');
  const k='gm2.join.'+code+'.'+String(b.name).trim();let joinSecret='';try{joinSecret=localStorage.getItem(k)||'';if(!/^[a-f0-9]{64}$/.test(joinSecret)){joinSecret=secret();localStorage.setItem(k,joinSecret)}}catch{throw Error('Разрешите сохранение данных этого сайта в браузере, чтобы войти в комнату.');}
  return rpc({...b,joinSecret},{code,token:'',role:'player'});
 }
 if(!s)throw offline();return rpc(b,s);
}
export async function state(s:Session,view:number|null=null,exporting=false){return rpc({action:'state',view:view??undefined,export:exporting},s)}
export function backup(s:Session){const state=readState(s.code);if(s.role!=='host'||state.hostToken!==s.token)throw Error('Резервную копию сохраняет ведущий.');return JSON.stringify(state,null,2)}
export async function restore(raw:string):Promise<Session>{if(raw.length>4000000)throw Error('Слишком большой файл.');const s=JSON.parse(raw);validateState(s);if(await roomCode(s.keys.publicKey)!==s.room.code)throw Error('Код комнаты не соответствует ключу в файле.');saveState(s);return {code:s.room.code,token:s.hostToken,role:'host'}}
addEventListener('pagehide',()=>stopGame());
