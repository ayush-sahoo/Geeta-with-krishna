import { chromium } from 'playwright';
const OUT = process.env.OUT_DIR || '.';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok=(c,m,d='')=>console.log((c?'PASS ':'FAIL ')+m+(c?'':' -> '+d));
const b=await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','content-type':'application/json'};
const now=Date.now(), iso=(ms)=>new Date(now-ms).toISOString();
const STATS={tracking_since:iso(3*36e5),funnel:{visitors:124,page_views:180,signin_start:14,signups:6,checkout:3,purchases:1,revenue_paise:100000},events:{signup:6},
 sources:[{source:'facebook',visitors:90,signups:5,paid:1},{source:'instagram app',visitors:20,signups:1,paid:0},{source:'direct',visitors:14,signups:0,paid:0}],
 campaigns:[{campaign:'Purchase campaign 28-09-26',ad:'reel-krishna-1',visitors:70,signups:4,paid:1},{campaign:'Purchase campaign 28-09-26',ad:'static-verse',visitors:20,signups:1,paid:0}],
 browsers:[{browser:'Instagram',visitors:80},{browser:'Facebook',visitors:20},{browser:'Android browser',visitors:24}],countries:[{country:'IN',visitors:120},{country:'US',visitors:4}],cities:[{city:'Lucknow',region:'UP',country:'IN',visitors:40},{city:'Austin',region:'Texas',country:'US',visitors:3}],
 timeline:[{t:iso(3*36e5),visitors:30},{t:iso(2*36e5),visitors:50},{t:iso(36e5),visitors:44}],
 users:[{id:'1',email:'priya@example.com',name:'Priya S',provider:'google',signed_up_at:iso(36e5),payment_status:'paid',access_expires_at:iso(-365*864e5),checkouts:1,signup_source:{utm_source:'facebook',utm_campaign:'Purchase campaign 28-09-26',utm_content:'reel-krishna-1',in_app:'Instagram',country:'IN',city:'Pune',region:'MH',device:'android'},is_test:false},
  {id:'2',email:'ravi@example.com',name:null,provider:'email',signed_up_at:iso(2*36e5),payment_status:'unpaid',checkouts:1,signup_source:{has_fbclid:true,in_app:'Facebook',country:'IN'},is_test:false},
  {id:'3',email:'me@test.in',name:'Owner',provider:'email',signed_up_at:iso(90*864e5),payment_status:'paid',access_expires_at:iso(-200*864e5),checkouts:2,signup_source:{device:'desktop',city:'New Delhi',region:'Delhi',country:'IN',backfilled:true},is_test:true},
  {id:'4',email:'<img src=x onerror=alert(1)>@x.in',name:'<b>xss</b>',provider:'email',signed_up_at:iso(5e6),payment_status:'unpaid',checkouts:0,signup_source:{utm_campaign:'<script>'},is_test:false}],
 generated_at:new Date().toISOString(),admin:'ayushsahoo2000@gmail.com'};
