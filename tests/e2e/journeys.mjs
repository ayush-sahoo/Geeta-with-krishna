// End-to-end run of every user journey against a simulated backend.
import { chromium } from 'playwright';
const OUT = process.env.OUT_DIR || '.';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';

const results = [];
const check = (ok, name, detail = '') => { results.push({ ok, name }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  -> ' + detail : '')); };

// ---- simulated backend state ----
const S = { paid: false, paidAfterPolls: 0, polls: 0, createdAt: new Date().toISOString(), calls: [] };
const V = (c, v, t) => ({ id: c * 1000 + v, chapter_id: c, verse_number: v, sanskrit: `श्लोक ${c}.${v} |\nद्वितीय पंक्ति ||${c}-${v}||`, transliteration: `shloka ${c}.${v}`, translation_english: `${c}.${v} ${t}` });
const DAILY = V(12, 19, 'Who is indifferent to praise and censure, who enjoys silence, who is contented with every fate.');
const user = () => ({ id: 'u1', email: 'test@example.com', created_at: S.createdAt, app_metadata: { provider: 'email' } });
const session = () => ({ access_token: 'tok_u1', refresh_token: 'ref_u1', token_type: 'bearer', expires_in: 3600, user: user() });
const account = () => S.paid
  ? { email: 'test@example.com', plan_status: 'annual', payment_status: 'paid', payment_provider: 'razorpay', payment_id: 'pay_TEST1', amount_paid_paise: 99900, purchased_at: new Date().toISOString(), access_expires_at: new Date(Date.now() + 365 * 864e5).toISOString(), access_active: true, user_id: 'u1' }
  : { email: 'test@example.com', plan_status: 'free', payment_status: 'unpaid', access_active: false, free_question_available: !S.freeUsed, user_id: 'u1' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

async function backend(route) {
  const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
  const auth = req.headers()['authorization'] || '';
  S.calls.push({ m, p, q: url.search, auth, body: req.postData() });
  const json = (body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const authed = auth === 'Bearer tok_u1';

  if (p === '/rest/v1/rpc/get_daily_verse') return json([DAILY]);
  if (p === '/auth/v1/signup') return json(session());
  if (p === '/auth/v1/token') return json(session());
  if (p === '/auth/v1/user') return authed ? json(user()) : json({ msg: 'bad jwt' }, 401);
  if (p === '/auth/v1/logout') return json({});
  if (p === '/functions/v1/get-my-access') {
    if (!authed) return json({ error: 'Sign in required' }, 401);
    S.polls++; if (S.paidAfterPolls && S.polls >= S.paidAfterPolls) S.paid = true;
    return json(account());
  }
  if (p === '/functions/v1/create-payment-link') {
    if (!authed) return json({ error: 'Sign in required' }, 401);
    if (S.linkDelay) await new Promise(r => setTimeout(r, S.linkDelay)); // Razorpay can take seconds
    return json({ id: 'plink_T', short_url: 'https://rzp.io/l/test' });
  }
  if (p === '/rest/v1/gita_verses') {
    const ch = Number((url.searchParams.get('chapter_id') || '').replace('eq.', ''));
    return json(Array.from({ length: 20 }, (_, i) => V(ch, i + 1, `translation of ${ch}.${i + 1}`)));
  }
  if (p === '/functions/v1/ask-krishna') {
    if (!authed) {
      // One answer before sign-up, per visitor id (the server enforces it).
      const vid = JSON.parse(req.postData() || '{}').visitor_id;
      if (!vid) return json({ error: 'Sign in required' }, 401);
      S.anonAsked = S.anonAsked || new Set();
      if (S.anonAsked.has(vid)) return json({ error: 'Sign up free to ask Krishna', signup: true, reason: 'used' }, 403);
      S.anonAsked.add(vid);
      return json({ anon_free: true, style: 'krishna_inspired', title: 'Be steady', paragraphs: ['Dear one, I hear your worry.'], actions: [], follow_up: '', verses: [] });
    }
    let free = false;
    if (!S.paid) { if (S.freeUsed) return json({ error: 'Annual Access required', paywall: true }, 403); S.freeUsed = true; free = true; }
    return json({ ...(free ? { free_question: true } : {}), style: 'krishna_inspired', title: 'Steady your mind', paragraphs: ['Dear one, I hear you.', 'As I told Arjuna (BG 2.47), act without clinging.'], actions: ['Breathe slowly'], follow_up: 'What worries you most?', verses: [{ ref: 'BG 2.47', chapter: 2, verse: 47, translation: 'Thy right is to work only' }] });
  }
  if (p === '/rest/v1/chat_threads' || p === '/rest/v1/chat_messages') {
    // Saved conversations: PostgREST answers inserts with 201 and updates with an empty 204.
    if (!authed) return json({ message: 'JWT required' }, 401);
    if (m === 'GET') return json([]);
    (S.chatWrites = S.chatWrites || []).push({ p, m, body: req.postData() });
    return route.fulfill({ status: m === 'POST' ? 201 : 204, headers: cors, body: '' });
  }
  if (p === '/rest/v1/text_translations') {
    (S.storedLog = S.storedLog || []).push((url.searchParams.get('language')||'') + ':' + (authed ? 'ok' : 'unauth') + ':' + (req.headers()['range']||''));
    if (!authed) return json({ message: 'JWT required' }, 401);
    const lang = (url.searchParams.get('language') || '').replace('eq.', '');
    S.storedLoads = S.storedLoads || {}; S.storedLoads[lang] = (S.storedLoads[lang] || 0) + 1;
    const crypto = await import('node:crypto');
    const h = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
    return json(lang === 'gu' ? [{ source_hash: h('translation of 12.19'), translated: 'સંગ્રહિત અર્થ' }, { source_hash: h('Read slowly. Notice which phrase creates the strongest reaction in you.'), translated: 'સંગ્રહિત ચિંતન' }] : []);
  }
  if (p === '/functions/v1/tts-krishna') {
    if (!authed || !S.paid) return json({ error: 'Annual Access required' }, 403);
    const tb = JSON.parse(route.request().postData() || '{}');
    if (tb.operation === 'translate' && S.translateDelay) await new Promise(r => setTimeout(r, S.translateDelay));
    if (tb.operation === 'translate') return S.translateFail ? json({ error: 'Narration failed. Please try again.' }, 500) : json({ text: '[' + tb.language + '] ' + tb.text, language: tb.language });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'audio/mpeg' }, body: Buffer.alloc(16) });
  }
  return json({ error: 'unmocked ' + p }, 404);
}

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const ALLFB = [];
await ctx.exposeBinding('__rep', (_src, a) => ALLFB.push(a));
await ctx.addInitScript(() => { window.__fb = []; window.fbq = function () { const a = [...arguments]; window.__fb.push(a); try { window.__rep(JSON.parse(JSON.stringify(a))); } catch (e) {} }; });
await ctx.route(/supabase\.co/, backend);
await ctx.route(/facebook\.(com|net)/, r => r.fulfill({ status: 204, body: '' }));
// Razorpay's on-site checkout script is blocked here, so checkout uses the
// hosted payment link (the pop-up is covered in payments.mjs).
await ctx.route(/checkout\.razorpay\.com/, r => r.abort());
await ctx.route(/rzp\.io|gitaverse\.co\.in|fonts\.g/, r => r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<h1>external</h1>' }));

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource|loadAccountProfile failed|Audio|NotSupportedError|no supported source/i.test(msg.text())) errors.push('console: ' + msg.text()); });

