import { chromium } from 'playwright';
const OUT = process.env.OUT_DIR || '.';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok=(c,m,d='')=>console.log((c?'PASS ':'FAIL ')+m+(c?'':' -> '+d));
const b=await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','content-type':'application/json'};
const now=Date.now(), iso=(ms)=>new Date(now-ms).toISOString();
const STATS={tracking_since:iso(3*36e5),funnel:{visitors:124,page_views:180,signin_start:14,signups:6,checkout:3,purchases:1,revenue_paise:100000},events:{signup:6,paywall_view:30,plan_view:12,plan_monthly:9,checkout_click:7,checkout_monthly:4,checkout_open:6,checkout_dismiss:4,checkout_payment_failed:2},
 sources:[{source:'facebook',visitors:90,signups:5,paid:1},{source:'instagram app',visitors:20,signups:1,paid:0},{source:'direct',visitors:14,signups:0,paid:0}],
 campaigns:[{campaign:'Purchase campaign 28-09-26',ad:'reel-krishna-1',visitors:70,signups:4,paid:1},{campaign:'Purchase campaign 28-09-26',ad:'static-verse',visitors:20,signups:1,paid:0}],
 browsers:[{browser:'Instagram',visitors:80},{browser:'Facebook',visitors:20},{browser:'Android browser',visitors:24}],countries:[{country:'IN',visitors:120},{country:'US',visitors:4}],cities:[{city:'Lucknow',region:'UP',country:'IN',visitors:40},{city:'Austin',region:'Texas',country:'US',visitors:3}],
 timeline:[{t:iso(3*36e5),visitors:30},{t:iso(2*36e5),visitors:50},{t:iso(36e5),visitors:44}],
 users:[{id:'1',email:'priya@example.com',name:'Priya S',provider:'google',signed_up_at:iso(36e5),payment_status:'paid',access_expires_at:iso(-365*864e5),checkouts:1,signup_source:{utm_source:'facebook',utm_campaign:'Purchase campaign 28-09-26',utm_content:'reel-krishna-1',in_app:'Instagram',country:'IN',city:'Pune',region:'MH',device:'android'},is_test:false},
  {id:'2',email:null,phone:'917076131555',name:null,provider:'phone',signed_up_at:iso(2*36e5),payment_status:'unpaid',checkouts:1,signup_source:{has_fbclid:true,in_app:'Facebook',country:'IN'},is_test:false},
  {id:'3',email:'me@test.in',name:'Owner',provider:'email',signed_up_at:iso(90*864e5),payment_status:'paid',access_expires_at:iso(-200*864e5),checkouts:2,signup_source:{device:'desktop',city:'New Delhi',region:'Delhi',country:'IN',backfilled:true},is_test:true},
  {id:'4',email:'<img src=x onerror=alert(1)>@x.in',name:'<b>xss</b>',provider:'email',signed_up_at:iso(5e6),payment_status:'unpaid',checkouts:0,signup_source:{utm_campaign:'<script>'},is_test:false}],
 engagement:{asked:12,questions:19,opened_verse:7,played:2,groups:{all:{people:40,median_s:95,avg_s:140,over_1m:22,over_3m:8},asked:{people:10,median_s:260,avg_s:300,over_1m:9,over_3m:6},opened_verse:{people:6,median_s:200,avg_s:210,over_1m:5,over_3m:3},played:{people:2,median_s:400,avg_s:420,over_1m:2,over_3m:2},neither:{people:25,median_s:30,avg_s:45,over_1m:5,over_3m:1}}},
 sessions_since:iso(2*36e5),
 engaged:[{visitor_id:'v_a',last_at:iso(6e5),asked:3,opened_verse:true,played:true,seconds:425,sessions:2,source:'facebook (ad click)',campaign:'launch',place:{city:'Pune',region:'MH',country:'IN',device:'android'},email:null,phone:'919812345678',payment_status:'unpaid',signed_up:true},
  {visitor_id:'v_b',last_at:iso(9e5),asked:1,opened_verse:false,played:false,seconds:null,sessions:null,stay15:true,stay45:false,source:'instagram app',campaign:'(none)',place:{city:'Lucknow',region:'UP',country:'IN',device:'android'},signed_up:false},
  {visitor_id:'v_c',last_at:iso(12e5),asked:0,opened_verse:true,played:false,seconds:61,sessions:1,source:null,place:null,email:'<img src=x onerror=alert(2)>',signed_up:true}],
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
ok((await p.locator('#users tr', { hasText: '+91 70761 31555' }).count())===1,'mobile sign-up shows its number (+91 70761 31555)');
await p.fill('#q','70761'); ok((await p.locator('#users tr').count())===1,'search by mobile number');
await p.fill('#q','+91 70761 31555'); ok((await p.locator('#users tr').count())===1,'search by formatted mobile number');
await p.fill('#q','');
await p.fill('#q','');
const dl=p.waitForEvent('download',{timeout:3000}).catch(()=>null); await p.click('#csv'); const d=await dl;
if(d){const fs=await import('node:fs');const path=await d.path();const csv=fs.readFileSync(path,'utf8');ok(csv.split('\n').length===5&&csv.includes('reel-krishna-1')&&csv.includes('Pune')&&csv.startsWith('email,phone,name')&&csv.includes(',+91 70761 31555,'),'CSV export has header + 4 users with city and a phone column');}else ok(false,'CSV download');
ok((await p.locator('#campaigns tr').count())===2,'campaign table rows');
const utext=await p.textContent('#users');
ok(utext.includes('Pune, Maharashtra')&&utext.includes('Android'),'user location + device shown',utext);
ok(utext.includes('New Delhi, Delhi')&&utext.includes('from server logs'),'backfilled location labelled');
const ltext=await p.textContent('#countries'); ok(ltext.includes('Lucknow, Uttar Pradesh')&&ltext.includes('Austin, Texas (US)'),'Locations card lists cities',ltext);
ok((await p.textContent('#countryline')).includes('India 120'),'country summary line');
const ctext=await p.textContent('#checkoutSteps');
ok((await p.locator('#checkoutSteps .hbar').count())===13&&/Tapped 1 month[^0-9]*9/.test(ctext)&&/Closed without paying[^0-9]*4/.test(ctext)&&/A payment attempt failed[^0-9]*2/.test(ctext),'checkout steps card: plan taps, window opened/closed, failed attempts',ctext);
ok((await p.textContent('#e-asked')).trim()==='12'&&(await p.textContent('#e-questions')).includes('19 questions')&&(await p.textContent('#e-played')).trim()==='2'&&(await p.textContent('#e-median')).trim()==='1m 35s','engagement tiles: tried chat, played shloka, median time on site');
const gtext=await p.textContent('#eng-groups');
ok((await p.locator('#eng-groups tr').count())===5&&gtext.includes('Tried the free chat')&&gtext.includes('4m 20s')&&gtext.includes('6 · 60%'),'time on site by group (median, 3 min+ share)',gtext);
ok((await p.locator('#engaged tr').count())===3,'people who tried chat or a shloka are listed');
const etext=await p.textContent('#engaged');
ok(etext.includes('+91 98123 45678')&&etext.includes('7m 05s')&&etext.includes('2 visits')&&etext.includes('Played'),'person row: contact, time on site, visits, played',etext);
ok(etext.includes('15s+ (before timing)')&&etext.includes('Anonymous visitor'),'older visit shows the 15s/45s estimate');
ok(await p.evaluate(()=>!document.querySelector('#engaged img')),'engaged list escapes user text');
await p.selectOption('#ef','asked'); ok((await p.locator('#engaged tr').count())===2,'filter: tried the free chat');
await p.selectOption('#ef','played'); ok((await p.locator('#engaged tr').count())===1,'filter: played a shloka');
await p.selectOption('#ef','all');
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
// Engagement taps are logged once each, only to our own database.
{ await s.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight)); await s.waitForTimeout(150);
  await s.evaluate(()=>window.scrollTo(0,0));
  await s.click('#heroAsk'); await s.waitForTimeout(200); await s.evaluate(()=>showScreen('home')); await s.click('#heroAsk'); await s.waitForTimeout(200);
  await s.click('.prompt'); await s.fill('#askInput','Mujhe'); await s.type('#askInput',' chinta'); await s.waitForTimeout(200);
  const ev=rpcs.filter(x=>x.fn==='log_event').map(x=>x.body.p_event);
  const once=(n)=>ev.filter(e=>e===n).length===1;
  ok(once('tap_hero_ask')&&once('tap_prompt')&&once('ask_typing')&&once('scroll_half')&&once('scroll_end'),'engagement taps, typing and scroll depth logged once each',ev.join(',')); }
// Trying a verse (free users see the plans) and the play button are logged;
// time on site is reported with a per-page-load session id.
{ await s.evaluate(()=>openVerse(2,47)); await s.waitForTimeout(150); await s.evaluate(()=>{speak();speak();}); await s.waitForTimeout(150);
  const ev=rpcs.filter(x=>x.fn==='log_event').map(x=>x.body.p_event);
  ok(ev.filter(e=>e==='open_verse').length===1&&ev.filter(e=>e==='play_verse').length===1,'open_verse and play_verse logged once each',ev.join(','));
  await s.evaluate(()=>{visibleMs=37000;reportSession(false);reportSession(false);}); await s.waitForTimeout(150);
  const ss=rpcs.filter(x=>x.fn==='log_session');
  ok(ss.length===1&&ss[0].body.p_seconds===37&&/^s_[a-z0-9]{8,}$/.test(ss[0].body.p_session_id)&&/^v_/.test(ss[0].body.p_visitor_id),'time on site reported once per change, with session and visitor ids',JSON.stringify(ss)); }
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
