import { chromium } from 'playwright';
const OUT = process.env.OUT_DIR || '.';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok=(c,m,d='')=>console.log((c?'PASS ':'FAIL ')+m+(c?'':' -> '+d));
const b=await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','content-type':'application/json'};
const STATS={funnel:{visitors:5},users:[],sources:[],campaigns:[],browsers:[],countries:[],timeline:[],events:{},generated_at:new Date().toISOString(),admin:'ayush@edumorph.in'};
async function page(mainSession, mode){
  const ctx=await b.newContext(); const calls=[];
  if(mainSession) await ctx.addInitScript(s=>localStorage.setItem('gitaAuthSession',JSON.stringify(s)),mainSession);
  await ctx.route(/supabase\.co/,async r=>{const u=new URL(r.request().url()); if(r.request().method()==='OPTIONS')return r.fulfill({status:200,headers:H});
    const body=r.request().postData(); calls.push({p:u.pathname,q:u.search,auth:r.request().headers()['authorization'],body});
    if(u.pathname==='/auth/v1/token'){const j=JSON.parse(body||'{}');
      if(j.password!=='right')return r.fulfill({status:400,headers:H,body:'{"error":"invalid_grant"}'});
      return r.fulfill({headers:H,body:JSON.stringify({access_token:j.email==='ayush@edumorph.in'?'admintok':'usertok',refresh_token:'r',user:{email:j.email}})});}
    if(u.pathname==='/functions/v1/admin-stats'){const a=r.request().headers()['authorization'];
      if(a==='Bearer admintok')return r.fulfill({headers:H,body:JSON.stringify(STATS)});
      return r.fulfill({status:403,headers:H,body:'{"error":"This account is not an admin"}'});}
    return r.fulfill({headers:H,body:'{}'});});
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE+'/admin.html'); await p.waitForTimeout(500);
  return {ctx,p,errs,calls};
}
let {ctx,p,errs,calls}=await page({access_token:'mainsite',refresh_token:'r',user:{email:'ayush@edumorph.in'}});
ok(await p.isVisible('#loginForm')&&!(await p.isVisible('#app')),'login form shown even when signed in on main site');
ok(!calls.some(c=>c.p.includes('admin-stats')),'main-site session is not used');
await p.fill('#loginEmail','ayush@edumorph.in'); await p.fill('#loginPassword','wrong'); await p.click('#loginBtn'); await p.waitForTimeout(300);
ok((await p.textContent('#gateMsg')).includes('Wrong email or password'),'wrong password rejected');
await p.fill('#loginPassword','right'); await p.press('#loginPassword','Enter'); await p.waitForTimeout(500);
ok(await p.isVisible('#app')&&!(await p.isVisible('#gate')),'admin signs in and sees dashboard');
ok(calls.find(c=>c.p==='/auth/v1/token')?.q.includes('grant_type=password'),'uses password grant');
ok(JSON.parse(await p.evaluate(()=>localStorage.getItem('gitaAdminSession'))).access_token==='admintok','separate admin session stored');
ok(JSON.parse(await p.evaluate(()=>localStorage.getItem('gitaAuthSession'))).access_token==='mainsite','main-site session untouched');
ok(await p.inputValue('#loginPassword')==='','password field cleared');
await p.reload(); await p.waitForTimeout(500); ok(await p.isVisible('#app'),'admin session survives reload');
await p.click('#signout'); await p.waitForTimeout(300);
ok(await p.isVisible('#loginForm')&&(await p.textContent('#gateMsg')).includes('Signed out'),'sign out returns to login');
ok(await p.evaluate(()=>localStorage.getItem('gitaAdminSession'))===null,'admin session cleared');
ok(calls.some(c=>c.p==='/auth/v1/logout'&&c.auth==='Bearer admintok'),'server-side logout called');
ok(JSON.parse(await p.evaluate(()=>localStorage.getItem('gitaAuthSession'))).access_token==='mainsite','main-site session still untouched after sign out');
await p.fill('#loginEmail','someone@gmail.com'); await p.fill('#loginPassword','right'); await p.click('#loginBtn'); await p.waitForTimeout(500);
ok((await p.textContent('#gateMsg')).includes("doesn't have admin access")&&!(await p.isVisible('#app')),'non-admin account refused');
ok(await p.evaluate(()=>localStorage.getItem('gitaAdminSession'))===null,'non-admin session not kept');
await p.fill('#loginEmail',''); await p.fill('#loginPassword',''); await p.click('#loginBtn'); await p.waitForTimeout(100);
ok((await p.textContent('#gateMsg')).includes('Enter your admin email'),'empty form prompts');
await p.setViewportSize({width:375,height:700}); await p.screenshot({path:OUT+'/login.png'});
ok(!errs.length,'no JS errors',errs.join('|'));
await b.close();
