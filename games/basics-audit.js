(function(root){
'use strict';
const endpoint='https://script.google.com/macros/s/AKfycbxENUBm5pd966tRn1g9R7HH0zSXcEI10LGLivzQzN0pn6b0ytZHJdV8HU9i0ihYtHJW/exec';
function shuffle(values){
  const result=[...values];
  for(let i=result.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}
function same(a,b){return !!b&&a.length===b.length&&a.every((x,i)=>x===b[i]);}
function patterned(sequence,position){
  const end=[...sequence.slice(-7),position];
  return [1,2,3,4].some(period=>{
    const n=period===1?3:period*2;
    const chunk=end.slice(-n);
    return chunk.length===n&&chunk.slice(period).every((x,i)=>x===chunk[i]);
  })||(end.length>=4&&[1,3].some(step=>end.slice(-4).every((x,i,a)=>x===(a[0]+i*step)%4)));
}
function positions(n){
  const letters=[0,1,2,3], remaining=letters.map(()=>Math.floor(n/4));
  shuffle(letters).slice(0,n%4).forEach(i=>remaining[i]++);
  const order=[];
  function fill(){
    if(order.length===n)return true;
    for(const slot of shuffle(letters)){
      if(!remaining[slot]||patterned(order,slot))continue;
      remaining[slot]--;order.push(slot);
      if(fill())return true;
      order.pop();remaining[slot]++;
    }
    return false;
  }
  fill();
  return order;
}
function plan(bank, proposedOrder, previous, reorder){
  let order=proposedOrder;
  while(same(order,previous?.order))order=reorder();
  const single=order.filter(i=>key(bank[i]).length===1);
  const multiple=order.filter(i=>key(bank[i]).length===2);
  const slots=positions(single.length);
  const pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  const pairCycle=shuffle(pairs);
  const balancedPairs=shuffle(multiple.map((_,i)=>pairCycle[i%6]));
  const answers=new Map(single.map((id,i)=>[id,[slots[i]]]));
  multiple.forEach((id,i)=>answers.set(id,balancedPairs[i]));
  const options={};
  for(const id of order){
    const q=bank[id], correct=key(q);
    if(!correct.length)continue;
    const targets=answers.get(id);
    let choices;
    do{
      const yes=shuffle(correct),no=shuffle([0,1,2,3].filter(i=>!correct.includes(i)));
      choices=[0,1,2,3].map(i=>targets.includes(i)?yes.pop():no.pop());
    }while(same(choices,previous?.options[id]));
    options[id]=choices;
  }
  return {order,options};
}
function key(q){return !q.options?[]:Array.isArray(q.answer)?q.answer:[q.answerIndex];}
function start(storageKey,bank,order,reorder){
  const name=storageKey+'_LAST_LAYOUT';
  let previous;
  try{previous=JSON.parse(localStorage.getItem(name));}catch{}
  const next=plan(bank,order,previous,reorder);
  try{localStorage.setItem(name,JSON.stringify(next));}catch{}
  return next;
}
let pending=Promise.resolve();
let draftTimer, latestDraft, draftInFlight=false, lastDraftSent=0;
const syncInterval=20000;
function assignmentKey(){return location.pathname.split('/').pop().replace(/\.html$/,'');}
function enqueue(state,record,complete){
  // Serialize snapshots so a draft cannot overwrite a completion in this browser.
  const snapshot=JSON.stringify(state);
  pending=pending.then(()=>post(JSON.parse(snapshot),record,complete));
  return pending;
}
function draft(state,bank){
  if(!state.name||!state.email||state.btbCompletedAt)return;
  const order=state.runOrder||state.qOrder||bank.map((_,index)=>index);
  const meta=state.questionStates||state.qmeta;
  const accepted={};
  let first=0, wrong=0, answered=0;
  meta.forEach((item,index)=>{
    const missCount=item.missCount??Number(Boolean(item.missed));
    wrong+=missCount;
    answered+=Number(Boolean(item.done||missCount));
    if(item.done){
      accepted[bank[order[index]].id]=true;
      if(item.firstTryCorrect??!item.missed)first++;
    }
  });
  wrong=state.runMisses??wrong;
  state.btbSavedAt=new Date().toISOString();
  latestDraft={state:JSON.stringify(state),record:{
    accepted,answerCount:answered,totalQuestions:bank.length,firstPassCorrect:first,
    totalAttempts:Object.keys(accepted).length+wrong,wrongAttempts:wrong,
    elapsedSeconds:Math.max(0,Math.floor((Date.now()-state.startedAtMS)/1000))
  }};
  scheduleDraft();
}
function scheduleDraft(){
  if(!latestDraft||draftInFlight||draftTimer!==undefined)return;
  const delay=Math.max(0,lastDraftSent+syncInterval-Date.now());
  draftTimer=setTimeout(()=>{
    draftTimer=undefined;
    lastDraftSent=Date.now();
    const work=latestDraft;
    latestDraft=undefined;
    if(work){
      draftInFlight=true;
      enqueue(JSON.parse(work.state),work.record,false).then(result=>{
        const label=document.getElementById('btbCloudStatus');
        if(label)label.textContent=result.ok?'Progress saved to spreadsheet.':'Progress saved on this device. Spreadsheet sync has not been confirmed.';
      }).finally(()=>{draftInFlight=false; scheduleDraft();});
    }
  },delay);
}
function send(state,record){
  clearTimeout(draftTimer);
  draftTimer=undefined;
  latestDraft=undefined;
  state.btbCompletedAt=record.endedAt;
  return enqueue(state,record,true);
}
async function retrieve(email){
  const url=new URL(endpoint);
  url.search=new URLSearchParams({action:'load',course:'Government',assignmentKey:assignmentKey(),email});
  try{
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(45000)});
    if(!response.ok)return {ok:false};
    const data=await response.json();
    if(data.ok&&!data.found)return {ok:true};
    const progress=data.payload?.basicsProgress;
    if(data.ok&&data.payload?.assignmentKey===assignmentKey()&&progress?.email===email)return {ok:true,progress};
  }catch{}
  return {ok:false};
}
async function post(state,record,complete){
  const name=state.name, period=state.period||'', email=state.email||'';
  if(!name||!email)return {ok:false};
  const id=record.gameId||assignmentKey();
  const total=record.totalQuestions,score=record.firstPassCorrect;
  const payload={...record,gameId:id,eventType:complete?'review_run_complete':'review_run_progress',course:'Government',
    assignmentKey:id,assignmentTitle:document.title,action:complete?'submit':'save',status:complete?'submitted':'in_progress',basicsProgress:state,
    student:{name,period,email},name,studentName:name,period,email,total,score,
    firstAttemptScore:score,percent:Math.round(100*score/total),
    startedAt:state.startedAtISO,completedAt:complete?record.endedAt:undefined,
    runId:id+'|'+state.startedAtISO,totalAttempts:record.totalAttempts,
    updatedAt:new Date().toISOString()};
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
    if(!response.ok)return {ok:false};
    const data=await response.json();
    return {ok:data.ok===true||data.success===true};
  }catch{return {ok:false};}
}
root.BasicsAudit={shuffle,plan,patterned,start,send,draft,retrieve,endpoint};
})(typeof window==='undefined'?globalThis:window);
