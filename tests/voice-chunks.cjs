// Talk to Krishna starts speaking after the first sentence is voiced, so the
// reply is split into pieces at sentence ends. The app (app.js) and the server
// (_shared/voice.ts) must split it the same way.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8'),server=fs.readFileSync('supabase/functions/_shared/voice.ts','utf8');
const speechChunks=new Function(app.slice(app.indexOf('function speechChunks('),app.indexOf('async function fetchVoice('))+'return speechChunks')();
const spokenAnswer=new Function(app.slice(app.indexOf('function spokenAnswer('),app.indexOf('// "Auto" replies'))+'return spokenAnswer')();
test('the first piece is one sentence once it has 40 letters',()=>{
  const c=speechChunks('मेरे प्रिय, मैं तुम्हारी इस दुविधा को भली-भांति समझ सकता हूँ। भविष्य के प्रति अनिश्चितता मन को विचलित कर देती है। याद रखो।');
  assert.equal(c[0],'मेरे प्रिय, मैं तुम्हारी इस दुविधा को भली-भांति समझ सकता हूँ।');
  assert.deepEqual(speechChunks('Hi. Dear one, I hear your worry about the exam tomorrow. Act fully!').map(x=>x.length),[56,10]);
});
test('later pieces stay under about 160 letters and keep every word',()=>{
  const text=Array.from({length:12},(_,i)=>`Sentence number ${i} carries a little meaning for the listener.`).join(' ');
  const c=speechChunks(text);
  assert.ok(c.slice(1).every(x=>x.length<=160));
  assert.equal(c.join(' '),text);
});
test('verse references are not read out',()=>{
  assert.equal(spokenAnswer({paragraphs:['Dear one (BG 2.47). Act now, BG 2.48 says.'],follow_up:'Why?'}),'Dear one. Act now, says. Why?');
});
test('app and server use the same splitting and reference rules',()=>{
  for(const part of['split(/(?<=[।॥.!?؟۔])\\s+/)','length+1+','>160','>=40','\\s*\\((?:BG \\d+\\.\\d+[,;\\s]*)+\\)'])
    assert.ok(app.includes(part)&&server.includes(part.replace('length+1+','length + 1 + ').replace('>160','> 160').replace('>=40','>= 40'))||server.includes(part),part);
});
