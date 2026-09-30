# Development

## Requirements

- Node.js 22.13 or newer (the unit tests use `node:module`'s `stripTypeScriptTypes`). CI uses Node 24.
- Python 3 (for a quick static server and the legal-page generator).
- For backend work: the [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase …` works) and access to project `bkwvuckznpaawmqrjjgk`.

## Run the site locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

There is no build step. The page talks to the **live** Supabase project with its public (publishable) key, so signing in, asking Krishna and paying use real data and real providers. Use your own test account (see OPERATIONS.md) and avoid real payments.

`/api/geo` only exists on Vercel; locally the visit is logged without a city.

## Tests

```bash
# Unit tests: chat, languages, narration, translation logic (no network)
node --test tests/*.cjs

# Browser tests: visitor/buyer journeys, mobile OTP in every Meta placement
# browser, in-app browsers, admin dashboard and login, engagement tracking.
cd tests/e2e
npm ci
npx playwright install chromium   # or set CHROMIUM_PATH to an existing Chromium
node run.mjs
```

The browser tests simulate Supabase, Razorpay and the Meta Pixel with Playwright route handlers; nothing touches production. `run.mjs` serves the repo root on a random port and runs `journeys.mjs`, `phone.mjs`, `inapp.mjs`, `admin.mjs` and `login.mjs`. Screenshots go to `OUT_DIR` (a temp folder by default).

GitHub Actions (`.github/workflows/tests.yml`) runs both sets on every pull request and on pushes to `main`.

Some unit tests load pieces of `app.js` by slicing between two function names (for example from `const CLIP_LIMITS=` to `async function speak(`). If you rename or move one of those functions, update the slice in `tests/*.cjs`.

## Making changes

### Website (`index.html`, `app.js`, `admin.html`)

- Plain browser JavaScript, no framework or bundler. Match the surrounding style.
- Every screen change must keep working inside the Instagram/Facebook in-app browsers and on iPhone Safari. The browser tests cover the main journeys; add a check when you add a flow.
- Don't change Meta Pixel event names or the pixel snippet without reading `docs/TRACKING.md`: the ad campaign is optimised on these events.
- Merging to `main` deploys to production on Vercel within about a minute.

### Policy pages

Edit `tools/build_legal_pages.py` (content, `EMAIL`, dates in `UPDATED` / `UPDATED_ON`), then run:

```bash
python3 tools/build_legal_pages.py
```

Commit the regenerated `*.html` files with the script.

### Edge functions

Code is in `supabase/functions/<name>/index.ts`, shared code in `supabase/functions/_shared/`. The price and Gemini model are set once in `_shared/server.ts`.

Type-check before deploying:

```bash
cd supabase/functions
npx deno check --no-lock <name>/index.ts
```

Deploy one function:

```bash
npx supabase functions deploy <name> --project-ref bkwvuckznpaawmqrjjgk --use-api
```

`supabase/config.toml` keeps `verify_jwt = false` for every function. This is required: the functions check the caller themselves, and some are called without a user login (Razorpay's webhook, the Auth SMS hook, the translation worker). Deploying with JWT verification on would break payments and phone sign-in.

After deploying, call the function without a login and check you get its own 401/403 message (not a gateway error).

Secrets are set in the Supabase dashboard (Edge Functions → Secrets), never in the repo:

| Secret | Used by |
| --- | --- |
| `GEMINI_API_KEY` | ask-krishna, tts-krishna, translation-worker |
| `ELEVENLABS_API_KEY` | tts-krishna |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | create-payment-link (must be `rzp_live_…`) |
| `RAZORPAY_WEBHOOK_SECRET` | razorpay-webhook |
| `SEND_SMS_HOOK_SECRET`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | send-sms |
| `ADMIN_EMAILS`, `ADMIN_USER_IDS`, `TEST_USER_IDS` (optional) | admin-stats (override the defaults in code) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and the server key are provided by Supabase automatically.

### Database migrations

Migrations live in `supabase/migrations/` and are named after the version the database recorded when they were applied, so the repo matches `supabase_migrations.schema_migrations` exactly.

1. Write the SQL (idempotent where practical: `create or replace`, `if not exists`).
2. Apply it (Supabase dashboard SQL editor, `npx supabase db push`, or the Supabase MCP `apply_migration`).
3. Look up the version it was given:
   ```sql
   select version, name from supabase_migrations.schema_migrations order by version desc limit 1;
   ```
4. Save the file as `supabase/migrations/<version>_<name>.sql` and commit it with the code that needs it.

Tables must have row-level security on. Anything that writes on behalf of users goes through a `security definer` function with its own checks (see `log_event`, `claim_free_question`).

### Adding a language

Add it to both `languages.js` and `supabase/functions/_shared/languages.ts` (the unit tests check they match), then redeploy `ask-krishna`, `tts-krishna` and `translation-worker`.

### Changing verse-page text pieces

The lens, reflection and "apply today" texts in `app.js` are translated ahead of time. After changing them, register the new pieces:

```bash
node tools/translation_sources.mjs > pieces.sql   # run pieces.sql in Supabase
```

then run the translation worker (OPERATIONS.md).
