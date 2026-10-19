import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = '/home/user/Geeta-with-krishna', S = process.argv[2], OUT = S + '/raw';
fs.mkdirSync(OUT, { recursive: true });
const daily = fs.readFileSync(S + '/data/daily.json', 'utf8'), ch2 = fs.readFileSync(S + '/data/ch2.json', 'utf8');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/json', '.mp3': 'audio/mpeg' };
const srv = http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const REPLY = { style: 'krishna_inspired',
  title: 'A steady mind for your work',
  paragraphs: [
    'My dear friend, I can feel the weight of this worry. When the future of your career feels uncertain, the mind runs ahead and suffers results that have not even arrived.',
    "As I told Arjuna, you have a right to your actions, but never to their fruits (BG 2.47). Give your whole heart to today's work: learn, prepare and do it well, and let the outcome come in its own time.",
    'Staying even-minded in success and failure is itself yoga (BG 2.48). Your worth is not your job title.'],
  actions: ['Write down the one task you can finish today, and finish it.', 'When worry rises, take five slow breaths and return to that task.'],
  follow_up: 'Which part of your work feels most uncertain right now?',
  verses: [{ ref: 'BG 2.47', chapter: 2, verse: 47, translation: 'You have a right to your actions, but never to their fruits.' }, { ref: 'BG 2.48', chapter: 2, verse: 48, translation: 'Perform your duty with an even mind, abandoning attachment.' }],
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
const user = { id: 'u1', email: 'devotee@example.com', app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Devotee' } };
const session = { access_token: 'tok', refresh_token: 'ref', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
await ctx.addInitScript(s => { localStorage.setItem('gitaAuthSession', JSON.stringify(s)); }, session);
await ctx.route(/supabase\.co/, r => { const req = r.request(), u = new URL(req.url()), p = u.pathname, H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'content-type': 'application/json' };
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: H });
  const j = x => r.fulfill({ headers: H, body: typeof x === 'string' ? x : JSON.stringify(x) });
  if (p === '/auth/v1/token') return j(session); if (p === '/auth/v1/user') return j(user);
  if (p === '/functions/v1/get-my-access') return j({ email: user.email, plan_status: 'annual', payment_status: 'paid', access_active: true, access_expires_at: new Date(Date.now() + 3e10).toISOString(), user_id: 'u1' });
  if (p.endsWith('/rpc/get_daily_verse')) return j(daily);
  if (p.endsWith('/gita_verses')) return j(ch2);
  if (p === '/functions/v1/ask-krishna') { const body = JSON.parse(req.postData() || '{}'); return j(body.warm ? { ok: true } : REPLY); }
  return j([]); });
await ctx.route(/facebook|fonts\.g|connect\./, r => r.fulfill({ status: 204, body: '' }));
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${srv.address().port}/?utm_source=android_app`); await p.waitForTimeout(1500);
const shot = async name => { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${name}.png` }); };
await shot('1-home');
await p.evaluate(() => { showScreen('ask'); setAskMode('talk'); }); await p.waitForTimeout(2500);
await p.evaluate(() => {
  setTalk('speaking', 'Krishna is speaking · tap the mic to reply');
  const you = document.getElementById('talkYou'); you.hidden = false; you.textContent = 'मन बहुत बेचैन रहता है, क्या करूँ?';
  const box = document.getElementById('talkWords'); box.replaceChildren();
  'मेरे प्रिय, मन का चंचल होना स्वाभाविक है। जैसे मैंने अर्जुन से कहा था, अभ्यास और वैराग्य से मन वश में होता है। हर दिन थोड़ा समय शांत बैठो।'.split(' ').forEach((w, i) => { const s = document.createElement('span'); s.textContent = w; if (i < 9) s.className = 'done'; if (i === 9) s.className = 'now'; box.append(s, ' '); });
}); await shot('2-talk');
await p.evaluate(() => { setTalk('idle', TALK_IDLE); setAskMode('chat'); });
await p.fill('#askInput', 'I feel anxious about my career. What should I do?'); await p.click('#sendAskButton');
await p.waitForSelector('#chat .bubble.assistant h3', { timeout: 8000 }).catch(async () => console.log('CHAT:', await p.evaluate(() => document.getElementById('chat').innerText.slice(0, 300)), await p.evaluate(() => document.querySelector('.screen.active')?.id)));
await p.evaluate(() => { const u = document.querySelector('#chat .bubble.user'); window.scrollTo(0, u.getBoundingClientRect().top + scrollY - 70); }); await shot('3-chat');
await p.evaluate(() => { meaningLanguage = 'en'; openVerse(2, 47); }); await p.waitForTimeout(1500);
await p.evaluate(() => { const c = document.querySelector('#detail .verse-card'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 60); }); await shot('4-verse');
await p.evaluate(() => showChapterPage(2)); await p.waitForTimeout(800);
await p.evaluate(() => window.scrollTo(0, 0)); await shot('5-chapter');
await p.evaluate(() => showScreen('explore')); await p.waitForTimeout(800); await shot('6-explore');
await b.close(); srv.close();