async function run(name,session,mode){
  const ctx=await b.newContext({viewport:{width:1280,height:1800},acceptDownloads:true});
  if(session)await ctx.addInitScript((s)=>localStorage.setItem('gitaAdminSession',JSON.stringify(s)),session);
  let calls=[];
  await ctx.route(/supabase\.co/,async r=>{const u=new URL(r.request().url());if(r.request().method()==='OPTIONS')return r.fulfill({status:200,headers:H});
    calls.push({p:u.pathname,auth:r.request().headers()['authorization'],body:r.request().postData()});
    if(u.pathname==='/auth/v1/token')return r.fulfill({headers:H,body:JSON.stringify({access_token:'fresh',refresh_token:'r2',user:{email:'ayushsahoo2000@gmail.com'}})});
    if(u.pathname==='/functions/v1/admin-stats'){
      const a=r.request().headers()['authorization'];
      if(mode==='expired'&&a==='Bearer old')return r.fulfill({status:401,headers:H,body:'{"error":"Invalid session"}'});
      if(mode==='notadmin')return r.fulfill({status:403,headers:H,body:'{"error":"This account is not an admin"}'});
      return r.fulfill({headers:H,body:JSON.stringify(STATS)});}
    return r.fulfill({headers:H,body:'{}'});});
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>{errs.push('dialog:'+d.message());d.dismiss()});
  await p.goto(BASE+'/admin.html'); await p.waitForTimeout(800);
  console.log('\n# '+name);
  return {ctx,p,errs,calls:()=>calls};
}
let t=await run('no session',null); ok(await t.p.isVisible('#gate')&&!(await t.p.isVisible('#app')),'signed-out visitor sees only the sign-in gate'); ok(!t.calls().some(c=>c.p.includes('admin-stats')),'no admin data requested without a session'); await t.ctx.close();
t=await run('not an admin',{access_token:'x',refresh_token:'r',user:{email:'someone@gmail.com'}},'notadmin'); ok((await t.p.textContent('#gateMsg')).includes("doesn't have admin access"),'non-admin account is refused'); ok(!(await t.p.isVisible('#app')),'no dashboard shown to non-admin'); await t.ctx.close();
t=await run('expired session',{access_token:'old',refresh_token:'r',user:{email:'ayushsahoo2000@gmail.com'}},'expired'); ok(await t.p.isVisible('#app'),'expired token refreshes automatically'); ok(t.calls().filter(c=>c.p.includes('admin-stats')).pop()?.auth==='Bearer fresh','retries with the refreshed token'); await t.ctx.close();
t=await run('admin',{access_token:'ok',refresh_token:'r',user:{email:'ayushsahoo2000@gmail.com'}},'ok');
const p=t.p;
ok((await p.textContent('#k-vis')).trim()==='124','visitors KPI'); ok((await p.textContent('#k-rev')).includes('1,000'),'revenue ₹1,000');
ok((await p.locator('#funnel .stage').count())===5,'5 funnel stages');
ok((await p.locator('#users tr').count())===4,'all 4 users listed');
ok((await p.textContent('#users')).includes('Purchase campaign 28-09-26 / reel-krishna-1'),'user shows the ad campaign + ad that brought them');
ok((await p.textContent('#users')).includes('Facebook/Instagram ad'),'fbclid-only user shows as Facebook/Instagram ad');
ok(await p.evaluate(()=>!document.querySelector('#users img, #users b b, #users script')),'user-supplied text is escaped (no HTML injection)');
await p.selectOption('#f','paid'); ok((await p.locator('#users tr').count())===2,'filter: paid');
await p.selectOption('#f','checkout'); ok((await p.locator('#users tr').count())===1,'filter: checkout but unpaid');
await p.selectOption('#f','real'); ok((await p.locator('#users tr').count())===3,'filter: hide test accounts');
await p.selectOption('#f','all'); await p.fill('#q','priya'); ok((await p.locator('#users tr').count())===1,'search by email');
await p.fill('#q','');
const dl=p.waitForEvent('download',{timeout:3000}).catch(()=>null); await p.click('#csv'); const d=await dl;
if(d){const fs=await import('node:fs');const path=await d.path();const csv=fs.readFileSync(path,'utf8');ok(csv.split('\n').length===5&&csv.includes('reel-krishna-1')&&csv.includes('Pune'),'CSV export has header + 4 users with city');}else ok(false,'CSV download');
ok((await p.locator('#campaigns tr').count())===2,'campaign table rows');
const utext=await p.textContent('#users');
ok(utext.includes('Pune, Maharashtra')&&utext.includes('Android'),'user location + device shown',utext);
ok(utext.includes('New Delhi, Delhi')&&utext.includes('from server logs'),'backfilled location labelled');
const ltext=await p.textContent('#countries'); ok(ltext.includes('Lucknow, Uttar Pradesh')&&ltext.includes('Austin, Texas (US)'),'Locations card lists cities',ltext);
ok((await p.textContent('#countryline')).includes('India 120'),'country summary line');
await p.click('#r-30d'); await p.waitForTimeout(400); const last=JSON.parse(t.calls().filter(c=>c.p.includes('admin-stats')).pop().body); ok(Date.now()-Date.parse(last.since)>29*864e5,'range switch sends new since date');
await p.screenshot({path:OUT+'/admin.png',fullPage:true});
ok(!t.errs.length,'no JS errors / dialogs',t.errs.join('|'));
await t.ctx.close();