const screen = () => page.evaluate(() => [...document.querySelectorAll('.screen')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.id).join(','));
const fb = () => page.evaluate(() => window.__fb.map(a => a.slice(0, 2).join(':')));
const fbFull = () => page.evaluate(() => window.__fb);
const wait = ms => page.waitForTimeout(ms);
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });

// ===== 1. Signed-out visitor =====
console.log('\n# Signed-out visitor');
await page.goto(BASE + '/');
check(JSON.stringify((await fbFull())[0]) === JSON.stringify(['init', '2178415463100322', {}]), 'signed-out visitor: pixel starts with no personal data');
await page.waitForFunction(() => document.getElementById('dailyTag').textContent.includes('12.19'), null, { timeout: 5000 }).catch(() => {});
check((await page.textContent('#dailyTag')).includes('12.19'), 'daily verse card shows today\'s verse (12.19)');
check((await fb()).includes('track:PageView'), 'Meta PageView fires on load');
check(await page.isVisible('#offer'), 'upgrade offer bar visible to signed-out visitor');
check((await page.textContent('#offer')).includes('first question') && (await page.textContent('#buyLifetime')).includes('Ask free'), 'bottom bar offers the free question to new visitors', await page.textContent('#offer'));
check(await page.isVisible('#heroFreeNote') && (await page.getAttribute('#heroAsk', 'class')).includes('primary'), 'hero: Ask Krishna is the main button, marked 1st question free');
await page.click('#buyLifetime'); await wait(250);
check((await screen()) === 'ask', 'free bar opens Ask Krishna', await screen());
await page.evaluate(() => showScreen('home'));
await shot('01-home-signed-out');
await page.click('#dailyRead'); await wait(300);
check((await screen()) === 'offerScreen' && (await page.textContent('#offerLead')).includes('every verse'), 'Read verse (signed out) -> offer screen explaining what full access includes', await screen());
check((await page.textContent('#offerScreen')).includes('₹999') && (await page.textContent('#offerScreen')).includes('no autopay') && (await page.locator('.offer-benefits li').count()) === 4, 'offer screen shows the benefits, the price and no autopay');
await page.click('#offerLater'); await wait(150);
check((await screen()) === 'home', '"Maybe later" returns to where the visitor was', await screen());
await page.click('#dailyRead'); await wait(300); await page.click('#offerBuy'); await wait(300);
check((await screen()) === 'authScreen' && !S.calls.some(c => c.p === '/functions/v1/create-payment-link'), 'buying from the offer while signed out asks to sign in first', await screen());
await page.evaluate(() => { localStorage.removeItem('gitaBuyAfterSignIn'); showScreen('home'); });
await page.evaluate(() => showScreen('ask')); await wait(100);
check((await page.textContent('#chatHint')).includes('first question is free'), 'Ask screen tells visitors the first question is free');
// The first question is answered before sign-up.
await page.fill('#askInput', 'I am worried about my exams'); await page.click('#sendAskButton');
await page.waitForFunction(() => document.getElementById('chat').textContent.includes('I hear your worry'), null, { timeout: 5000 }).catch(() => {});
check((await screen()) === 'ask', 'Ask Krishna (signed out): stays on Ask, no sign-up first', await screen());
check((await page.textContent('#chat')).includes('I hear your worry'), 'signed-out visitor sees Krishna\'s answer to the first question');
const anonAsk = S.calls.filter(c => c.p === '/functions/v1/ask-krishna');
check(anonAsk.length === 1 && !anonAsk[0].auth && JSON.parse(anonAsk[0].body).visitor_id === await page.evaluate(() => VISITOR_ID) && !JSON.parse(anonAsk[0].body).history, 'first question sent without a login, with the visitor id and no history');
check(await page.isVisible('.upgrade-card') && (await page.textContent('.upgrade-card')).includes('one more question free') && !(await page.textContent('.upgrade-card')).includes('₹'), 'after the first answer: invite to sign up free for one more question (no price yet)');
check((await page.textContent('#offer')).includes('one more question') && (await page.textContent('#offer')).includes('quick sign-up'), 'bottom bar now offers one more free question with sign-up', await page.textContent('#offer'));
check(!(await fbFull()).some(a => a[1] === 'CompleteRegistration'), 'no Meta CompleteRegistration without a sign-up');
check(!S.calls.some(c => c.p.includes('gita_verses')), 'signed-out visitor never fetches verse data');
await shot('01b-anon-answer');
await page.click('.continue-free-btn'); await wait(200);
check((await screen()) === 'authScreen' && (await page.textContent('#authModeLead')).includes('one more question free'), '"Continue free" opens sign-up for one more free question', await page.textContent('#authModeLead'));
await page.evaluate(() => showScreen('ask'));
// A second question needs an account; it is kept and answered after sign-up.
await page.fill('#askInput', 'I am anxious about my career'); await page.click('#sendAskButton'); await wait(300);
check((await screen()) === 'authScreen', 'second question (signed out) -> sign-up screen', await screen());
check((await page.textContent('#authModeLead')).includes('continue this conversation'), 'sign-up screen explains the chat continues after sign-up', await page.textContent('#authModeLead'));
check(await page.isVisible('#passwordSignupStep'), 'sign-up (not login) form shown');
check(S.calls.filter(c => c.p === '/functions/v1/ask-krishna').length === 1, 'second signed-out question not sent to the server');
// If this browser's record is cleared, the server still refuses a second free answer.
await page.evaluate(() => { localStorage.removeItem('gitaAnonAsked'); localStorage.removeItem('gitaPendingQuestion'); showScreen('ask'); });
await page.fill('#askInput', 'I am anxious about my career'); await page.click('#sendAskButton'); await wait(400);
check((await screen()) === 'authScreen' && S.calls.filter(c => c.p === '/functions/v1/ask-krishna').length === 2, 'server refusal of a second free answer -> sign-up screen', await screen());
check(await page.evaluate(() => localStorage.getItem('gitaAnonAsked') === '1' && JSON.parse(localStorage.getItem('gitaPendingQuestion')).q === 'I am anxious about my career'), 'refused question is kept for after sign-up');

