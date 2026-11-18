(() => {
'use strict';
const $=id=>document.getElementById(id);
const deck=JSON.parse($('deck').textContent);
const storageKey='GOV_OST_30_V1:'+location.pathname;
const bank=deck.map(q=>({id:q.id}));
let state, advanceTimer, loading=false;
function read(key){
  try{return JSON.parse(localStorage.getItem(key));}catch{return null;}
}
function write(key,data){
  try{localStorage.setItem(key,JSON.stringify(data));}catch{}
}
const save=()=>{
  BasicsAudit.draft(state,bank);
  write(storageKey,state);
};
const permutation=n=>BasicsAudit.shuffle(Array.from({length:n},(_,i)=>i));
const same=(a,b)=>a?.length===b?.length&&a.every((x,i)=>x===b[i]);
function newLayout(previous){
  let order;
  do{order=permutation(deck.length);}while(same(order,previous?.order));
  const choices=deck.map((q,id)=>q.parts.map((p,j)=>{
    let result;
    do{result=permutation(p.choices.length);}while(same(result,previous?.choices[id]?.[j]));
    return result;
  }));
  return {order,choices};
}
function panels(active){
  for(const id of ['startScreen','gameArea','results'])$(id).hidden=id!==active;
}
const email=()=>$('sheetEmail').value.trim().toLowerCase();
function start(event){
  event.preventDefault();
  if(loading||!$('identity').reportValidity()||!$('studentName').value.trim())return;
  const now=Date.now(), layout=newLayout(read(storageKey+':layout'));
  write(storageKey+':layout',layout);
  open({version:1,name:$('studentName').value.trim(),email:email(),period:$('sheetPeriod').value,
    idx:0,startedAtMS:now,startedAtISO:new Date(now).toISOString(),qOrder:layout.order,
    choiceOrders:layout.choices,runMisses:0,qmeta:deck.map(()=>({done:false,missed:false,missCount:0}))});
}
function isPermutation(a,n){
  return Array.isArray(a)&&a.length===n&&new Set(a).size===n&&a.every(v=>Number.isInteger(v)&&v>=0&&v<n);
}
function valid(d){
  return d?.version===1&&Number.isInteger(d.idx)&&d.idx>=0&&d.idx<deck.length&&!d.btbCompletedAt&&
    isPermutation(d.qOrder,deck.length)&&Array.isArray(d.qmeta)&&d.qmeta.length===deck.length&&d.qmeta.every(Boolean)&&
    deck.every((q,i)=>q.parts.every((p,j)=>isPermutation(d.choiceOrders?.[i]?.[j],p.choices.length)));
}
function open(d){
  state=d;
  $('studentName').value=d.name;
  $('sheetEmail').value=d.email;
  $('sheetPeriod').value=d.period;
  write(storageKey+':layout',{order:d.qOrder,choices:d.choiceOrders});
  panels('gameArea');
  render();
  save();
}
async function retrieve(){
  if(loading)return;
  if(!$('sheetEmail').reportValidity())return;
  loading=true;
  $('startStatus').textContent='Looking for saved work…';
  const entered=email();
  try{
    const result=await BasicsAudit.retrieve(entered);
    const d=result.progress;
    if(result.ok&&d?.email===entered&&valid(d))open(d);
    else $('startStatus').textContent=result.ok?'No unfinished run was found.':'Could not confirm a spreadsheet save.';
  }finally{loading=false;}
}
function node(tag,text){
  const element=document.createElement(tag);
  if(text!==undefined)element.textContent=text;
  return element;
}
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
function render(){
  const id=state.qOrder[state.idx], q=deck[id], meta=state.qmeta[state.idx];
  const host=$('question');
  $('progress').textContent='Question '+(state.idx+1)+' of '+deck.length;
  $('feedback').textContent='';
  $('feedback').className='feedback';
  host.replaceChildren();
  if(q.reading){
    const box=node('div');box.className='source-box';
    if(q.readingTitle)box.append(node('h3',q.readingTitle));
    box.append(node('p',Array.isArray(q.reading)?q.reading.join(' '):q.reading));
    host.append(box);
  }
  host.append(node('h2',q.prompt));
  const getters=[];
  q.parts.forEach((p,j)=>{
    const field=node('fieldset');
    if(p.prompt)field.append(node('legend',p.prompt));
    const order=state.choiceOrders[id][j];
    if(p.mode==='sequence'){
      const picked=[], list=node('ol'), pool=node('div');pool.className='step-controls';
      const redraw=()=>{
        list.replaceChildren(...picked.map(i=>node('li',p.choices[i])));
        pool.replaceChildren(...order.filter(i=>!picked.includes(i)).map(i=>{
          const b=node('button',p.choices[i]);b.type='button';b.onclick=()=>{picked.push(i);redraw();checkResponse();};
          return b;
        }));
      };
      const undo=node('button','Undo last step');undo.type='button';undo.onclick=()=>{picked.pop();redraw();};
      field.append(list,pool,undo);redraw();
      getters.push(()=>picked.length===order.length?picked.slice():null);
    }else if(p.mode==='select'){
      const select=node('select');select.setAttribute('aria-label',p.prompt||q.prompt);
      const placeholder=node('option','Choose an answer');placeholder.value='';select.append(placeholder);
      order.forEach(i=>{const option=node('option',p.choices[i]);option.value=String(i);select.append(option);});
      select.onchange=checkResponse;
      field.append(select);getters.push(()=>select.value===''?null:[Number(select.value)]);
    }else{
      const inputs=order.map((i,position)=>{
        const label=node('label');label.className='choice';
        const input=node('input');input.type=p.mode==='multi'?'checkbox':'radio';input.name='part'+j;input.value=String(i);
        input.onchange=checkResponse;
        label.append(input,node('span',String.fromCharCode(65+position)+'. '+p.choices[i]));
        field.append(label);return input;
      });
      if(p.mode==='multi')field.append(node('p','Select '+p.keys.length+' answers.'));
      getters.push(()=>{
        const picked=inputs.filter(x=>x.checked).map(x=>Number(x.value)).sort((a,b)=>a-b);
        return picked.length===p.keys.length?picked:null;
      });
    }
    host.append(field);
  });
  function showCorrect(){
    host.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
    $('feedback').className='feedback good';
    $('feedback').textContent='Correct. '+q.explanation;
    $('feedback').scrollIntoView({block:'nearest'});
    clearTimeout(advanceTimer);
    advanceTimer=setTimeout(()=>{
      state.idx++;
      if(state.idx===deck.length)finish();
      else{render();save();}
    },4000);
  }
  function checkResponse(){
    if(meta.done)return;
    const responses=getters.map(readResponse=>readResponse());
    if(responses.some(r=>r===null))return;
    if(responses.every((r,j)=>equal(r,q.parts[j].mode==='sequence'?q.parts[j].keys:[...q.parts[j].keys].sort((a,b)=>a-b)))){
      meta.done=true;
      showCorrect();
    }else{
      meta.missed=true;meta.missCount++;state.runMisses++;
      render();
      $('feedback').className='feedback bad';
      $('feedback').textContent='Try again. '+q.hint;
      $('feedback').scrollIntoView({block:'nearest'});
    }
    save();
  }
  if(meta.done)showCorrect();
}
function finish(){
  const end=new Date();
  const perfect=state.runMisses===0&&state.qmeta.every(q=>q.done&&!q.missed);
  panels('results');
  $('certificate').hidden=!perfect;
  $('print').hidden=!perfect;
  $('resultMessage').textContent=perfect?'Certificate earned.':'Run complete. Restart for another chance to earn a perfect-run certificate.';
  $('certName').textContent=state.name;
  $('certStart').textContent='Started '+new Date(state.startedAtMS).toLocaleString();
  $('certEnd').textContent='Finished '+end.toLocaleString();
  $('finalStatus').textContent='Sending completion record…';
  BasicsAudit.send(state,{totalQuestions:deck.length,firstPassCorrect:state.qmeta.filter(q=>q.done&&!q.missed).length,
    totalAttempts:deck.length+state.runMisses,wrongAttempts:state.runMisses,answerCount:deck.length,
    finalMasteryAchieved:perfect,accepted:Object.fromEntries(bank.map(q=>[q.id,true])),endedAt:end.toISOString(),
    elapsedSeconds:Math.floor((end-state.startedAtMS)/1000)}).then(result=>{
    $('finalStatus').textContent=result.ok?'Completion record saved.':'Spreadsheet receipt could not be confirmed.';
  });
  write(storageKey,state);
}
function restart(){
  clearTimeout(advanceTimer);
  state=null;
  try{localStorage.removeItem(storageKey);}catch{}
  $('startStatus').textContent='';
  panels('startScreen');
  $('studentName').focus();
}
$('identity').onsubmit=start;
$('load').onclick=retrieve;
$('restart').onclick=$('replay').onclick=restart;
$('print').onclick=()=>{if(!$('certificate').hidden)window.print();};
const saved=read(storageKey);
if(valid(saved))open(saved);
})();