// site tracking
console.log('\n# site tracking');
const ctx=await b.newContext({userAgent:'Mozilla/5.0 (Linux; Android 14; RMX3392; wv) AppleWebKit/537.36 Instagram 350.0'});
await ctx.addInitScript(()=>{window.fbq=function(){}});
const rpcs=[]; await ctx.route(/supabase\.co/,async r=>{const u=new URL(r.request().url());if(r.request().method()==='OPTIONS')return r.fulfill({status:200,headers:H});
  if(u.pathname.startsWith('/rest/v1/rpc/'))rpcs.push({fn:u.pathname.split('/').pop(),body:JSON.parse(r.request().postData()||'{}'),auth:r.request().headers()['authorization']});
  if(u.pathname==='/auth/v1/signup')return r.fulfill({headers:H,body:JSON.stringify({access_token:'t1',refresh_token:'r',user:{id:'n1',email:'a@b.in',created_at:new Date().toISOString()}})});
  if(u.pathname.endsWith('get-my-access'))return r.fulfill({headers:H,body:'{"access_active":false}'});
  return r.fulfill({headers:H,body:'[]'});});
await ctx.route(/facebook\.(com|net)|fonts\.g/,r=>r.fulfill({status:204,body:''}));
await ctx.route('**/api/geo',r=>r.fulfill({headers:H,body:JSON.stringify({country:'IN',region:'Uttar Pradesh',city:'Lucknow'})}));
const s=await ctx.newPage(); const serr=[]; s.on('pageerror',e=>serr.push(e.message));
await s.goto(BASE+'/?utm_source=facebook&utm_medium=paid&utm_campaign=launch&utm_content=reel1&fbclid=abc'); await s.waitForTimeout(500);
const v=rpcs.find(x=>x.fn==='log_visit');
ok(v&&v.body.p_utm_campaign==='launch'&&v.body.p_utm_content==='reel1'&&v.body.p_has_fbclid===true&&v.body.p_in_app==='Instagram'&&v.body.p_device==='android'&&v.body.p_city==='Lucknow'&&v.body.p_region==='Uttar Pradesh','visit logged with city, with UTM, fbclid, in-app and device',JSON.stringify(v&&v.body));
const vid=v&&v.body.p_visitor_id; ok(/^v_[a-z0-9]{8,}$/.test(vid||''),'anonymous visitor id created',vid);
await s.evaluate(()=>showScreen('authScreen')); await s.fill('#signupEmail','a@b.in'); await s.fill('#signupPassword','secret123'); await s.click('#passwordSignupBtn'); await s.waitForTimeout(600);
const ev=rpcs.filter(x=>x.fn==='log_event').map(x=>x.body.p_event);
ok(ev.includes('signin_start')&&ev.includes('signup'),'signin_start and signup events logged',ev.join(','));
const at=rpcs.find(x=>x.fn==='set_my_attribution'); ok(at&&at.body.p_visitor_id===vid&&at.auth==='Bearer t1','new account tagged with its visitor id (signed-in call)');
const intent=await s.evaluate(()=>chromeIntentUrl()); ok(intent.includes('vid='+vid),'Chrome hand-off carries the visitor id');
const s2=await (await b.newContext()).newPage(); await s2.route(/supabase\.co|facebook\.(com|net)|fonts\.g/,r=>r.fulfill({headers:H,body:'[]'}));
await s2.goto(BASE+'/?from=inapp&vid='+vid); await s2.waitForTimeout(300); ok(await s2.evaluate(()=>localStorage.getItem('gitaVisitorId'))===vid,'Chrome adopts the same visitor id (attribution kept)');
ok(!(await s2.evaluate(()=>location.search)),'vid removed from the URL');
ok(!serr.length,'no JS errors on site',serr.join('|'));
await b.close();
