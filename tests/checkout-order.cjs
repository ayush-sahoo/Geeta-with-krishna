// create-payment-link: on-site checkout orders (with the Gita Verse marker and
// the buyer's phone/email to prefill) and the hosted-link fallback.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/create-payment-link/index.ts','utf8').replace(/^import .*;\n/gm,''));
function run(user,body){
  let serve;const rz=[],inserts=[];
  const chain={select:()=>chain,eq:()=>chain,single:async()=>({data:{plan_status:'free',payment_status:'unpaid'}}),insert:async row=>{inserts.push(row);return {error:null}},update:()=>({eq:async()=>({error:null})})};
  const c=vm.createContext({Response,btoa,console:{log(){},error(){}},ANNUAL_PRICE_PAISE:100000,serviceKey:()=> 'service',
    Deno:{env:{get:k=>({SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'anon',RAZORPAY_KEY_ID:'rzp_live_key',RAZORPAY_KEY_SECRET:'secret'})[k]||''},serve:fn=>serve=fn},
    createClient:()=>({auth:{getUser:async()=>({data:{user},error:null})},from:()=>chain}),
    fetch:async(url,o)=>{rz.push({url,body:JSON.parse(o.body)});return new Response(JSON.stringify(url.endsWith('/orders')?{id:'order_9',status:'created'}:{id:'plink_9',short_url:'https://rzp.io/l/9',status:'created'}),{status:200});}});
  vm.runInContext(source,c);
  return serve(new Request('https://f',{method:'POST',headers:{Authorization:'Bearer t','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})).then(async r=>({status:r.status,json:await r.json(),rz,inserts}));
}
test('pop-up order carries the Gita Verse marker and prefills the phone',async()=>{
  const r=await run({id:'u-1',phone:'919876543210',email:''},{mode:'popup'});
  assert.equal(r.status,200);assert.equal(r.rz.length,1);assert.match(r.rz[0].url,/\/v1\/orders$/);
  assert.deepEqual(r.rz[0].body.notes,{user_id:'u-1',product:'gita_verse_annual',checkout:'popup'});
  assert.equal(r.rz[0].body.amount,100000);
  assert.equal(r.json.order_id,'order_9');assert.equal(r.json.key_id,'rzp_live_key');assert.deepEqual(r.json.prefill,{contact:'+919876543210'});
  assert.equal(r.inserts[0].payment_link_id,'order_9');
});
test('email sign-ups get their email prefilled',async()=>{const r=await run({id:'u-2',email:'a@b.in'},{mode:'popup'});assert.deepEqual(r.json.prefill,{email:'a@b.in'});});
test('without the pop-up a hosted payment link is created as before',async()=>{for(const body of [{},undefined]){const r=await run({id:'u-3',email:'a@b.in'},body);assert.match(r.rz[0].url,/\/v1\/payment_links$/);assert.equal(r.json.short_url,'https://rzp.io/l/9');assert.equal(r.rz[0].body.notes.checkout,undefined);}});
