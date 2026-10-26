const esbuild=require('esbuild'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto').webcrypto;
const build=esbuild.buildSync({entryPoints:['src/model.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const box={module:{exports:{}},exports:{},require,console,crypto,Date,structuredClone,Uint8Array,TextEncoder};box.exports=box.module.exports;vm.runInNewContext(build,box);const {GameEngine,createState,secret}=box.module.exports;
let persisted=null;const token=secret(),code='ABCD2345EFGH',e=new GameEngine(createState(code,'10 участников',token),s=>{persisted=structuredClone(s)});
const host=(action,extra={})=>e.request({action,revision:e.state.room.revision,...extra},token);
const players=Array.from({length:10},(_,i)=>e.request({action:'join',name:'Игрок '+(i+1)}));
assert.throws(()=>e.request({action:'open',revision:0},players[0].token,true),/ведущий/);
assert.throws(()=>e.request({action:'state'},token,true),/Ключ/);
host('context',{context:'Один эксперимент на всю команду'});
let sent=0,expected=0;
for(let i=0;i<14;i++){
 const rev=e.state.room.revision;host('open',{seconds:0});assert.throws(()=>e.request({action:'open',revision:rev},token),/изменилось/);
 const d=e.state.deck[i];
 for(let p=0;p<10;p++){
  const s=players[p],payload={round:i,choice:d.kind==='choice'?(p===0?(d.correct+1)%d.options.length:d.correct):null,text:'Решение '+p+' с обоснованием',ref:'Тестовый артефакт',confidence:3,blocked:p===0};
  e.request({action:'draft',...payload},s.token,true);
  const preview=e.request({action:'state'},s.token,true);assert.equal(preview.round.correct,undefined);assert.equal(preview.round.model,undefined);assert.equal(preview.histogram.length,0);assert(preview.answers.every(a=>a.player===s.id));
  assert.equal(e.request({action:'state'},token).answers.filter(a=>a.player===s.id).length,1);
  e.request({action:'answer',...payload},s.token,true);sent++;
  assert.throws(()=>e.request({action:'draft',...payload},s.token,true),/зафиксирован/);
 }
 host('close');assert.throws(()=>e.request({action:'answer',round:i,text:'Поздний ответ'},players[0].token,true),/закрыт/);
 host('reveal');assert(e.request({action:'state'},players[0].token,true).round.model);
 if(d.kind!=='choice')for(const s of players)host('grade',{round:i,player:s.id,score:8,feedback:'Разбор'});
 if(d.kind==='artifact')host('team',{round:i,ref:'Тестовый общий артефакт',done:true});
 expected+=d.kind==='choice'?0:8;
}
host('finish');const stats=e.request({action:'state',export:true},token).export;
assert.equal(sent,140);assert.equal(stats.answers.length,140);assert.equal(stats.players[0].score,expected);assert.equal(stats.players[0].pending,0);
assert.throws(()=>e.request({action:'join',name:'Опоздавший'}),/закрыл/);
assert.throws(()=>e.request({action:'state',export:true},players[0].token,true),/ведущий/);
for(const s of players)assert(!JSON.stringify(stats).includes(s.token));assert(!JSON.stringify(stats).includes(token));
const resumed=new GameEngine(persisted);assert.equal(resumed.request({action:'state'},token).room.phase,'finished');assert.equal(resumed.request({action:'state'},token).players.length,10);
// No successful acknowledgment when persistence fails.
const disk=new GameEngine(createState(code,'Storage failure',token),()=>{throw Error('disk full')});assert.throws(()=>disk.request({action:'join',name:'Человек'}),/disk full/);assert.equal(disk.state.players.length,0);
// Timer is enforced by the host before accepting a packet, even when host UI hasn't polled.
const timed=new GameEngine(createState(code,'Timer',token));const p=timed.request({action:'join',name:'Человек'});timed.request({action:'open',revision:0,seconds:30},token);timed.state.runs[0].deadline=Date.now()-1;assert.throws(()=>timed.request({action:'answer',round:0,choice:0},p.token,true),/закрыт/);assert.equal(timed.state.room.phase,'locked');
console.log('PASS: 10 participants × 14 rounds = 140 answers; role isolation, reveal, grading, timer, stale revisions, persistence rollback, restart, private export.');
