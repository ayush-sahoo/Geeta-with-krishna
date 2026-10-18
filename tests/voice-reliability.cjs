const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module');
const app=fs.readFileSync('app.js','utf8');
test('leaving Talk while the avatar loads never starts stale playback',async()=>{
  let release,played=0;const nodes={};
  const c=vm.createContext({talkGeneration:1,freshSession:async()=>{},authSession:{access_token:'x'},logEvent(){},SUPA:'',authHeaders:()=>({}),blobBase64:async()=>'',chatHistory:[],chatLanguage:'en',fetch:async()=>({ok:true,status:200,json:async()=>({heard:{text:'hello'},speech:{chunks:[],language:'en'},paragraphs:['hello']})}),setTalk(){},$:id=>nodes[id]??={replaceChildren(){}},appendText:()=>({}),renderReply(){},spokenLanguage:()=> 'en',spokenAnswer:()=> 'hello',keepVoice:()=>[],voiceQueue:()=>[],loadAvatar:()=>new Promise(r=>release=r),talkStage:null,KrishnaAvatar:{stage:()=>({speak:async()=>played++})},avatarAudio:{}});
  vm.runInContext(app.slice(app.indexOf('async function talkTurn('),app.indexOf('\nfunction replyText(')),c);
  const pending=c.talkTurn({type:'audio/webm'},1);while(!release)await new Promise(setImmediate);
  c.talkGeneration++;release();await pending;assert.equal(played,0);
});
test('quota rejects limits and database failures instead of spending credits',async()=>{
  const source=fs.readFileSync('supabase/functions/_shared/voice.ts','utf8');
  const code=stripTypeScriptTypes(source.slice(source.indexOf('export class VoiceQuotaError')).replace(/^export /gm,''));
  let result={data:true},args;const c=vm.createContext({adminClient:()=>({rpc:async(name,input)=>{args={name,input};return result;}})});vm.runInContext(code,c);
  await c.claimVoiceBudget('account',100);assert.equal(args.input.p_user_id,'account');assert.equal(args.input.p_units,100);
  result={data:false};await assert.rejects(c.claimVoiceBudget('account',100),e=>e.status===429);
  result={error:{message:'offline'}};await assert.rejects(c.claimVoiceBudget('account',100),e=>e.status===503);
});
test('offer screen entries count once per entry and again after leaving',()=>{
  const nodes={home:{classList:{contains:()=>false}},offerScreen:{classList:{contains:()=>active==='offerScreen'}}};let active='home',count=0;
  const c=vm.createContext({$:id=>nodes[id],APP_MODE:false,askMode:'chat',talkStage:null,window:{KrishnaAvatar:null,scrollTo(){}},document:{querySelectorAll:sel=>sel==='.screen'?[...Object.keys(nodes)].map(id=>({id,classList:{toggle:(cls,on)=>{if(on)active=id}}})):[]},trackMeta(){},logEvent:()=>count++,stopSpeech(){},talkCancel(){},hasLifetimeAccess:()=>false});nodes.offer={style:{}};nodes.homeNav={classList:{add(){}}};
  vm.runInContext(app.slice(app.indexOf('function showScreen('),app.indexOf('\nif(APP_MODE){')),c);
  c.showScreen('offerScreen');c.showScreen('offerScreen');assert.equal(count,1);c.showScreen('home');c.showScreen('offerScreen');assert.equal(count,2);
});
test('a failed later sentence stops playback and reports an incomplete reply',async()=>{
  const avatar=fs.readFileSync('krishna-avatar.js','utf8');let stopped=0;
  const c=vm.createContext({dead:false,speakGeneration:0,speech:null,ready:Promise.resolve(),active:false,raf:0,atob,Uint8Array,loudness:()=>({}),curves:()=>({}),mouthKeys:()=>[],stop(){if(c.speech)for(const g of c.speech.segs)g.source.stop();c.speech=null;}});
  vm.runInContext(avatar.slice(avatar.indexOf('async function speak('),avatar.indexOf('  function setActive(')),c);
  const ctx={resume:async()=>{},currentTime:0,decodeAudioData:async()=>({duration:1}),createBufferSource:()=>({connect(){},start(){},stop(){stopped++}})};
  const first={audio_base64:'AA==',alignment:{characters:[],character_start_times_seconds:[],character_end_times_seconds:[]}};
  await assert.rejects(c.speak([Promise.resolve(first),Promise.reject(Error('provider'))],{ctx,wordsBox:{replaceChildren(){},style:{}}}),/before the full reply finished/);assert.equal(stopped,1);
});