// ===== 2. Email sign-up (free user) =====
console.log('\n# Email sign-up');
await page.evaluate(() => { showScreen('authScreen'); setAuthPageMode('signup'); });
await page.fill('#signupEmail', 'test@example.com'); await page.fill('#signupPassword', 'secret123');
await page.click('#passwordSignupBtn'); await wait(800);
check((await screen()) === 'ask', 'after sign-up, back on Ask Krishna', await screen());
const firstAsk = S.calls.filter(c => c.p === '/functions/v1/ask-krishna' && c.auth);
check(firstAsk.length === 1 && JSON.parse(firstAsk[0].body).question === 'I am anxious about my career', 'the question typed before sign-up is answered automatically');
check((await page.textContent('#chat')).includes('Steady your mind'), 'free answer from Krishna shown');
await page.waitForFunction(() => /saved|Not saved/.test(document.getElementById('chatSaveStatus')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
const savedRows = (S.chatWrites || []).filter(w => w.p === '/rest/v1/chat_messages').flatMap(w => JSON.parse(w.body));
check(savedRows.some(r => r.role === 'user' && r.content === 'I am worried about my exams') && savedRows.some(r => r.role === 'user' && r.content === 'I am anxious about my career') && savedRows.every(r => r.user_id === 'u1'), 'after sign-up, the free chat and the new answer are saved to the account', JSON.stringify(savedRows.map(r => r.content)));
check((await page.textContent('#chatSaveStatus')) === 'Conversation saved' && await page.isHidden('#chatSaveRetry'), 'chat shows "Conversation saved" (no false "Not saved" warning)', await page.textContent('#chatSaveStatus'));
check(await page.isVisible('.upgrade-card') && (await page.textContent('.upgrade-card')).includes('3 months ₹399 · 1 year ₹999') && (await page.textContent('.upgrade-btn')).includes('See plans'), 'upgrade card under the free answer shows both plans');
check(!(await page.textContent('#chatHint')).includes('free'), 'free hint removed once used');
check((await page.textContent('#offer')).includes('Plans from ₹399') && await page.isHidden('#heroFreeNote'), 'after the free question, the bar offers the plans');
await shot('02a-free-answer');
await page.fill('#askInput', 'And what about my family?'); await page.click('#sendAskButton'); await wait(300);
check((await screen()) === 'offerScreen' && (await page.textContent('#offerLead')).includes('used your free questions'), 'second question -> offer screen', await screen());
await shot('02b-offer');
await page.evaluate(() => showScreen('accountScreen'));
check(S.calls.filter(c => c.p === '/functions/v1/ask-krishna' && c.auth).length === 1, 'second question not sent to the server');
check((await page.textContent('#accountPlan')).trim() === 'Free', 'new account shows Free plan', await page.textContent('#accountPlan'));
check((await fbFull()).filter(a => a[1] === 'CompleteRegistration').length === 1 && (await fbFull()).find(a => a[1] === 'CompleteRegistration')?.[3]?.eventID === 'gita_reg_u1' && (await fbFull()).find(a => a[1] === 'CompleteRegistration')?.[2]?.registration_method === 'email', 'Meta CompleteRegistration fires once on email sign-up, with method email and a dedup eventID');
check(await page.evaluate(() => { const f = window.__fb, i = f.findIndex(a => a[0] === 'init' && a[1] === '2178415463100322' && a[2]?.em === 'test@example.com' && a[2]?.external_id === 'u1' && !a[2]?.ph), r = f.findIndex(a => a[1] === 'CompleteRegistration'); return i >= 0 && i < r; }), 'Meta gets the email (hashed by the pixel) before the sign-up event');
check(await page.evaluate(() => !!localStorage.getItem('gitaAuthSession')), 'session saved');
await shot('02-account-free');

// Free user is still locked out
await page.evaluate(() => openVerse(2, 47)); await wait(300);
check((await screen()) === 'offerScreen', 'free user opening a verse -> offer screen', await screen());
check(!S.calls.some(c => c.p === '/rest/v1/gita_verses'), 'free user never fetches verse data');

// ===== 3. Checkout =====
console.log('\n# Checkout');
// The buy button under the free answer, tapped repeatedly while the link is slow
// to arrive (a real visitor tapped 5 times and got 5 payment links).
S.linkDelay = 1500;
const fbBeforeCheckout = ALLFB.length; // an earlier signed-out tap on the offer sent its own CheckoutClick
await page.evaluate(() => showScreen('ask'));
const nav = page.waitForRequest(r => r.url().startsWith('https://rzp.io/'), { timeout: 8000 }).catch(() => null);
await page.click('.upgrade-btn');
await wait(150);
check((await screen()) === 'offerScreen' && S.calls.every(c => c.p !== '/functions/v1/create-payment-link'), 'the button under the free answer opens the plan choice (no payment yet)', await screen());
await page.click('#offerBuy');
await wait(150);
check((await page.textContent('#offerBuy')) === 'Opening secure payment…' && await page.isDisabled('#offerBuy') && await page.isDisabled('.upgrade-btn') && await page.isDisabled('#buyLifetime'), 'buy tap shows progress at once and locks every buy button', await page.textContent('#offerBuy'));
await page.click('.plan[data-plan="quarterly"]', { force: true });
check(await page.getAttribute('.plan[data-plan="annual"]', 'aria-checked') === 'true', 'the plan cannot be switched while payment is opening');
for (let i = 0; i < 3; i++) { await page.evaluate(() => document.getElementById('offerBuy').click()); await page.evaluate(() => startLifetimePurchase()); }
const navReq = await nav;
await page.waitForURL(/rzp\.io/, { timeout: 5000 }).catch(() => {});
const pl = S.calls.find(c => c.p === '/functions/v1/create-payment-link');
check(!!pl && pl.auth === 'Bearer tok_u1', 'Get Annual Access calls create-payment-link with the user\'s login');
check(S.calls.filter(c => c.p === '/functions/v1/create-payment-link').length === 1, 'repeated buy taps create only one payment link', String(S.calls.filter(c => c.p === '/functions/v1/create-payment-link').length));
check(ALLFB.slice(fbBeforeCheckout).filter(a => a[1] === 'InitiateCheckout').length === 1 && ALLFB.slice(fbBeforeCheckout).filter(a => a[1] === 'CheckoutClick').length === 1, 'repeated buy taps send Meta one CheckoutClick and one InitiateCheckout');
check(!!navReq, 'browser is sent to the Razorpay payment page');
const ic = ALLFB.find(a => a[1] === 'InitiateCheckout');
check(ic?.[2]?.value === 999 && ic?.[2]?.currency === 'INR', 'Meta InitiateCheckout fires with 999 INR before redirect', JSON.stringify(ic));
const fbBeforeNav = S.calls.length; // (fb events are lost on navigation; InitiateCheckout checked via code order below)

// ===== 4. Return from Razorpay =====
console.log('\n# Payment return');
S.polls = 0; S.paidAfterPolls = 2; // webhook lands after the first poll
await page.goto(BASE + '/?payment=success');
await page.waitForFunction(() => /Annual/.test(document.getElementById('accountPlan').textContent), null, { timeout: 12000 }).catch(() => {});
check((await page.textContent('#accountPlan')).trim() === 'Annual', 'returning buyer sees Annual plan after webhook', await page.textContent('#accountPlan'));
check(!page.url().includes('payment=success'), 'payment=success removed from the URL');
const purchases = (await fbFull()).filter(a => a[1] === 'Purchase');
check(purchases.length === 1, 'Meta Purchase fires exactly once', JSON.stringify(purchases));
check(purchases[0]?.[2]?.value === 999 && purchases[0]?.[2]?.currency === 'INR', 'Purchase value = 999 INR');
check(purchases[0]?.[3]?.eventID === 'gita_purchase_pay_TEST1', 'Purchase has dedup eventID');
await shot('03-account-paid');
await page.goto(BASE + '/?payment=success'); await wait(1500);
check(!(await fbFull()).some(a => a[1] === 'Purchase'), 'reloading the return URL does not fire Purchase again');
{ const inits = (await fbFull()).filter(a => a[0] === 'init'), first = (await fbFull())[0];
  check(first?.[0] === 'init' && first[1] === '2178415463100322' && first[2]?.em === 'test@example.com' && first[2]?.external_id === 'u1' && (await fbFull())[1]?.[1] === 'PageView', 'signed-in reload: PageView carries the email from the first init', JSON.stringify(inits));
  check(inits.length === 1, 'signed-in reload: the pixel is not initialised twice', JSON.stringify(inits)); }

// ===== 5. Paid features =====
// Saved chats can be deleted from the account screen, after a confirmation.
await page.evaluate(() => showScreen('accountScreen'));
check(await page.isVisible('#accountChats') && (await page.textContent('#accountChats')).includes('Only you can see them'), 'account screen explains saved chats and offers deletion');
page.once('dialog', d => d.dismiss()); await page.click('#deleteChatsBtn'); await wait(300);
check(!(S.chatWrites || []).some(w => w.m === 'DELETE'), 'cancelling the confirmation deletes nothing');
page.once('dialog', d => d.accept()); await page.click('#deleteChatsBtn'); await wait(600);
const deletes = (S.chatWrites || []).filter(w => w.m === 'DELETE').map(w => w.p);
check(JSON.stringify(deletes) === JSON.stringify(['/rest/v1/chat_threads']) && S.calls.filter(c => c.m === 'DELETE').every(c => c.auth === 'Bearer tok_u1' && c.q === '?user_id=eq.u1'), 'confirmed delete removes the user\'s conversations (messages go with them) in one request', JSON.stringify(deletes));
check((await page.textContent('#toast')).includes('chat history has been deleted') && (await page.locator('#chat .bubble').count()) === 0, 'user is told the history was deleted and the open chat is cleared', await page.textContent('#toast'));
console.log('\n# Paid user');
await page.goto(BASE + '/'); await wait(600);
check(!(await page.isVisible('#offer')), 'offer bar hidden for paid user');
await page.click('#dailyRead'); await wait(600);
check((await screen()) === 'detail' && (await page.textContent('#detailKicker')).includes('12.19'), 'paid user opens today\'s verse', await screen());
const vf = S.calls.find(c => c.p === '/rest/v1/gita_verses');
check(!!vf && vf.auth === 'Bearer tok_u1', 'verse data fetched with the user\'s login');
check((await page.textContent('#detailMeaning')).length > 5, 'meaning text rendered', await page.textContent('#detailMeaning'));
check((await page.textContent('#reflection')).trim().length > 5, 'reflection prompt shown under the meaning', JSON.stringify(await page.textContent('#reflection')));
check(!S.calls.some(c => c.p === '/functions/v1/tts-krishna'), 'default English meaning needs no translation call');
const ttsBefore = S.calls.filter(c => c.p === '/functions/v1/tts-krishna').length;
await page.selectOption('#meaningLanguage', 'gu'); await wait(250);
check(await page.textContent('#detailMeaning') === 'સંગ્રહિત અર્થ' && await page.textContent('#reflection') === 'સંગ્રહિત ચિંતન', 'stored translation shows instantly', await page.textContent('#detailMeaning'));
check(S.calls.filter(c => c.p === '/functions/v1/tts-krishna').length === ttsBefore, 'stored translation needs no AI call');
await page.click('#meaningTabs button[data-tab="today"]'); await page.click('#meaningTabs button[data-tab="meaning"]'); await wait(150);
check(S.storedLoads.gu === 1, 'switching tabs reuses the loaded set (no reload)', JSON.stringify(S.storedLog));
S.translateDelay = 1500; await page.selectOption('#meaningLanguage', 'hi'); await wait(300);
check((await page.textContent('#detailMeaning')).trim().length > 5 && !(await page.textContent('#detailMeaning')).includes('Translating') && (await page.textContent('#translationStatus')).includes('Translating to Hindi'), 'while translating, the English meaning stays readable', await page.textContent('#detailMeaning'));
await page.locator('#detail .meaning-card').screenshot({ path: OUT + '/translating.png' });
await wait(1500); check((await page.textContent('#detailMeaning')).startsWith('[hi] '), 'translation replaces English when ready');
S.translateDelay = 0;
const scrBefore = await screen(); await page.click('#langButton'); await wait(150);
check(await page.isVisible('#langMenu') && (await screen()) === scrBefore, '🌐 opens the language picker without leaving the page', await screen());
// The 🌐 picker sets the website's own language; chat replies and verse
// meanings keep their separate choices and are never rewritten by it.
check(await page.inputValue('#appLanguage') === 'en' && (await page.textContent('#langMenu')).includes('Website language'), 'picker shows the website language (English by default)', await page.inputValue('#appLanguage'));
const chatLangBefore = await page.inputValue('#chatLanguage'), meaningLangBefore = await page.inputValue('#meaningLanguage'), meaningTextBefore = await page.textContent('#detailMeaning');
await page.selectOption('#appLanguage', 'hi');
await page.waitForFunction(() => document.getElementById('homeNav').textContent === 'होम', null, { timeout: 5000 }).catch(() => {});
check(await page.textContent('#homeNav') === 'होम' && await page.textContent('#askNav') === 'कृष्ण से पूछें', 'choosing Hindi translates the website menus', await page.textContent('#homeNav'));
check(await page.inputValue('#chatLanguage') === chatLangBefore && await page.inputValue('#meaningLanguage') === meaningLangBefore && await page.textContent('#detailMeaning') === meaningTextBefore, 'website language leaves chat and verse-meaning choices and text unchanged');
check(await page.evaluate(() => localStorage.getItem('gitaWebsiteLanguage')) === 'hi' && !S.calls.some(c => c.p === '/functions/v1/website-language'), 'Hindi website text loads from the shipped file and is remembered');
await page.selectOption('#appLanguage', 'en'); await wait(200);
check(await page.textContent('#homeNav') === 'Home', 'switching back to English restores the menus', await page.textContent('#homeNav'));
await page.keyboard.press('Escape'); check(!(await page.isVisible('#langMenu')), 'Escape closes the picker');
await page.screenshot({ path: OUT + '/langmenu-closed.png', clip: { x: 0, y: 0, width: 390, height: 200 } });
await page.selectOption('#meaningLanguage', 'ta'); await wait(400);
check((await page.textContent('#detailMeaning')).startsWith('[ta] ') && (await page.textContent('#reflection')).startsWith('[ta] '), 'Tamil selected: meaning and reflection translated', await page.textContent('#reflection'));
S.translateFail = true; await page.click('#meaningTabs button[data-tab="deep"]'); await wait(400);
check((await page.textContent('#detailMeaning')).trim().length > 5 && !(await page.textContent('#detailMeaning')).startsWith('[ta]'), 'if translation fails, the meaning is still readable (English fallback)', JSON.stringify(await page.textContent('#detailMeaning')));
check((await page.textContent('#reflection')).trim().length > 5 && await page.isVisible('#retryTranslation'), 'fallback keeps the reflection and offers retry');
S.translateFail = false; await page.selectOption('#meaningLanguage', 'en-hi'); await wait(200);
for (const t of ['deep', 'today', 'meaning']) { await page.click(`#meaningTabs button[data-tab="${t}"]`); }
check((await page.textContent('#panelTitle')).trim() === 'MEANING', 'meaning tabs switch');
await page.click('#nextVerse'); await wait(300);
check((await page.textContent('#detailKicker')).includes('12.20'), 'next verse works', await page.textContent('#detailKicker'));
await page.click('#saveVerse'); await wait(100);
check((await page.textContent('#saveVerse')).includes('Saved'), 'save verse works');
await shot('04-verse-detail');
await page.evaluate(() => { window.playBlob = async () => {}; }); // headless can't decode the fake mp3
await page.click('#audioBtn'); await wait(800);
const tts = S.calls.find(c => c.p === '/functions/v1/tts-krishna');
check(!!tts && tts.auth === 'Bearer tok_u1', 'narration request carries the user\'s login (required by new tts-krishna)', tts?.auth);
await wait(600); const spoken = S.calls.filter(c => c.p === '/functions/v1/tts-krishna').map(c => JSON.parse(c.body)).find(b => b.kind === 'meaning' && b.operation !== 'translate');
check(!!spoken && spoken.language === 'hi' && spoken.text.startsWith('[hi] '), 'default narration speaks the meaning in Hindi (as before)', JSON.stringify(spoken));
await page.evaluate(() => stopSpeech());

// Chat
await page.evaluate(() => showScreen('ask')); await wait(200);
await page.fill('#askInput', 'I feel anxious about my exams'); await page.click('#sendAskButton'); await wait(600);
check((await page.locator('.bubble.assistant').last().textContent()).includes('Dear one'), 'Ask Krishna reply rendered');
check(await page.locator('.bubble.assistant .chat-ref').count() > 0, 'inline verse reference is a button');
await page.fill('#askInput', 'what should I do first?'); await page.click('#sendAskButton'); await wait(600);
const asks = S.calls.filter(c => c.p === '/functions/v1/ask-krishna').map(c => JSON.parse(c.body));
check(asks.length && asks.every(a => !('language' in a)), 'chat language defaults to Auto (no forced reply language)', JSON.stringify(asks.map(a => a.language)));
check(asks.at(-1)?.history?.length === 2, 'second question sends conversation history', JSON.stringify(asks.at(-1)?.history?.length));
await shot('05-chat');
await page.locator('.bubble.assistant .chat-ref').first().click(); await wait(500);
check((await screen()) === 'detail' && (await page.textContent('#detailKicker')).includes('2.47'), 'tapping BG 2.47 in chat opens the verse');

// Topics
await page.evaluate(() => showScreen('home')); await wait(200);
await page.locator('.topic-row .topic').first().click(); await wait(300);
check((await screen()) === 'topicScreen', 'life topic opens for paid user', await screen());

// ===== 6. Sign out =====
console.log('\n# Sign out');
await page.evaluate(() => openAccount()); await wait(200);
await page.click('#signOutBtn'); await wait(500);
check(!(await page.evaluate(() => localStorage.getItem('gitaAuthSession'))), 'sign out clears the session');
await page.evaluate(() => openVerse(2, 47)); await wait(300);
check((await screen()) !== 'detail', 'after sign-out, verses are locked again', await screen());

// ===== 7. Google sign-in (new user) =====
console.log('\n# Google sign-in');
S.paid = false; S.createdAt = new Date().toISOString();
// The simulated backend reuses account u1, which the email sign-up above already
// counted; forget that so this plays a brand-new Google account.
await page.evaluate(() => localStorage.removeItem('gitaMetaRegistration:u1'));
const p2 = await ctx.newPage();
p2.on('pageerror', e => errors.push('pageerror(google): ' + e.message));
await p2.goto(BASE + '/#access_token=tok_u1&refresh_token=ref_u1&expires_in=3600&token_type=bearer'); await p2.waitForTimeout(1200);
const fb2 = await p2.evaluate(() => window.__fb);
check(fb2.some(a => a[1] === 'CompleteRegistration' && a[2]?.registration_method === 'google'), 'new Google user fires CompleteRegistration (google)');
check(!p2.url().includes('access_token'), 'OAuth tokens removed from the URL');
await p2.goto('about:blank');
await p2.goto(BASE + '/#access_token=tok_u1&refresh_token=ref_u1&expires_in=3600&token_type=bearer'); await p2.waitForTimeout(1200);
const googleRegs = ALLFB.filter(a => a[1] === 'CompleteRegistration' && a[2]?.registration_method === 'google').length;
const logins = ALLFB.filter(a => a[1] === 'Login').length;
check(logins >= 2 && googleRegs === 1, 'Google registration not double-counted on a second fresh sign-in', `logins=${logins} googleRegs=${googleRegs}`);
await p2.close();

// ===== 8. Old domain redirect =====
console.log('\n# Old domain redirect');
const p3 = await ctx.newPage();
const html = (await import('node:fs')).readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
await p3.route(/geeta-with-krishna\.vercel\.app/, r => r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: html }));
const redirected = p3.waitForRequest(r => r.url().startsWith('https://gitaverse.co.in/'), { timeout: 5000 }).catch(() => null);
await p3.goto('http://geeta-with-krishna.vercel.app/?payment=success').catch(() => {});
const rr = await redirected;
check(rr?.url() === 'https://gitaverse.co.in/?payment=success', 'old vercel.app address redirects to gitaverse.co.in keeping ?payment=success', rr?.url());
await p3.close();

// ===== summary =====
check(errors.length === 0, 'no JavaScript errors during the whole run', errors.join(' | '));
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await b.close();
process.exit(failed.length ? 1 : 0);
