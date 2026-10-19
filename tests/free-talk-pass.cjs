// A free account's one Talk reply is voiced like a member's: tts-krishna voices
// the rest of the reply when it brings the pass that ask-krishna signed
// (_shared/voice.ts). The pass must only allow those sentences, for that
// account, until it expires, and must not be forgeable.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const server=fs.readFileSync('supabase/functions/_shared/voice.ts','utf8');
const code=server.slice(server.indexOf('const PASS_MINUTES')).replace(/export /g,'').replace(/: (Uint8Array|string\[\]|string|unknown)/g,'');
const make=key=>new Function('serviceKey',code+'return {freeTalkPass,freeTalkPassAllows}')(()=>key);
const {freeTalkPass,freeTalkPassAllows}=make('server-secret');
const lines=['जब परिणाम हमारे हाथ में नहीं होते, तो मन आशंकित हो जाता है।','आज एक छोटा कदम उठाओ।'];
test('the pass voices exactly the sentences of that reply, for that account',async()=>{
  const pass=await freeTalkPass('u1',lines);
  assert.equal(await freeTalkPassAllows(pass,'u1',lines[1]),true);
  assert.equal(await freeTalkPassAllows(pass,'u1','Any other text to voice for free.'),false);
  assert.equal(await freeTalkPassAllows(pass,'u2',lines[1]),false);
});
test('a changed or self-made pass is refused',async()=>{
  const pass=await freeTalkPass('u1',lines),[payload,sig]=pass.split('.');
  const other=Buffer.from(JSON.stringify({u:'u1',e:Date.now()+6e5,h:['x']})).toString('base64url');
  assert.equal(await freeTalkPassAllows(other+'.'+sig,'u1',lines[0]),false);
  assert.equal(await freeTalkPassAllows(payload+'.'+sig.slice(1),'u1',lines[0]),false);
  assert.equal(await freeTalkPassAllows(await make('another-key').freeTalkPass('u1',lines),'u1',lines[0]),false);
  for(const junk of [undefined,'',42,'a.b.c','x'.repeat(5000)])assert.equal(await freeTalkPassAllows(junk,'u1',lines[0]),false);
});
test('the pass expires after 10 minutes',async()=>{
  const now=Date.now,pass=await freeTalkPass('u1',lines);
  try{Date.now=()=>now()+11*60000;assert.equal(await freeTalkPassAllows(pass,'u1',lines[0]),false);}
  finally{Date.now=now;}
});
