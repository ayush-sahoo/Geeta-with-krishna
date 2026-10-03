// create-payment-link: on-site checkout orders (with the Gita Verse marker and
// the buyer's phone/email to prefill), the hosted-link fallback, and that
// retries reuse an unpaid checkout instead of creating another payable one.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module');
// Short timeouts so the lease wait and Razorpay timeout run quickly here.
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/create-payment-link/index.ts','utf8').replace(/^import .*;\n/gm,''))
  .replace('RAZORPAY_TIMEOUT_MS = 8000','RAZORPAY_TIMEOUT_MS = 50').replace('setTimeout(r, 1000)','setTimeout(r, 5)');
const ago=min=>new Date(Date.now()-min*60e3).toISOString();
function run(user,body,{open=[],lease=()=>true,linkStatus='created',slow=false}={}){
  let serve;const rz=[],inserts=[],rpcs=[];
  const query=table=>{const st={};const b={
    select:()=>b,eq:()=>b,order:()=>b,limit:()=>b,like:(k,v)=>{st.prefix=v.replace('%','');return b},
    single:async()=>({data:{plan_status:'free',payment_status:'unpaid'}}),
    insert:async row=>{inserts.push(row);return {error:null}},update:()=>({eq:async()=>({error:null})}),
    then:(res,rej)=>Promise.resolve({data:table==='payment_transactions'?open.filter(r=>r.payment_link_id.startsWith(st.prefix)):[],error:null}).then(res,rej)};return b;};
  const c=vm.createContext({Response,btoa,setTimeout,
    // A referenced timer, like Deno's (Node's AbortSignal.timeout lets the test process exit first).
    AbortSignal:{timeout:ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('timed out','TimeoutError')),ms);return c.signal;}},console:{log(){},error(){}},ANNUAL_PRICE_PAISE:100000,serviceKey:()=> 'service',
    Deno:{env:{get:k=>({SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'anon',RAZORPAY_KEY_ID:'rzp_live_key',RAZORPAY_KEY_SECRET:'secret'})[k]||''},serve:fn=>serve=fn},
    createClient:()=>({auth:{getUser:async()=>({data:{user},error:null})},from:query,rpc:async(name,args)=>{rpcs.push(name);return {data:name==='claim_checkout_lease'?lease():null,error:null};}}),
    fetch:(url,o)=>{const method=o.method||'GET';rz.push({url,method,body:o.body?JSON.parse(o.body):null});
      if(slow)return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason)));
      const out=method==='GET'?{id:url.split('/').pop(),status:linkStatus,short_url:'https://rzp.io/l/old'}:url.endsWith('/orders')?{id:'order_9',status:'created'}:{id:'plink_9',short_url:'https://rzp.io/l/9',status:'created'};
      return Promise.resolve(new Response(JSON.stringify(out),{status:200}));}});
  vm.runInContext(source,c);
  return serve(new Request('https://f',{method:'POST',headers:{Authorization:'Bearer t','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})).then(async r=>({status:r.status,json:await r.json(),rz,inserts,rpcs}));
}
const creates=r=>r.rz.filter(x=>x.method==='POST');
test('pop-up order carries the Gita Verse marker and prefills the phone',async()=>{
  const r=await run({id:'u-1',phone:'919876543210',email:''},{mode:'popup'});
  assert.equal(r.status,200);assert.equal(creates(r).length,1);assert.match(r.rz[0].url,/\/v1\/orders$/);
  assert.deepEqual(r.rz[0].body.notes,{user_id:'u-1',product:'gita_verse_annual',checkout:'popup'});
  assert.equal(r.rz[0].body.amount,100000);
  assert.equal(r.json.order_id,'order_9');assert.equal(r.json.key_id,'rzp_live_key');assert.deepEqual(r.json.prefill,{contact:'+919876543210'});
  assert.equal(r.inserts[0].payment_link_id,'order_9');assert.deepEqual(r.rpcs,['claim_checkout_lease','release_checkout_lease']);
});
test('email sign-ups get their email prefilled',async()=>{const r=await run({id:'u-2',email:'a@b.in'},{mode:'popup'});assert.deepEqual(r.json.prefill,{email:'a@b.in'});});
test('without the pop-up a hosted payment link is created as before',async()=>{for(const body of [{},undefined]){const r=await run({id:'u-3',email:'a@b.in'},body);assert.match(r.rz[0].url,/\/v1\/payment_links$/);assert.equal(r.json.short_url,'https://rzp.io/l/9');assert.equal(r.rz[0].body.notes.checkout,undefined);}});
test('a retry reuses the recent unpaid order instead of creating another',async()=>{
  const r=await run({id:'u-4',phone:'919876543210'},{mode:'popup'},{open:[{payment_link_id:'order_old',created_at:ago(5)}]});
  assert.equal(r.json.order_id,'order_old');assert.equal(creates(r).length,0);assert.equal(r.inserts.length,0);assert.deepEqual(r.json.prefill,{contact:'+919876543210'});
});
test('an old unpaid order is not reused',async()=>{const r=await run({id:'u-5'},{mode:'popup'},{open:[{payment_link_id:'order_old',created_at:ago(45)}]});assert.equal(r.json.order_id,'order_9');assert.equal(creates(r).length,1);});
test('a retry reuses the unpaid payment link only while Razorpay still accepts it',async()=>{
  let r=await run({id:'u-6'},{},{open:[{payment_link_id:'plink_old',created_at:ago(10)}]});
  assert.equal(r.json.short_url,'https://rzp.io/l/old');assert.equal(creates(r).length,0);
  for(const linkStatus of ['expired','paid','cancelled']){r=await run({id:'u-6'},{},{open:[{payment_link_id:'plink_old',created_at:ago(10)}],linkStatus});assert.equal(r.json.short_url,'https://rzp.io/l/9',linkStatus);assert.equal(creates(r).length,1);}
});
test('while another request is preparing a checkout, a retry waits and reuses it',async()=>{
  let calls=0;const r=await run({id:'u-7'},{mode:'popup'},{lease:()=>++calls>3,open:[{payment_link_id:'order_first',created_at:ago(0)}]});
  assert.equal(r.json.order_id,'order_first');assert.equal(creates(r).length,0);
});
test('if the lease stays busy and nothing can be reused, no second checkout is created',async()=>{
  const r=await run({id:'u-8'},{mode:'popup'},{lease:()=>false});
  assert.equal(r.status,409);assert.equal(creates(r).length,0);assert.ok(!r.rpcs.includes('release_checkout_lease'));
});
test('a Razorpay call that hangs times out and releases the lease',async()=>{
  const r=await run({id:'u-9'},{mode:'popup'},{slow:true});
  assert.equal(r.status,500);assert.equal(r.json.error,'Could not start payment. Please try again.');assert.equal(r.inserts.length,0);assert.equal(r.rpcs.at(-1),'release_checkout_lease');
});
