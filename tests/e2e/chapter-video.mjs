// Chapter explainer videos: chapter 1 plays for everyone, other chapters for
// members. chapter-video returns a short-lived private link to the video.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok = (c, m, d = '') => console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : ' -> ' + d));
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function open({ paid, signedIn = paid, videoStatus = 200 }) {
  const S = { calls: [] };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const user = { id: 'u1', email: 't@example.com', app_metadata: { provider: 'email' } };
  const session = { access_token: 'tok_u1', refresh_token: 'ref_u1', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  if (signedIn) await ctx.addInitScript(s => localStorage.setItem('gitaAuthSession', JSON.stringify(s)), session);
  await ctx.route(/supabase\.co/, async r => {
    const req = r.request(), p = new URL(req.url()).pathname, H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: H });
    S.calls.push({ p, body: req.postData(), auth: req.headers()['authorization'] || '' });
    const json = (body, status = 200) => r.fulfill({ status, headers: H, body: JSON.stringify(body) });
    if (p === '/auth/v1/token') return json(session);
    if (p === '/auth/v1/user') return json(user);
    if (p === '/functions/v1/get-my-access') return json(paid
      ? { email: user.email, plan_status: 'annual', payment_status: 'paid', access_active: true, access_expires_at: new Date(Date.now() + 864e5 * 30).toISOString(), user_id: 'u1' }
      : { email: user.email, plan_status: 'free', payment_status: 'unpaid', access_active: false, free_question_available: true, user_id: 'u1' });
    if (p === '/functions/v1/chapter-video') {
      const { chapter } = JSON.parse(req.postData() || '{}');
      if (videoStatus !== 200) return json({ error: 'This video is not available yet.' }, videoStatus);
      return json({ url: `https://videos.example/gita-chapter-${chapter}.mp4?X-Amz-Signature=test`, expires_in: 10800 });
    }
    return json([]);
  });
  await ctx.route(/videos\.example|facebook|fonts\.g/, r => r.fulfill({ status: 204, body: '' }));
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/'); await p.waitForTimeout(700);
  return { ctx, p, S, errs };
}
const videoCalls = S => S.calls.filter(c => c.p === '/functions/v1/chapter-video');
const screen = p => p.evaluate(() => document.querySelector('.screen.active')?.id);

console.log('\n# Visitor (not a member)');
{ const { ctx, p, S, errs } = await open({ paid: false, signedIn: false });
  await p.evaluate(() => showChapterPage(2)); await p.waitForTimeout(200);
  ok(await p.isVisible('#chapterVideo .chapter-video-poster'), 'the chapter page shows the explainer video card');
  ok((await p.textContent('#chapterVideo')).includes('For members') && (await p.textContent('#chapterVideo .cv-play')).includes('🔒'), 'chapter 2 is marked for members');
  ok(!(await p.textContent('#chapterVideo')).includes('Spiritual Point'), 'the card carries Gita Verse branding only (no third-party credit)');
  ok((await p.getAttribute('#chapterVideo .chapter-video-poster', 'style')).includes('poster-2.webp'), 'the card shows a still from that chapter');
  await p.click('#chapterVideo .chapter-video-poster'); await p.waitForTimeout(300);
  ok((await screen(p)) === 'offerScreen' && !videoCalls(S).length, 'tapping a members-only video opens the plans, without asking for the video', await screen(p));
  await p.evaluate(() => showChapterPage(1)); await p.waitForTimeout(200);
  ok((await p.textContent('#chapterVideo')).includes('Animated video') && (await p.textContent('#chapterVideo')).includes('6:58'), 'chapter 1 is free and shows its length');
  await p.click('#chapterVideo .chapter-video-poster'); await p.waitForSelector('#chapterVideo video', { timeout: 4000 }).catch(() => {});
  const [call] = videoCalls(S);
  ok(call && JSON.parse(call.body).chapter === 1 && !call.auth, 'chapter 1 plays without signing in', JSON.stringify(call));
  ok((await p.getAttribute('#chapterVideo video', 'src') || '').includes('gita-chapter-1.mp4'), 'the video player loads the private link');
  ok(await p.evaluate(() => { const v = document.querySelector('#chapterVideo video'); return v.controls && v.playsInline; }), 'the player has controls and plays inline on phones');
  await p.evaluate(() => showScreen('home')); await p.evaluate(() => showChapterPage(1)); await p.waitForTimeout(100);
  ok(await p.isVisible('#chapterVideo'), 'returning to the chapter keeps the video card');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Member');
{ const { ctx, p, S, errs } = await open({ paid: true });
  await p.evaluate(() => showChapterPage(5)); await p.waitForTimeout(200);
  ok((await p.textContent('#chapterVideo .cv-play')).includes('▶') && (await p.textContent('#chapterVideo')).includes('7:20'), 'members can play every chapter');
  await p.click('#chapterVideo .chapter-video-poster'); await p.waitForSelector('#chapterVideo video', { timeout: 4000 }).catch(() => {});
  const [call] = videoCalls(S);
  ok(call && JSON.parse(call.body).chapter === 5 && call.auth === 'Bearer tok_u1', 'the video request carries the member login', JSON.stringify(call));
  ok((await p.getAttribute('#chapterVideo video', 'src') || '').includes('gita-chapter-5.mp4'), 'chapter 5 video loads');
  await p.evaluate(() => showChapterPage(6)); await p.waitForTimeout(100);
  ok(!(await p.isVisible('#chapterVideo video')) && (await p.getAttribute('#chapterVideo .chapter-video-poster', 'style')).includes('poster-6.webp'), 'another chapter shows its own video card');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Video not available');
{ const { ctx, p, errs } = await open({ paid: true, videoStatus: 503 });
  await p.evaluate(() => showChapterPage(3)); await p.waitForTimeout(200);
  await p.click('#chapterVideo .chapter-video-poster'); await p.waitForTimeout(600);
  ok((await p.textContent('#toast')).includes('not available yet') && await p.isVisible('#chapterVideo .chapter-video-poster'), 'a missing video is explained and the card stays', await p.textContent('#toast'));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }
await b.close();
