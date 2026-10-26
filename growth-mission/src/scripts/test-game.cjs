// Runs the real request handlers against SQLite with the D1 prepare/batch contract.
const {DatabaseSync}=require('node:sqlite');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const assert=require('node:assert/strict');
const sql=new DatabaseSync(':memory:');
sql.exec(readFileSync('drizzle/0000_bright_hobgoblin.sql','utf8'));
class Stmt{constructor(query,args=[]){this.query=query;this.args=args}bind(...a){return new Stmt(this.query,a)}exec(){const p=sql.prepare(this.query);if(/^\s*SELECT|\bRETURNING\b/i.test(this.query))return {results:p.all(...this.args),meta:{changes:0}};const r=p.run(...this.args);return {results:[],meta:{changes:Number(r.changes)}}}async first(){return this.exec().results[0]||null}async run(){return this.exec()}async all(){return this.exec()}}
const DB={prepare:q=>new Stmt(q),async batch(ss){sql.exec('BEGIN');try{const r=ss.map(s=>s.exec());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
function load(file,deps){const exports={};const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,require:n=>deps[n]||require(n),Request,Response,URL,TextEncoder,crypto:globalThis.crypto,console,Date,Uint8Array});return exports;}
const deck=load('lib/deck.ts',{}),api=load('app/api/game/route.ts',{'cloudflare:workers':{env:{DB}},'../../../lib/deck':deck});
async function post(body,s){const r=await api.POST(new Request('https://test.local/api/game',{method:'POST',headers:{'Content-Type':'application/json',...(s?{Authorization:'Bearer '+s.token}:{})},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}}
async function get(s,extra=''){const r=await api.GET(new Request('https://test.local/api/game?code='+s.code+extra,{headers:{Authorization:'Bearer '+s.token}}));return {status:r.status,data:await r.json()}}
async function ok(b,s){const r=await post(b,s);assert.ok(r.status<300,JSON.stringify(r));return r.data}
(async()=>{
 const host=await ok({action:'create',title:'QA 10 participants'});
 const players=await Promise.all(Array.from({length:10},(_,i)=>ok({action:'join',code:host.code,name:'Игрок '+(i+1)})));
 let state=(await get(host)).data;assert.equal(state.players.length,10);
 assert.equal((await post({action:'open',code:host.code,revision:state.room.revision},players[0])).status,403);
 const opening=await Promise.all([post({action:'open',code:host.code,revision:0,seconds:120},host),post({action:'open',code:host.code,revision:0,seconds:120},host)]);
 assert.deepEqual(opening.map(r=>r.status).sort(),[200,409]);state=(await get(host)).data;assert.equal(state.room.current,0);
 const before=state.run.deadline;const ext=await Promise.all([post({action:'extend',code:host.code,revision:state.room.revision},host),post({action:'extend',code:host.code,revision:state.room.revision},host)]);assert.deepEqual(ext.map(r=>r.status).sort(),[200,409]);state=(await get(host)).data;assert.equal(state.run.deadline,before+60000);
 await ok({action:'draft',code:host.code,round:0,choice:1,text:'Секретный черновик',confidence:3},players[0]);
 assert.equal((await get(host)).data.answers[0].text,'Секретный черновик');
 assert.equal((await get(players[1])).data.answers.length,0);
 assert.equal((await get(players[0])).data.round.correct,undefined);
 for(let i=0;i<9;i++)await ok({action:'answer',code:host.code,round:0,choice:i%2?0:1,text:'Обоснование решения',confidence:3},players[i]);
 state=(await get(host)).data;assert.equal(state.answered,9);
 let p=(await get(players[0])).data;assert.equal(p.answers[0].score,null);assert.equal(p.players[0].score,0);assert.equal(p.histogram.length,0);
 await ok({action:'close',code:host.code,revision:state.room.revision},host);
 assert.equal((await post({action:'answer',code:host.code,round:0,choice:1},players[9])).status,409);
 state=(await get(host)).data;await ok({action:'reveal',code:host.code,revision:state.room.revision},host);
 p=(await get(players[0])).data;assert.equal(p.round.correct,1);assert.equal(p.players[0].score,10);
 for(let idx=1;idx<deck.DECK.length;idx++){
  state=(await get(host)).data;await ok({action:'open',code:host.code,revision:state.room.revision,seconds:0},host);
  const r=deck.DECK[idx];
  await Promise.all(players.map((s,i)=>ok({action:'answer',code:host.code,round:idx,choice:r.kind==='choice'?(i%2?r.correct:(r.correct+1)%r.options.length):null,text:'Содержательное письменное решение для обсуждения',ref:r.kind==='artifact'?'EXP-QA':'',blocked:r.kind==='artifact'&&i===9,confidence:2},s)));
  state=(await get(host)).data;assert.equal(state.answered,10);
  await ok({action:'close',code:host.code,revision:state.room.revision},host);state=(await get(host)).data;await ok({action:'reveal',code:host.code,revision:state.room.revision},host);
  if(r.kind!=='choice'){
   assert.equal((await post({action:'grade',code:host.code,round:idx,player:players[0].id,score:7},players[1])).status,403);
   await ok({action:'grade',code:host.code,round:idx,player:players[0].id,score:7,feedback:'Есть механизм и понятный следующий шаг'},host);
   assert.equal((await get(players[0])).data.answers.find(a=>a.round===idx).score,7);
  }
 }
 state=(await get(host)).data;await ok({action:'context',code:host.code,revision:state.room.revision,context:'Общая вводная теста'},host);assert.equal((await get(players[0])).data.room.context,'Общая вводная теста');
 state=(await get(host)).data;await ok({action:'finish',code:host.code,revision:state.room.revision},host);
 assert.equal((await post({action:'join',code:host.code,name:'Опоздавший'})).status,409);
 const result=(await get(host,'&export=1')).data;assert.equal(result.export.answers.filter(a=>a.submitted).length,139);assert.equal(result.export.players.length,10);assert.equal(result.export.runs.length,14);assert.equal(JSON.stringify(result.export).includes('host_hash'),false);assert.equal(JSON.stringify(result.export).includes('token_hash'),false);
 assert.equal((await get(players[0],'&export=1')).data.export,undefined);
 // Server clock remains authoritative even if no browser timer is running.
 const timed=await ok({action:'create'}),late=await ok({action:'join',code:timed.code,name:'Late player'});await ok({action:'open',code:timed.code,revision:0,seconds:30},timed);sql.prepare('UPDATE rounds SET deadline=? WHERE room=?').run(Date.now()-1,timed.code);
 assert.equal((await post({action:'answer',code:timed.code,round:0,choice:1},late)).status,409);assert.equal((await get(timed)).data.room.phase,'locked');
 console.log('PASS: 10 players / 14 rounds / 139 submitted answers; draft privacy, hidden keys/scores, late/duplicate submissions, host concurrency, one-time extension, grading, context, finish, expiry, exports.');
})().catch(e=>{console.error(e);process.exitCode=1});
