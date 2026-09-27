#!/usr/bin/env node
// Stress test: simulate N visitors loading the public site (what an anonymous
// first-time visitor downloads). No dependencies; Node 22+.
//
//   node loadtest/stress.mjs                       # 10,000 users, 500 at a time
//   USERS=2000 CONCURRENCY=200 node loadtest/stress.mjs
//   BASE_URL=https://<preview>.vercel.app BYPASS=<secret> node loadtest/stress.mjs
//
// Env:
//   BASE_URL     site to test (default: production)
//   USERS        total simulated visitors (default 10000)
//   CONCURRENCY  visitors in flight at once (default 500)
//   RAMP_SEC     seconds to ramp up to full concurrency (default 30)
//   ASSETS       "full" (page + all first-load assets) or "page" (HTML only)
//   BYPASS       Vercel protection-bypass secret for protected preview URLs
//   TIMEOUT_MS   per-request timeout (default 15000)

const BASE_URL = (process.env.BASE_URL || 'https://geeta-with-krishna.vercel.app').replace(/\/$/, '');
const USERS = Number(process.env.USERS || 10000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 500);
const RAMP_SEC = Number(process.env.RAMP_SEC || 30);
const ASSETS = process.env.ASSETS || 'full';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);

// Everything a first visit downloads (see index.html / app.js). The ambient
// MP3 is excluded: it only loads when a signed-in user plays narration.
const FIRST_VISIT = [
  '/',
  '/app.js',
  '/connected.css',
  '/assets/krishna-hero.webp',
  ...[1, 2, 3, 4, 5, 6].map((n) => `/assets/chapter-art-${n}.webp`),
];
const PATHS = ASSETS === 'page' ? ['/'] : FIRST_VISIT;

const headers = { 'user-agent': 'gita-verse-loadtest/1.0', 'accept-encoding': 'gzip, br' };
if (process.env.BYPASS) headers['x-vercel-protection-bypass'] = process.env.BYPASS;

const latencies = { request: [], visit: [] };
const statuses = new Map();
const errors = new Map();
let bytes = 0, requests = 0, visitsOk = 0, visitsFailed = 0, done = 0;

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

async function get(path) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE_URL + path, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.arrayBuffer();
    bytes += body.byteLength;
    bump(statuses, res.status);
    return res.ok;
  } catch (e) {
    bump(errors, e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message));
    return false;
  } finally {
    requests++;
    latencies.request.push(performance.now() - t0);
  }
}

// A browser fetches the HTML first, then its subresources in parallel.
async function visit() {
  const t0 = performance.now();
  const htmlOk = await get(PATHS[0]);
  const rest = await Promise.all(PATHS.slice(1).map(get));
  latencies.visit.push(performance.now() - t0);
  htmlOk && rest.every(Boolean) ? visitsOk++ : visitsFailed++;
  done++;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const ms = (v) => `${Math.round(v)} ms`;

async function main() {
  console.log(`Target:      ${BASE_URL}`);
  console.log(`Visitors:    ${USERS} (${PATHS.length} requests each, ${USERS * PATHS.length} total)`);
  console.log(`Concurrency: ${CONCURRENCY} visitors, ramp ${RAMP_SEC}s\n`);

  const start = performance.now();
  let next = 0;
  const progress = setInterval(() => {
    const sec = (performance.now() - start) / 1000;
    console.log(`  ${sec.toFixed(0).padStart(4)}s  visits ${done}/${USERS}  req/s ${(requests / sec).toFixed(0)}  errors ${visitsFailed}`);
  }, 5000);

  // Each worker loops pulling visits; workers start staggered over RAMP_SEC.
  const worker = async (i) => {
    await new Promise((r) => setTimeout(r, (RAMP_SEC * 1000 * i) / CONCURRENCY));
    while (next < USERS) { next++; await visit(); }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, USERS) }, (_, i) => worker(i)));
  clearInterval(progress);

  const sec = (performance.now() - start) / 1000;
  const r = latencies.request, v = latencies.visit;
  console.log('\n=== Results ===');
  console.log(`Duration:        ${sec.toFixed(1)} s`);
  console.log(`Visits:          ${visitsOk} ok, ${visitsFailed} failed (${((visitsFailed / USERS) * 100).toFixed(2)}% error rate)`);
  console.log(`Requests:        ${requests} (${(requests / sec).toFixed(0)} req/s)`);
  console.log(`Data received:   ${(bytes / 1e9).toFixed(2)} GB`);
  console.log(`Request latency: p50 ${ms(pct(r, 50))}  p95 ${ms(pct(r, 95))}  p99 ${ms(pct(r, 99))}  max ${ms(pct(r, 100))}`);
  console.log(`Full page load:  p50 ${ms(pct(v, 50))}  p95 ${ms(pct(v, 95))}  p99 ${ms(pct(v, 99))}  max ${ms(pct(v, 100))}`);
  console.log(`Status codes:    ${[...statuses].map(([k, n]) => `${k}×${n}`).join('  ') || 'none'}`);
  if (errors.size) console.log(`Errors:          ${[...errors].map(([k, n]) => `${k}×${n}`).join('  ')}`);
}

main();
