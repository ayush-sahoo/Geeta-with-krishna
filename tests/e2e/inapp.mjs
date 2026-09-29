import { chromium } from 'playwright';
const OUT = process.env.OUT_DIR || '.';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const UAS={
  'ig-android':'Mozilla/5.0 (Linux; Android 14; RMX3392 Build/UKQ1.230924.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Instagram 350.0.0.43.97 Android (34/14; 480dpi; 1080x2400; realme; RMX3392; RE58B2L1; qcom; en_IN; 640234114)',
  'fb-iphone':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/485.0.0.36.107;FBBV/662880396;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBCR/;FBID/phone;FBLC/en_GB;FBOP/5]',
  'chrome':'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'};
const b=await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ok=(c,m,d='')=>console.log((c?'PASS ':'FAIL ')+m+(c?'':' -> '+d));
for (const [name,ua] of Object.entries(UAS)){
  console.log('\n# '+name);
  const ctx=await b.newContext({viewport:{width:390,height:844},userAgent:ua});
  const fb=[]; await ctx.exposeBinding('__rep',(_s,a)=>fb.push(a));
  await ctx.addInitScript(()=>{window.fbq=function(){try{window.__rep(JSON.parse(JSON.stringify([...arguments])))}catch(e){}}});
  const calls=[];
  await ctx.route(/supabase\.co/,r=>{const u=new URL(r.request().url());calls.push(u.pathname);
    const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','content-type':'application/json'};
    if(r.request().method()==='OPTIONS')return r.fulfill({status:200,headers:H});
    if(u.pathname==='/auth/v1/signup')return r.fulfill({headers:H,body:JSON.stringify({access_token:'t',refresh_token:'r',user:{id:'n1',email:'a@b.in',created_at:new Date().toISOString()}})});
    if(u.pathname.endsWith('get-my-access'))return r.fulfill({headers:H,body:JSON.stringify({plan_status:'free',payment_status:'unpaid',access_active:false})});
    return r.fulfill({headers:H,body:'[]'});});
  await ctx.route(/facebook|fonts\.g|accounts\.google/,r=>r.fulfill({status:204,body:''}));
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const navs=[]; p.on('request',r=>{if(r.isNavigationRequest())navs.push(r.url())});
  await p.goto(BASE+'/'); await p.waitForTimeout(300);
  await p.evaluate(()=>showScreen('authScreen')); await p.waitForTimeout(200);
  const note=await p.isVisible('#inAppNote');
  const order=await p.evaluate(()=>{const g=document.getElementById('googleLogin'),f=document.getElementById('passwordSignupStep');return g.compareDocumentPosition(f)&Node.DOCUMENT_POSITION_FOLLOWING?'google-first':'email-first'});
  const mode=await p.textContent('#authModeTitle');
  if(name==='chrome'){
    ok(!note,'no in-app note in a normal browser'); ok(order==='google-first','normal browser keeps Google first',order); ok(mode==='Login','normal browser default mode Login',mode);
    const nav=p.waitForRequest(r=>r.url().includes('/auth/v1/authorize'),{timeout:3000}).catch(()=>null);
    await p.click('#googleLogin'); ok(!!(await nav),'Google button goes to Google sign-in as before');
  } else {
    ok(note,'in-app note shown'); ok(order==='email-first','email sign-up shown above Google',order); ok(mode==='Sign up','defaults to Sign up for new in-app visitor',mode);
    ok((await p.textContent('#inAppTitle')).includes(name.startsWith('ig')?'Instagram':'Facebook'),'note names the right app',await p.textContent('#inAppTitle'));
    await p.screenshot({path:`${OUT}/${name}.png`});
    if(name==='ig-android'){
      ok(await p.isVisible('#openInChrome'),'Android shows Open in Chrome button');
      const intent=await p.evaluate(()=>chromeIntentUrl());
      ok(new RegExp('^intent://'+new URL(BASE).host.replace(/\./g,'\\.')+'/\\?from=inapp&vid=v_[a-z0-9]+#Intent;scheme=https;package=com\\.android\\.chrome;S\\.browser_fallback_url=').test(intent),'Chrome intent URL well-formed',intent);
      const r=p.waitForRequest(r=>r.url().startsWith('intent:'),{timeout:2000}).catch(()=>null);
      await p.click('#googleLogin').catch(()=>{}); await p.waitForTimeout(300);
      ok(fb.some(a=>a[1]==='GoogleBlockedInApp')&&fb.some(a=>a[1]==='OpenInBrowser'),'Google tap in Instagram → hands off to Chrome (tracked)');
      ok(!calls.includes('/auth/v1/authorize'),'does not start the Google flow inside Instagram');
    } else {
      ok(await p.isVisible('#iosTip'),'iPhone shows ••• → Open in external browser tip');
      await p.click('#googleLogin'); await p.waitForTimeout(200);
      ok((await p.textContent('#authPageError')).includes("doesn't work inside Facebook"),'Google tap on iPhone explains instead of failing');
      ok(!calls.includes('/auth/v1/authorize'),'does not start the Google flow inside Facebook');
      // email sign-up works in-app (confirm email off → token returned)
      await p.goto(BASE+'/'); await p.evaluate(()=>showScreen('authScreen'));
      await p.fill('#signupEmail','a@b.in'); await p.fill('#signupPassword','secret123'); await p.click('#passwordSignupBtn'); await p.waitForTimeout(500);
      const scr=await p.evaluate(()=>[...document.querySelectorAll('.screen')].find(s=>getComputedStyle(s).display!=='none')?.id);
      ok(scr==='accountScreen','email sign-up completes inside the in-app browser',scr);
      ok(fb.some(a=>a[1]==='CompleteRegistration'),'CompleteRegistration fires for in-app email sign-up');
    }
  }
  ok(!errs.length,'no JS errors',errs.join('|'));
  await ctx.close();
}
// Chrome hand-off landing
const ctx=await b.newContext({userAgent:UAS.chrome}); const fb=[]; await ctx.exposeBinding('__rep',(_s,a)=>fb.push(a));
await ctx.addInitScript(()=>{window.fbq=function(){try{window.__rep(JSON.parse(JSON.stringify([...arguments])))}catch(e){}}});
await ctx.route(/supabase\.co|facebook|fonts\.g/,r=>r.fulfill({headers:{'Access-Control-Allow-Origin':'*','content-type':'application/json'},body:'[]'}));
const p=await ctx.newPage(); await p.goto(BASE+'/?from=inapp'); await p.waitForTimeout(400);
console.log('\n# landing in Chrome');
ok(fb.some(a=>a[1]==='OpenedFromInApp'),'arrival from Instagram is tracked'); ok(!p.url().includes('from=inapp'),'from=inapp removed from URL');
await b.close();
