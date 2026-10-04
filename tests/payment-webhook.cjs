const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module'),{webcrypto,createHmac,createHash}=require('node:crypto');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/razorpay-webhook/index.ts','utf8').replace(/^import .*;\n/gm,''));
function handler(error=null,logFails=false){let serve,calls=0,last=null;const logged=[];const c=vm.createContext({Response,TextEncoder,crypto:webcrypto,PLANS:{annual:{paise:99900,product:'gita_verse_annual',description:'Gita Verse Annual Access',oldPaise:[100000]},quarterly:{paise:39900,product:'gita_verse_quarterly',description:'Gita Verse 3-Month Access'}},serviceKey:()=> 'mock',console:{error(){}},Deno:{env:{get:key=>key==='RAZORPAY_WEBHOOK_SECRET'?'test-secret':'mock'},serve:fn=>serve=fn},createClient:()=>({from:table=>({insert:async row=>{assert.equal(table,'payment_events');if(logFails)throw new Error('log down');logged.push(row);return {error:null};}}),rpc:async(name,args)=>{calls++;last=args;assert.equal(name,'apply_annual_payment');assert.equal(args.p_payment_id,'payment');return {data:{unlocked:'test-user'},error};}})});vm.runInContext(source,c);return {request:signature=>serve(new Request('https://test',{method:'POST',headers:{'x-razorpay-signature':signature},body:raw})),requestBody:(body,sig)=>serve(new Request('https://test',{method:'POST',headers:{'x-razorpay-signature':sig},body})),get calls(){return calls},get last(){return last},logged};}
const raw=JSON.stringify({event:'payment_link.paid',payload:{payment_link:{entity:{id:'link',status:'paid',notes:{user_id:'test-user'}}},payment:{entity:{id:'payment',status:'captured',amount:99900,currency:'INR'}}}}),signature=createHmac('sha256','test-secret').update(raw).digest('hex');
test('verified payment uses exactly one database transaction',async()=>{const h=handler();assert.equal((await h.request(signature)).status,200);assert.equal(h.calls,1);});
test('database failure stays retryable for payment provider',async()=>{const h=handler({message:'database unavailable'});assert.equal((await h.request(signature)).status,500);});
test('invalid webhook signature cannot apply a payment',async()=>{const h=handler();assert.equal((await h.request('invalid')).status,401);assert.equal(h.calls,0);});
const failedRaw=JSON.stringify({event:'payment.failed',payload:{payment:{entity:{id:'pay_f',order_id:'order_1',status:'failed',method:'upi',amount:100000,contact:'+919876543210',vpa:'someone@okbank',error_code:'BAD_REQUEST_ERROR',error_description:'Payment was unsuccessful as you could not complete it in time.',error_source:'customer',error_step:'payment_authentication',error_reason:'payment_timed_out',notes:{user_id:'test-user'}}}}}),failedSig=createHmac('sha256','test-secret').update(failedRaw).digest('hex');
test('failed payment attempt is recorded with its reason and no payment details',async()=>{const h=handler();const res=await h.requestBody(failedRaw,failedSig);assert.equal(res.status,200);assert.equal(h.calls,0);assert.equal(h.logged.length,1);const row=h.logged[0];assert.equal(row.event,'payment.failed');assert.equal(row.order_id,'order_1');assert.equal(row.error_reason,'payment_timed_out');assert.equal(row.method,'upi');assert.equal(row.contact_last4,'3210');assert.equal(row.user_id,'test-user');assert.ok(!JSON.stringify(row).includes('someone@okbank'));assert.ok(!JSON.stringify(row).includes('9876543210'));});
test('paid event is recorded and still unlocks access',async()=>{const h=handler();assert.equal((await h.request(signature)).status,200);assert.equal(h.calls,1);assert.equal(h.logged[0].event,'payment_link.paid');});
test('event logging failure never blocks a payment',async()=>{const h=handler(null,true);assert.equal((await h.request(signature)).status,200);assert.equal(h.calls,1);});
test('unsigned events are not recorded',async()=>{const h=handler();assert.equal((await h.request('invalid')).status,401);assert.equal(h.logged.length,0);});
// On-site checkout: order.paid unlocks only Gita Verse pop-up orders.
const sign=body=>createHmac('sha256','test-secret').update(body).digest('hex');
const orderEvent=(notes,amount=99900,status='paid')=>JSON.stringify({event:'order.paid',payload:{order:{entity:{id:'order_1',status,amount,amount_paid:amount,currency:'INR',notes}},payment:{entity:{id:'payment',order_id:'order_1',status:'captured',amount,currency:'INR',method:'upi'}}}});
const popupNotes={user_id:'test-user',product:'gita_verse_annual',checkout:'popup'};
test('pop-up checkout payment unlocks access against its order',async()=>{const h=handler();const body=orderEvent(popupNotes);const r=await h.requestBody(body,sign(body));assert.equal(r.status,200);assert.equal(h.calls,1);assert.equal(h.last.p_user_id,'test-user');assert.equal(h.last.p_payment_link_id,'order_1');assert.equal(h.last.p_amount_paise,99900);assert.equal(h.last.p_currency,'INR');});
test('order paid for another product on the same Razorpay account is ignored',async()=>{const h=handler();const body=orderEvent({},29900);const r=await h.requestBody(body,sign(body));assert.equal(r.status,200);assert.equal((await r.json()).ignored,true);assert.equal(h.calls,0);assert.equal(h.logged[0].event,'order.paid');});
test('order created by a payment link is not applied twice through order.paid',async()=>{const h=handler();const body=orderEvent({user_id:'test-user',product:'gita_verse_annual'});const r=await h.requestBody(body,sign(body));assert.equal((await r.json()).ignored,true);assert.equal(h.calls,0);});
test('pop-up order with the wrong amount or unpaid status is rejected',async()=>{for(const body of [orderEvent(popupNotes,50000),orderEvent(popupNotes,99900,'attempted')]){const h=handler();const r=await h.requestBody(body,sign(body));assert.equal(r.status,400);assert.equal(h.calls,0);}});
test('pop-up order summary is logged with the buyer and order',async()=>{const h=handler();const body=orderEvent(popupNotes);await h.requestBody(body,sign(body));assert.equal(h.logged[0].user_id,'test-user');assert.equal(h.logged[0].order_id,'order_1');});
const quarterNotes={user_id:'test-user',product:'gita_verse_quarterly',checkout:'popup'};
test('3-month plan: a ₹399 pop-up order unlocks access',async()=>{const h=handler();const body=orderEvent(quarterNotes,39900);const r=await h.requestBody(body,sign(body));assert.equal(r.status,200);assert.equal(h.calls,1);assert.equal(h.last.p_amount_paise,39900);});
test('3-month plan: the amount must match the plan bought',async()=>{for(const body of [orderEvent(quarterNotes,99900),orderEvent(popupNotes,39900)]){const h=handler();const r=await h.requestBody(body,sign(body));assert.equal(r.status,400);assert.equal(h.calls,0);}});
const linkEvent=(product,amount)=>JSON.stringify({event:'payment_link.paid',payload:{payment_link:{entity:{id:'link',status:'paid',notes:{user_id:'test-user',...(product?{product}:{})}}},payment:{entity:{id:'payment',status:'captured',amount,currency:'INR'}}}});
test('3-month plan: payment links are checked against their product too',async()=>{
  for(const [product,amount,status] of [['gita_verse_quarterly',39900,200],['gita_verse_quarterly',99900,400],['gita_verse_annual',39900,400],[null,39900,400],[null,99900,200],['other_product',39900,400]]){
    const h=handler();const body=linkEvent(product,amount);const r=await h.requestBody(body,sign(body));assert.equal(r.status,status,product+' '+amount);assert.equal(h.calls,status===200?1:0);}
});
test('annual price is ₹999; a ₹1,000 checkout opened before the change still unlocks a year',async()=>{
  for(const [amount,status] of [[99900,200],[100000,200],[50000,400]]){const h=handler();const body=orderEvent(popupNotes,amount);const r=await h.requestBody(body,sign(body));assert.equal(r.status,status,String(amount));}
  const h=handler();const body=orderEvent(quarterNotes,100000);assert.equal((await h.requestBody(body,sign(body))).status,400,'the old annual price never buys the 3-month plan');
});
// Server-side Purchase (Conversions API): sent once per new payment with the
// browser's event id, hashed contact details and the amount actually paid.
function capiHandler({token='capi-token',duplicate=false,metaFails=false}={}){
  let serve;const sent=[];
  const c=vm.createContext({Response,TextEncoder,crypto:webcrypto,AbortSignal,PLANS:{annual:{paise:99900,product:'gita_verse_annual',oldPaise:[100000]},quarterly:{paise:39900,product:'gita_verse_quarterly'}},serviceKey:()=> 'mock',console:{error(){}},
    fetch:async(url,o)=>{sent.push({url,body:JSON.parse(o.body)});if(metaFails)throw new Error('meta down');return new Response('{}',{status:200});},
    Deno:{env:{get:k=>k==='RAZORPAY_WEBHOOK_SECRET'?'test-secret':k==='META_CAPI_TOKEN'?token:'mock'},serve:fn=>serve=fn},
    createClient:()=>({from:()=>({insert:async()=>({error:null})}),rpc:async()=>({data:{unlocked:'test-user',duplicate},error:null}),
      auth:{admin:{getUserById:async()=>({data:{user:{email:' Buyer@Example.com ',phone:'919876543210'}}})}}})});
  vm.runInContext(source,c);return {req:body=>serve(new Request('https://test',{method:'POST',headers:{'x-razorpay-signature':sign(body)},body})),sent};
}
const capiNotes={...quarterNotes,meta_ua:'Mozilla/5.0 Instagram',meta_fbp:'fb.1.123.456',meta_fbc:'fb.1.123.AbC'};
test('Meta Purchase is also sent from the server, matching the pixel event',async()=>{
  const h=capiHandler();const r=await h.req(orderEvent(capiNotes,39900));
  assert.equal(r.status,200);assert.equal(h.sent.length,1);
  assert.match(h.sent[0].url,/graph\.facebook\.com\/v21\.0\/2178415463100322\/events\?access_token=capi-token$/);
  const e=h.sent[0].body.data[0];
  assert.equal(e.event_name,'Purchase');assert.equal(e.event_id,'gita_purchase_payment');assert.equal(e.action_source,'website');
  assert.deepEqual(e.custom_data,{value:399,currency:'INR',content_name:'Gita Verse 3-Month Access',content_ids:['gita_quarterly'],content_type:'product',num_items:1});
  assert.equal(e.user_data.em[0],createHash('sha256').update('buyer@example.com').digest('hex'));
  assert.equal(e.user_data.ph[0],createHash('sha256').update('919876543210').digest('hex'));
  assert.equal(e.user_data.fbp,'fb.1.123.456');assert.equal(e.user_data.fbc,'fb.1.123.AbC');assert.equal(e.user_data.client_user_agent,'Mozilla/5.0 Instagram');
});
test('server Purchase: an old ₹1,000 checkout reports ₹1,000, not today\'s price',async()=>{
  const h=capiHandler();await h.req(orderEvent({...capiNotes,product:'gita_verse_annual'},100000));
  assert.equal(h.sent[0].body.data[0].custom_data.value,1000);
});
test('server Purchase is skipped without a token, for a repeat delivery, or without browser details; a Meta error never fails the payment',async()=>{
  for(const [opts,notes] of [[{token:''},capiNotes],[{duplicate:true},capiNotes],[{},quarterNotes]]){const h=capiHandler(opts);const r=await h.req(orderEvent(notes,39900));assert.equal(r.status,200);assert.equal(h.sent.length,0);}
  const h=capiHandler({metaFails:true});const r=await h.req(orderEvent(capiNotes,39900));assert.equal(r.status,200);assert.equal(h.sent.length,1);
});
