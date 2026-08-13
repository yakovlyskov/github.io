function textValue(v){return String(v??'').trim()}
function touchedCriteria(){return criteria.filter(c=>Number(state.criteria?.[c.id]??3)!==3)}
function answeredPoints(){return (state.points||[]).map((x,i)=>({x,i})).filter(({x})=>Number(x?.score??5)!==5||textValue(x?.why)||textValue(x?.ten))}
function evidenceStats(){
 const context=['education','story','currentRole','whyNow','request','desiredResult'].map(k=>textValue(state.data?.[k])).join(' ').trim();
 const groupText=k=>(state[k]||[]).flatMap(o=>Object.values(o||{})).map(textValue).join(' ').trim();
 const groups=[
  {id:'context',label:'Контекст и запрос',text:context,min:80},
  {id:'jobs',label:'Профессиональный опыт',text:groupText('jobs'),min:80},
  {id:'wins',label:'Победы и сильные действия',text:groupText('wins'),min:60},
  {id:'lives',label:'Интересы / «10 жизней»',text:groupText('lives'),min:50},
  {id:'people',label:'Обратная связь окружения',text:groupText('people'),min:50}
 ];
 const active=groups.filter(g=>g.text.length>=g.min),chars=groups.reduce((s,g)=>s+g.text.length,0),criteriaCount=touchedCriteria().length,pointCount=answeredPoints().length;
 return {groups,active,chars,criteriaCount,pointCount,ready:chars>=250&&active.length>=2};
}
function roleScore(role,dimScores,drains){
 const tc=touchedCriteria();let num=0,den=0;
 tc.forEach(c=>{const w=Number(state.criteria?.[c.id]??3);num+=(role.crit[c.id]||0)*w;den+=5*w});
 const a=den?num/den*100:null;
 let s=0,dw=0;for(const[k,w]of Object.entries(role.dims)){const signal=dimScores[k]||0;if(signal>0){s+=signal*w;dw+=100*w}}
 const b=dw?s/dw*100:null;
 let base=a!==null&&b!==null?a*.68+b*.32:a!==null?a:b!==null?b:0;
 let p=0;(role.risk||[]).forEach(r=>p+=(drains[r]||0)*.12);
 return Math.max(0,Math.min(96,Math.round(base-p)));
}
function evidenceFor(role,s){return Object.entries(role.dims).filter(([k])=>(s[k]||0)>0).sort((a,b)=>(s[b[0]]||0)*b[1]-(s[a[0]]||0)*a[1]).slice(0,3).map(([k])=>dims[k]?.label).filter(Boolean)}
function topEntries(s,d,n=5,min=1){return Object.entries(s).filter(([,v])=>v>=min).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>({k,v,label:d[k].label}))}
function emptyReport(ev){
 const checks=ev.groups.map(g=>`<span class="tag2 ${g.text.length>=g.min?'good':''}">${g.text.length>=g.min?'✓':'○'} ${g.label}</span>`).join('');
 const chars=Math.min(ev.chars,250),blocks=Math.min(ev.active.length,2);
 document.getElementById('report').innerHTML=`<div class="reportHero"><h2>Пока рано строить карьерный shortlist</h2><p>Сайт больше не делает выводы из стартовых значений. Сначала нужны реальные ответы, из которых можно собрать доказательства.</p></div><div class="card"><h2>Что нужно для первого расчёта</h2><p class="muted">Заполните хотя бы <b>2 содержательных блока</b> и наберите примерно <b>250 символов</b> осмысленного описания. Лучше всего начать с профессионального опыта, побед и того, какие роли/действия вам интересны.</p><div class="taglist">${checks}</div><div class="divider"></div><div class="note">Сейчас: <b>${blocks}/2</b> содержательных блока · <b>${chars}/250</b> символов. Критерии работы и «Точка А» уточняют результат, но сами по себе больше не создают профессии из ничего.</div></div><div class="card"><h3>Почему так</h3><p class="muted">Ранжирование профессий должно опираться на наблюдаемые сигналы: что вы реально делали, что получалось, что давало энергию, что привлекает и какие условия работы важны. До появления таких сигналов корректный результат — «данных недостаточно».</p></div>`;
}
function renderReport(){
 save();const ev=evidenceStats();if(!ev.ready){emptyReport(ev);return}
 const text=allText(),ds=normalizeScores(countDim(dims,text)),drs=normalizeScores(countDim(drainDims,text)),top=topEntries(ds,dims,6,5),dr=topEntries(drs,drainDims,5,10),ranked=roles.map(r=>({...r,score:roleScore(r,ds,drs),evidence:evidenceFor(r,ds)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
 const ap=answeredPoints(),avg=ap.length?Math.round(ap.reduce((s,{x})=>s+(+x.score||0),0)/ap.length):null,low=ap.map(({x,i})=>({q:pointQuestions[i],s:+x.score||0})).sort((a,b)=>a.s-b.s).slice(0,3),ct=touchedCriteria().map(c=>({label:c.label,v:state.criteria[c.id]})).sort((a,b)=>b.v-a.v).slice(0,4);
 const coverage=Math.min(100,Math.round(Math.min(ev.chars/800,1)*45+Math.min(ev.active.length/5,1)*30+Math.min(ev.criteriaCount/7,1)*15+Math.min(ev.pointCount/10,1)*10));
 const bars=top.length?top.map(x=>`<div class="barRow"><span>${x.label}</span><div class="bar"><i style="width:${x.v}%"></i></div><strong>${x.v}</strong></div>`).join(''):'<div class="note warn">В тексте пока мало повторяющихся сигналов — интерпретируйте shortlist осторожно.</div>';
 const anti=dr.length?dr.map(x=>`<span class="tag2 bad">${x.label}</span>`).join(''):'<span class="tag2">Явных антидрайверов пока мало</span>';
 const rh=ranked.slice(0,5).map((r,i)=>{const why=r.evidence.length?r.evidence.join(' · '):ev.criteriaCount?'совпадение по явно выбранным критериям работы':'сигнал слабый — нужна дополнительная проверка';return `<div class="role"><div class="roleTop"><h4>${i+1}. ${r.name}</h4><span class="fit">${r.score}% fit</span></div><p>${r.desc}</p><div class="why"><b>Почему:</b> ${why}.</div><div class="mvp"><b>MVP-тест:</b> ${r.mvp}</div></div>`}).join('');
 const plan=ranked.slice(0,3).map(r=>`<div class="planItem"><div><b>${r.name}</b><br><span class="muted">${r.mvp}</span></div></div>`).join(''),formula=top.slice(0,3).map(x=>x.label).join(' + ')||'пока не выделена';
 document.getElementById('report').innerHTML=`<div class="reportHero"><h2>${esc(state.data.name||'Ваш карьерный профиль')}</h2><p>Полнота данных для синтеза: <b>${coverage}%</b>. Это показатель объёма и разнообразия введённых свидетельств, а не вероятность «правильности» профессии.</p></div><div class="reportGrid"><div class="reportCard"><h3>Карта драйверов</h3><div class="bars">${bars}</div></div><div class="reportCard"><h3>Что важно в работе</h3>${ct.length?`<div class="taglist">${ct.map(x=>`<span class="tag2 good">${x.v}/5 · ${x.label}</span>`).join('')}</div>`:'<div class="note">Критерии пока не были явно изменены — они не участвуют в ранжировании.</div>'}<div class="divider"></div><h3>Антидрайверы</h3><div class="taglist">${anti}</div></div></div><div class="card" style="margin-top:18px"><h2>Ваш профессиональный код</h2><p style="font-size:18px;line-height:1.7"><b>Формула:</b> ${formula}.</p><p class="muted">Смотрите на ежедневную механику роли: тип задач, видимый результат, объём общения, автономию и границы ответственности.</p></div><div class="card"><div class="sectionHead"><div><h2>Shortlist карьерных гипотез</h2><p>Это не готовый ответ, а направления для проверки, рассчитанные только после появления достаточного объёма ваших данных.</p></div><span class="pill">Top 5</span></div><div class="roleList">${rh||'<div class="note warn">Сигналов пока недостаточно для ранжирования конкретных ролей.</div>'}</div></div><div class="reportGrid"><div class="reportCard"><h3>Точка А</h3>${avg!==null?`<p>Средняя по отвеченным шкалам: <b>${avg}/10</b>.</p><div class="taglist">${low.map(x=>`<span class="tag2">${x.s}/10 · ${x.q}</span>`).join('')}</div>`:'<p class="muted">Шкалы пока не были содержательно заполнены, поэтому средняя не рассчитывается.</p>'}</div><div class="reportCard"><h3>Ограничения перехода</h3><p>${state.data.constraints?esc(state.data.constraints):'Не указаны.'}</p><p><b>Неприемлемо:</b> ${state.data.dealbreakers?esc(state.data.dealbreakers):'не зафиксировано'}</p></div></div><div class="card" style="margin-top:18px"><h2>Спринт проверки на 30 дней</h2><div class="plan">${plan}</div><div class="note good"><b>После каждого теста оцените:</b> интерес в процессе, энергию после, желание углубиться, отклик практика и готовность повторить.</div></div><div class="card"><h3>Как использовать результат</h3><p class="muted">Выберите 2–3 гипотезы с внутренним откликом, проведите маленькие тесты и только после этого решайте, во что инвестировать обучение и время.</p><div class="note warn">Результат — навигатор для карьерного решения, а не окончательный вердикт. Для реального перехода отдельно проверяйте рынок вакансий и требования к входу.</div></div>`
}
document.getElementById('exportBtn').onclick=()=>{const b=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='career-navigator-answers.json';a.click()};document.getElementById('resetBtn').onclick=()=>{if(confirm('Удалить все ответы из этого браузера?')){localStorage.removeItem('careerNavigatorV1');location.reload()}};nav();renderPoints();renderRepeats();renderCriteria();bindStatic();calcProgress();