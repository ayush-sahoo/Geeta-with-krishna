// Talking Krishna: paid members can hear an Ask Krishna answer spoken by the
// animated portrait, and talk to Krishna voice to voice in the Talk tab. The
// voice and letter timings come from tts-krishna; a Talk turn is one
// ask-krishna call (speech-to-text, answer, first sentence voiced).
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok = (c, m, d = '') => console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : ' -> ' + d));
const b = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

// A short tone as WAV, so the browser can decode it like the real voice.
function wav(seconds) {
  const sr = 16000, n = Math.round(sr * seconds), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin(i / sr * 2 * Math.PI * 180) * (0.6 + 0.4 * Math.sin(i / sr * 9))), 44 + i * 2);
  return buf.toString('base64');
}
function voiceFor(text) {
  const chars = [...text], step = 0.05;
  return { audio_base64: wav(chars.length * step + 0.3), alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * step), character_end_times_seconds: chars.map((_, i) => (i + 1) * step) } };
}

// The app's own sentence splitting, so the simulated server splits replies the same way.
import { readFileSync } from 'node:fs';
const APP = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const speechChunks = new Function(APP.slice(APP.indexOf('function speechChunks('), APP.indexOf('async function fetchVoice(')) + 'return speechChunks')();
const spokenAnswer = new Function(APP.slice(APP.indexOf('function spokenAnswer('), APP.indexOf('// "Auto" replies')) + 'return spokenAnswer')();
const HEARD = 'मुझे अपने भविष्य की चिंता है';

const HINDI = { style: 'krishna_inspired', title: 'भविष्य की चिंता से मुक्ति', paragraphs: ['मेरे प्रिय, मैं तुम्हारी दुविधा समझता हूँ।', 'तुम्हारा अधिकार केवल कर्म पर है (BG 2.47)।'], actions: ['गहरी साँस लें।'], follow_up: 'क्या चिंता है?', verses: [{ ref: 'BG 2.47', chapter: 2, verse: 47, translation: 'Thy right is to work only' }] };
const ENGLISH = { style: 'krishna_inspired', title: 'Be steady', paragraphs: ['Dear one, I hear your worry.', 'Act without clinging to results (BG 2.47).'], actions: [], follow_up: 'What worries you most?', verses: [] };

async function open({ paid, reply, ttsStatus = 200,app = false, ask = true }) {
  const S = { calls: [] };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const user = { id: 'u1', email: 't@example.com', app_metadata: { provider: 'email' } };
  const session = { access_token: 'tok_u1', refresh_token: 'ref_u1', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  await ctx.addInitScript(s => localStorage.setItem('gitaAuthSession', JSON.stringify(s)), session);
  await ctx.route(/supabase\.co/, async r => {
    const req = r.request(), p = new URL(req.url()).pathname, H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: H });
    S.calls.push({ p, body: req.postData() });
    const json = (body, status = 200) => r.fulfill({ status, headers: H, body: JSON.stringify(body) });
    if (p === '/auth/v1/token') return json(session);
    if (p === '/auth/v1/user') return json(user);
    if (p === '/functions/v1/get-my-access') return json(paid
      ? { email: user.email, plan_status: 'annual', payment_status: 'paid', access_active: true, access_expires_at: new Date(Date.now() + 864e5 * 30).toISOString(), user_id: 'u1' }
      : { email: user.email, plan_status: 'free', payment_status: 'unpaid', access_active: false, free_question_available: true, user_id: 'u1' });
    if (p === '/functions/v1/ask-krishna') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.warm) return json({ ok: true });
      if (body.audio_base64) {
        const chunks = speechChunks(spokenAnswer(reply));
        return json({ ...reply, heard: { text: HEARD, language: 'hi' }, speech: { language: 'hi', chunks, first: voiceFor(chunks[0]) } });
      }
      return json(paid ? reply : { ...reply, free_question: true });
    }
    if (p === '/functions/v1/tts-krishna') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.warm) return json({ ok: true });
      if (ttsStatus !== 200) return json({ error: 'Narration failed. Please try again.' }, ttsStatus);
      return json(voiceFor(body.text));
    }
    if (/chat_threads|chat_messages/.test(p)) return req.method() === 'GET' ? json([]) : r.fulfill({ status: 201, headers: H, body: '' });
    return json([]);
  });
  await ctx.route(/facebook|fonts\.g/, r => r.fulfill({ status: 204, body: '' }));
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + (app ? '/?app=1' : '/')); await p.waitForTimeout(600);
  await p.evaluate(() => showScreen('ask'));
  if (!ask) return { ctx, p, S, errs };
  await p.fill('#askInput', 'I worry about my future'); await p.click('#sendAskButton');
  await p.waitForSelector('#chat .bubble.assistant h3', { timeout: 5000 });
  return { ctx, p, S, errs };
}
const ttsCalls = S => S.calls.filter(c => c.p === '/functions/v1/tts-krishna').map(c => JSON.parse(c.body)).filter(b => !b.warm);

