// meta-purchase-retry: only the scheduled job (vault token) may run it; it
// retries pending payments that are due, within Meta's window and attempt cap.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/meta-purchase-retry/index.ts','utf8').replace(/^import .*;\n/gm,''));
function run(token,{rows=[{payment_id:'pay_a'},{payment_id:'pay_b'}],outcomes={pay_a:'sent',pay_b:'failed'}}={}){
  let serve;const filters=[],delivered=[];
  const q={select:()=>q,eq:(k,v)=>{filters.push(['eq',k,v]);return q},is:(k,v)=>{filters.push(['is',k,v]);return q},not:(k,op,v)=>{filters.push(['not',k,v]);return q},
    gte:(k,v)=>{filters.push(['gte',k,v]);return q},lt:(k,v)=>{filters.push(['lt',k,v]);return q},or:v=>{filters.push(['or',v]);return q},order:()=>q,
    limit:async n=>{filters.push(['limit',n]);return {data:rows,error:null}}};
  const admin={rpc:async(n,a)=>({data:n==='meta_retry_token_ok'&&a.p_token==='right'}),from:()=>q};
  const c=vm.createContext({Response,Date,console:{error(){}},adminClient:()=>admin,META_MAX_ATTEMPTS:12,META_RETRY_WINDOW_MS:6*864e5,
    deliverMetaPurchase:async(a,id)=>{delivered.push(id);return outcomes[id]},Deno:{serve:fn=>serve=fn}});
  vm.runInContext(source,c);
  return serve(new Request('https://f',{method:'POST',headers:token?{'x-worker-token':token}:{}})).then(async r=>({status:r.status,json:await r.json(),filters,delivered}));
}
test('refuses callers without the scheduled job\'s token',async()=>{for(const t of [null,'wrong']){const r=await run(t);assert.equal(r.status,403);assert.equal(r.delivered.length,0);}});
test('retries due, unsent, recent payments under the attempt cap and reports the outcomes',async()=>{
  const r=await run('right');assert.equal(r.status,200);assert.deepEqual(r.delivered,['pay_a','pay_b']);assert.deepEqual(r.json,{checked:2,sent:1,failed:1});
  const f=JSON.stringify(r.filters);
  for(const want of ['["eq","status","paid"]','["is","meta_sent_at",null]','["lt","meta_attempts",12]','["limit",20]'])assert.ok(f.includes(want),want);
  const since=r.filters.find(x=>x[0]==='gte');assert.ok(Date.now()-Date.parse(since[2])>5.9*864e5);
  assert.match(r.filters.find(x=>x[0]==='or')[1],/^meta_next_try_at\.is\.null,meta_next_try_at\.lte\./);
});
