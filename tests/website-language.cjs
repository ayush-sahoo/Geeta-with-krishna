const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('website-language.js','utf8');
test('stored translations load without calling the translation service',async()=>{const r=runtime(),calls=[],elements={appLanguage:{},websiteLanguageStatus:{}};Object.assign(r.c,{GITA_LANGUAGES:{hi:'Hindi'},$:id=>elements[id],localStorage:{setItem(){}},AbortSignal,fetch:async url=>{calls.push(url);return {ok:true,json:async()=>({translations:{Home:'होम'}})}}});await r.run("setWebsiteLanguage('hi')");assert.deepEqual(calls,['/locales/hi.json']);assert.equal(r.nodes[0].nodeValue,'होम');assert.equal(elements.appLanguage.disabled,false);});
test('missing static translations fall back to the translation service',async()=>{const r=runtime(),calls=[],elements={appLanguage:{},websiteLanguageStatus:{}};Object.assign(r.c,{GITA_LANGUAGES:{hi:'Hindi'},$:id=>elements[id],localStorage:{setItem(){}},AbortSignal,SUPA:'https://example.test',KEY:'public',fetch:async url=>{calls.push(url);return calls.length===1?{ok:false}:{ok:true,status:200,json:async()=>({translations:{Home:'होम'}})}}});await r.run("setWebsiteLanguage('hi')");assert.equal(calls.length,2);assert.match(calls[1],/website-language\?language=hi/);assert.equal(r.nodes[0].nodeValue,'होम');});
function runtime(){const nodes=[{nodeValue:'Home',parentElement:{closest:()=>null}},{nodeValue:'Private chat',parentElement:{closest:()=>true}}];const c=vm.createContext({document:{body:{},documentElement:{},createTreeWalker(){let i=0;return {nextNode:()=>nodes[i++]||null}},querySelectorAll:()=>[]},NodeFilter:{SHOW_TEXT:4},WeakMap});vm.runInContext(source,c);return {c,nodes,run:s=>vm.runInContext(s,c)};}
test('UI language translates interface and excludes chat content',()=>{const r=runtime();r.run("websiteLanguage='hi';websiteDictionary={Home:'होम','Private chat':'bad'};applyWebsiteLanguage()");assert.equal(r.nodes[0].nodeValue,'होम');assert.equal(r.nodes[1].nodeValue,'Private chat');});
test('switching languages uses original text and English restores it',()=>{const r=runtime();r.run("websiteLanguage='hi';websiteDictionary={Home:'होम'};applyWebsiteLanguage();websiteLanguage='ta';websiteDictionary={Home:'முகப்பு'};applyWebsiteLanguage()");assert.equal(r.nodes[0].nodeValue,'முகப்பு');r.run("websiteLanguage='en';applyWebsiteLanguage()");assert.equal(r.nodes[0].nodeValue,'Home');});
test('dynamic UI updates are translated from their new source',()=>{const r=runtime();r.run("websiteLanguage='hi';websiteDictionary={Home:'होम',Login:'लॉगिन'};applyWebsiteLanguage()");r.nodes[0].nodeValue='Login';r.run('applyWebsiteLanguage()');assert.equal(r.nodes[0].nodeValue,'लॉगिन');});
test('website preference never changes chat or verse language preferences',()=>{assert.doesNotMatch(source,/(?:chatLanguage|meaningLanguage)\s*=/);const app=fs.readFileSync('app.js','utf8');assert.doesNotMatch(app,/\[chatLanguage,meaningLanguage\]=v/);assert.match(app,/setupWebsiteLanguage\(\)/);});
// The plan choice is where people decide to pay, so every piece of its text
// (and the buy-button labels set from app.js) must be in the catalog and in
// each shipped locale; otherwise it stays English for non-English visitors.
test('offer screen and plan labels are translated in every shipped language',()=>{
  const catalog=new Set(JSON.parse(fs.readFileSync('supabase/functions/_shared/ui-strings.json','utf8')));
  const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('app.js','utf8');
  const offer=html.slice(html.indexOf('<section id="offerScreen"'),html.indexOf('<section id="accountScreen"'));
  const decode=s=>s.replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim();
  const strings=[...offer.matchAll(/>([^<>]+)</g)].map(m=>decode(m[1])).filter(s=>s&&!/^₹[\d,]+$/.test(s));
  strings.push(...[...offer.matchAll(/aria-label="([^"]+)"/g)].map(m=>m[1]));
  strings.push(...Object.values(eval('('+app.match(/const OFFER_PLANS=(\{[^}]+\})/)[1]+')')));
  strings.push(...[...app.matchAll(/showPaywall\((["'])(.+?)\1\)/g)].map(m=>m[2]));
  const bar=html.match(/<small id="offerKicker">([^<]+)<\/small><b id="offerTitle">([^<]+)<\/b><span id="offerText">([^<]+)<\/span><\/div><button id="buyLifetime"[^>]*>([^<]+)</);
  strings.push(...bar.slice(1),html.match(/id="accountUpgrade"[^>]*>([^<]+)<small class="btn-sub">([^<]+)</).slice(1).join('\n'));
  const wanted=[...new Set(strings.flatMap(s=>s.split('\n')))];
  assert.ok(wanted.length>25);
  assert.deepEqual(wanted.filter(s=>!catalog.has(s)),[],'missing from ui-strings.json');
  for(const file of fs.readdirSync('locales')){
    const t=JSON.parse(fs.readFileSync('locales/'+file,'utf8')).translations;
    assert.deepEqual(wanted.filter(s=>!t[s]),[],'missing from locales/'+file);
  }
});