console.log('\n# Free member');
{ const { ctx, p, errs } = await open({ paid: false, reply: HINDI });
  ok(!(await p.isVisible('.hear-krishna')), 'free members do not get the talking Krishna button');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Paid member, Hindi answer');
{ const { ctx, p, S, errs } = await open({ paid: true, reply: HINDI });
  ok(await p.isVisible('.hear-krishna'), 'paid members see "Hear Krishna say this" on the answer');
  await p.click('.hear-krishna');
  await p.waitForSelector('.ka', { timeout: 3000 });
  ok(await p.isVisible('.ka .ka-stage'), 'tapping it opens Krishna\'s portrait');
  await p.waitForFunction(() => document.querySelectorAll('.ka-words span').length > 0, null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(800);
  const reqs = ttsCalls(S), req = { text: reqs.map(r => r.text).join(' ') };
  ok(reqs.length === 2 && reqs.every(r => r.timestamps === true && r.translated === true && r.kind === 'meaning'), 'asks tts-krishna for the voice with letter timings, sentence by sentence', JSON.stringify(reqs.map(r => r.text)));
  ok(reqs[0].text === 'मेरे प्रिय, मैं तुम्हारी दुविधा समझता हूँ।', 'the first piece is just the first sentence, so Krishna starts sooner', reqs[0]?.text);
  ok(reqs.every(r => r.language === 'hi'), 'a Hindi answer is spoken in Hindi', reqs.map(r => r.language).join());
  ok(!/BG|\(|\)/.test(req.text) && req.text.includes('क्या चिंता है?') && !req.text.includes('गहरी साँस'), 'speaks the paragraphs and closing question, without verse references', req.text);
  const words = await p.locator('.ka-words span').count();
  ok(words === req.text.split(' ').length, 'every spoken word is shown, across the pieces', `${words} vs ${req.text.split(' ').length}`);
  ok(await p.evaluate(() => !!document.querySelector('.ka .ka-stage canvas')), 'the animated portrait is drawn (WebGL)');
  await p.waitForTimeout(1200);
  const lit = await p.evaluate(() => document.querySelectorAll('.ka-words span.done,.ka-words span.now').length);
  ok(lit > 0 && lit < words, 'words light up as Krishna speaks', `${lit}/${words}`);
  const shapes = await p.evaluate(() => { const k = KrishnaAvatar._test.mouthKeys; const s = t => k([...t], [...t].map((_, i) => i * .1), [...t].map((_, i) => i * .1 + .1));
    return { ma: s('मा').map(x => x[1]), tamil: s('மா').map(x => x[1]), latin: s('mo').map(x => [x[1], x[2]]) }; });
  ok(shapes.ma[0] === 0 && shapes.ma[1] > .9, 'lips close for "म" and open wide for "ा"', JSON.stringify(shapes.ma));
  ok(JSON.stringify(shapes.tamil) === JSON.stringify(shapes.ma), 'Tamil letters get the same mouth shapes as Hindi ones', JSON.stringify(shapes.tamil));
  ok(shapes.latin[0][0] === 0 && shapes.latin[1][1] < 0, 'English letters: "m" closes the lips, "o" rounds them', JSON.stringify(shapes.latin));
  await p.click('.ka-close');
  ok(!(await p.isVisible('.ka')) && await p.isEnabled('.hear-krishna'), 'closing returns to the chat');
  await p.click('.hear-krishna'); await p.waitForSelector('.ka-words span', { timeout: 5000 });
  ok(ttsCalls(S).length === 2, 'hearing the same answer again reuses the voice (no second charge)', ttsCalls(S).length);
  await p.click('.ka-close');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Paid member, English answer');
{ const { ctx, p, S, errs } = await open({ paid: true, reply: ENGLISH });
  await p.click('.hear-krishna'); await p.waitForSelector('.ka-words span', { timeout: 5000 }).catch(() => {});
  ok(ttsCalls(S)[0]?.language === 'en', 'an English answer is spoken in English', ttsCalls(S)[0]?.language);
  ok(await p.evaluate(() => spokenLanguage('Mere priya, tum apne karm par dhyan do, phal ki chinta mat karo, yahi Gita ka sandesh hai')) === 'hi', 'a Hinglish answer is spoken with the Hindi voice');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Voice unavailable');
{ const { ctx, p, errs } = await open({ paid: true, reply: HINDI, ttsStatus: 500 });
  await p.click('.hear-krishna'); await p.waitForTimeout(1500);
  ok((await p.textContent('.ka-status')).includes('Narration failed'), 'a voice error is explained on the portrait screen', await p.textContent('.ka-status'));
  await p.click('.ka-close'); await p.click('.hear-krishna'); await p.waitForTimeout(800);
  ok(await p.isVisible('.ka'), 'the member can try again after an error');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }
console.log('\n# Talk to Krishna');
{ const { ctx, p, errs } = await open({ paid: false, reply: HINDI, ask: false });
  ok(await p.isVisible('#modeChat') && await p.isVisible('#modeTalk'), 'Ask Krishna has two sections: Chat with Krishna and Talk to Krishna');
  await p.click('#modeTalk'); await p.waitForTimeout(600);
  ok(!(await p.isVisible('#chatMode')) && await p.isVisible('#talkStage'), 'Talk to Krishna shows Krishna\'s portrait instead of the chat');
  ok(await p.isVisible('#talkLocked') && !(await p.isVisible('#talkMic')), 'free members see what Talk to Krishna is and a way to join, not the mic');
  await p.click('#modeChat');
  ok(await p.isVisible('#chatMode') && !(await p.isVisible('#talkMode')), 'Chat with Krishna brings the text chat back');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }
{ const { ctx, p, S, errs } = await open({ paid: true, reply: HINDI, ask: false });
  await p.click('#modeTalk'); await p.waitForTimeout(800);
  ok(await p.isVisible('#talkMic') && !(await p.isVisible('#talkLocked')), 'paid members get the mic');
  ok(await p.evaluate(() => !!document.querySelector('#talkStage canvas')), 'the portrait is animated while waiting (WebGL)');
  await p.click('#talkMic'); await p.waitForTimeout(1500);
  ok((await p.textContent('#talkStatus')).startsWith('Listening'), 'tapping the mic starts listening', await p.textContent('#talkStatus'));
  await p.click('#talkMic');
  await p.waitForFunction(() => document.getElementById('talkStatus').textContent.includes('speaking'), null, { timeout: 8000 }).catch(() => {});
  const calls = S.calls.filter(c => /tts-krishna|ask-krishna/.test(c.p)).map(c => ({ p: c.p.split('/').pop(), b: JSON.parse(c.body || '{}') }));
  const ask = calls.find(c => c.p === 'ask-krishna' && c.b.audio_base64), voices = calls.filter(c => c.b.timestamps);
  ok(calls.some(c => c.p === 'ask-krishna' && c.b.warm) && calls.some(c => c.p === 'tts-krishna' && c.b.warm), 'opening Talk wakes the functions up in advance');
  ok(ask && ask.b.audio_base64.length > 100 && /^audio\//.test(ask.b.mime_type) && ask.b.voice === true && !ask.b.language, 'one call sends the recording for speech-to-text and a short spoken reply', JSON.stringify(ask && { ...ask.b, audio_base64: ask.b.audio_base64.length }));
  ok(!calls.some(c => c.b.operation === 'transcribe'), 'no separate speech-to-text request');
  ok(voices.length === 1 && voices[0].b.language === 'hi' && !voices[0].b.text.startsWith('मेरे प्रिय'), 'the first sentence comes voiced with the reply; only the rest is voiced by the app, in the language spoken', JSON.stringify(voices.map(v => v.b.text)));
  ok((await p.textContent('#talkStatus')).includes('speaking'), 'Krishna speaks the reply', await p.textContent('#talkStatus'));
  ok((await p.textContent('#talkYou')).includes('भविष्य') && (await p.locator('#talkWords span').count()) > 3, 'the screen shows what was heard and Krishna\'s words');
  const fit = await p.evaluate(() => {
    const box = r => document.querySelector(r).getBoundingClientRect(), card = box('.talk-card'), text = box('.talk-text'), you = box('#talkYou');
    const lh = parseFloat(getComputedStyle(document.getElementById('talkWords')).lineHeight);
    return { inCard: text.bottom <= card.bottom + 1 && you.top >= card.top, lines: text.height / lh, micOnScreen: box('#talkMic').bottom <= innerHeight };
  });
  ok(fit.inCard && Math.abs(fit.lines - 3) < 0.05 && fit.micOnScreen, 'the question and reply sit over the portrait as subtitles (exactly 3 lines) and the mic stays on screen', JSON.stringify(fit));
  ok((await p.textContent('#chat')).includes('🎙️ मुझे') && (await p.locator('#chat .bubble.assistant h3').count()) === 1, 'the spoken turn is added to the chat as well');
  await p.click('#talkMic'); await p.waitForTimeout(500);
  ok((await p.textContent('#talkStatus')).startsWith('Listening'), 'tapping the mic while Krishna speaks interrupts him and listens');
  await p.click('#modeChat'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => talkState) === 'idle', 'switching to Chat stops listening');
  await p.click('#modeTalk'); await p.click('#talkMic'); await p.waitForTimeout(500);
  await p.evaluate(() => showScreen('home')); await p.waitForTimeout(200);
  ok(await p.evaluate(() => talkState) === 'idle', 'leaving Ask Krishna stops the conversation');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }
console.log('\n# Android Back closes the portrait');
{ const { ctx, p, errs } = await open({ paid: true, reply: HINDI, app: true });
  await p.click('.hear-krishna'); await p.waitForSelector('.ka');
  await p.goBack(); await p.waitForTimeout(200);
  ok(!(await p.isVisible('.ka')), 'Android Back closes the portrait before leaving the chat');
  ok(await p.evaluate(() => document.querySelector('.screen.active')?.id) === 'ask', 'Back from the portrait keeps the chat screen');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }
await b.close();
