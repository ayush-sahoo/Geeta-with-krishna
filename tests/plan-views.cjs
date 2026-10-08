const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('plan views count screen entry, not repeated renders or signup screens',()=>{
  const source=fs.readFileSync('app.js','utf8'),events=[];
  const screens=Object.fromEntries(['home','offerScreen','authScreen'].map(id=>[id,{id,classList:{active:false,contains(){return this.active},toggle(_,on){this.active=on}}}]));
  const c=vm.createContext({$:id=>id==='offer'?{style:{}}:screens[id],trackMeta(){},logEvent:e=>events.push(e),stopSpeech(){},hasLifetimeAccess:()=>false,window:{scrollTo(){}},document:{querySelectorAll:s=>s==='.screen'?Object.values(screens):[]}});
  vm.runInContext(source.slice(source.indexOf('function showScreen(id)'),source.indexOf('function openFreeQuestionSignup')),c);
  c.showScreen('offerScreen');c.showScreen('offerScreen');c.showScreen('authScreen');c.showScreen('offerScreen');c.showScreen('missing');
  assert.deepEqual(events,['plan_view','plan_view']);
});
