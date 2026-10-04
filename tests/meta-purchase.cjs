// Server-side Meta Purchase delivery (supabase/functions/_shared/meta.ts):
// sent once Meta accepts it, recorded per payment, retried with back-off.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module'),{webcrypto,createHash}=require('node:crypto');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/meta.ts','utf8')).replace(/^export /gm,'');
const sha=v=>createHash('sha256').update(v).digest('hex');
const paidRow=(o={})=>({id:7,user_id:'u-1',amount_paise:39900,paid_at:'2026-10-04T17:45:00Z',meta_sent_at:null,meta_attempts:0,
  raw_event:{payload:{order:{entity:{notes:{product:'gita_verse_quarterly',meta_ua:'Mozilla/5.0 Instagram',meta_fbp:'fb.1.1.2',meta_fbc:'fb.1.1.abc'}}}}},...o});
function load({row=paidRow(),token='tok',meta=()=>({status:200,body:{events_received:1}}),visitUa=''}={}){
  const updates=[],sent=[];
  const admin={from:table=>{const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,
      limit:async()=>({data:table==='site_events'?(visitUa?[{visitor_id:'v1'}]:[]):table==='site_visits'?[{user_agent:visitUa}]:[]}),
      maybeSingle:async()=>({data:table==='payment_transactions'?row:null}),
      update:fields=>{updates.push(fields);return q;},then:(res)=>res({error:null})};return q;},
    auth:{admin:{getUserById:async()=>({data:{user:{email:' Buyer@Example.com ',phone:'919876543210'}}})}}};
  const c=vm.createContext({crypto:webcrypto,TextEncoder,AbortSignal,Response,console:{error(){}},Date,Math,JSON,Number,String,
    Deno:{env:{get:k=>k==='META_CAPI_TOKEN'?token:''}},
    fetch:async(url,o)=>{sent.push({url,body:JSON.parse(o.body)});const m=meta();if(m.throws)throw new Error(m.throws);return new Response(JSON.stringify(m.body),{status:m.status});}});
  vm.runInContext(source+';this.deliver=deliverMetaPurchase;this.nextTryAt=nextTryAt;',c);
  return {deliver:id=>c.deliver(admin,id),nextTryAt:c.nextTryAt,updates,sent};
}
test('sends the Purchase with the pixel event id, payment time, hashed contacts and browser ids, and records it as sent',async()=>{
  const m=load();assert.equal(await m.deliver('pay_1'),'sent');
  assert.match(m.sent[0].url,/graph\.facebook\.com\/v21\.0\/2178415463100322\/events\?access_token=tok$/);
  const e=m.sent[0].body.data[0];
  assert.equal(e.event_id,'gita_purchase_pay_1');assert.equal(e.event_time,Date.parse('2026-10-04T17:45:00Z')/1000);
  assert.deepEqual(e.custom_data,{value:399,currency:'INR',content_name:'Gita Verse 3-Month Access',content_ids:['gita_quarterly'],content_type:'product',num_items:1});
  assert.equal(e.user_data.em[0],sha('buyer@example.com'));assert.equal(e.user_data.ph[0],sha('919876543210'));assert.equal(e.user_data.external_id[0],sha('u-1'));
  assert.equal(e.user_data.fbp,'fb.1.1.2');assert.equal(e.user_data.fbc,'fb.1.1.abc');
  assert.ok(m.updates[0].meta_sent_at);assert.equal(m.updates[0].meta_attempts,1);assert.equal(m.updates[0].meta_last_error,null);
});
test('already accepted or not paid: nothing is sent again',async()=>{
  for(const row of [paidRow({meta_sent_at:'2026-10-04T18:00:00Z'}),null]){const m=load({row});assert.equal(await m.deliver('pay_1'),'skipped');assert.equal(m.sent.length,0);}
});
test('without the token the payment stays pending for later',async()=>{const m=load({token:''});assert.equal(await m.deliver('pay_1'),'pending');assert.equal(m.sent.length,0);assert.equal(m.updates.length,0);});
test('a rejection, a timeout or a reply without events_received is recorded for a retry with back-off',async()=>{
  for(const meta of [()=>({status:400,body:{error:{message:'Invalid parameter'}}}),()=>({throws:'TimeoutError: signal timed out'}),()=>({status:200,body:{}})]){
    const m=load({meta,row:paidRow({meta_attempts:2})});assert.equal(await m.deliver('pay_1'),'failed');
    const u=m.updates[0];assert.equal(u.meta_sent_at,undefined);assert.equal(u.meta_attempts,3);assert.ok(u.meta_last_error.length>0);
    const wait=Date.parse(u.meta_next_try_at)-Date.now();assert.ok(wait>19*60e3&&wait<=20*60e3,String(wait));
  }
});
test('back-off doubles from 5 minutes and caps at 6 hours',()=>{
  const m=load(),t0=Date.UTC(2026,9,4);
  assert.deepEqual([1,2,3,10].map(a=>(Date.parse(m.nextTryAt(a,t0))-t0)/60e3),[5,10,20,360]);
});
test('an old ₹1,000 annual payment reports ₹1,000; a checkout without browser details uses the visit\'s browser',async()=>{
  const m=load({row:paidRow({amount_paise:100000,raw_event:{payload:{payment_link:{entity:{notes:{product:'gita_verse_annual'}}}}}}),visitUa:'Mozilla/5.0 (iPhone)'});
  assert.equal(await m.deliver('pay_2'),'sent');const e=m.sent[0].body.data[0];
  assert.equal(e.custom_data.value,1000);assert.deepEqual(e.custom_data.content_ids,['gita_annual']);assert.equal(e.user_data.client_user_agent,'Mozilla/5.0 (iPhone)');assert.equal(e.user_data.fbp,undefined);
});
test('no browser at all: recorded as a failure (retried in case a visit turns up), nothing sent',async()=>{
  const m=load({row:paidRow({raw_event:{}})});assert.equal(await m.deliver('pay_3'),'failed');assert.equal(m.sent.length,0);assert.match(m.updates[0].meta_last_error,/user agent/);
});
