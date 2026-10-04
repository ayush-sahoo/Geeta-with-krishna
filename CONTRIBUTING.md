# Contributing

## Workflow

1. Branch from `main`.
2. Make the change, with tests for new behaviour (`tests/*.cjs` for logic, `tests/e2e/` for user journeys).
3. Run the tests locally (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#tests)).
4. Open a pull request. Say what changed, why, and how you tested it. GitHub Actions runs the unit and browser tests; both must pass.
5. Merge to `main`. Vercel deploys the website to production within about a minute.

Edge functions and database migrations are **not** deployed by merging. Deploy them separately (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#edge-functions)), and commit the code and migration files in the same pull request so the repo always matches what is live.

## Before merging, check

- **Meta tracking:** did you rename, remove or add a Meta Pixel event, or touch the pixel snippet in `index.html`? The ad campaign is optimised on these events; read [docs/TRACKING.md](docs/TRACKING.md) first.
- **In-app browsers:** most visitors arrive from Instagram and Facebook ads. Sign-in and Ask Krishna must work inside those apps' browsers and on iPhone Safari (`tests/e2e/phone.mjs` and `inapp.mjs` cover this).
- **Price or plan:** prices are set once (`PLANS`) in `supabase/functions/_shared/server.ts`, but the ₹1,000 text and the Meta event value also appear in the site and the policy pages (see [docs/OPERATIONS.md](docs/OPERATIONS.md#common-tasks)).
- **Secrets:** no API keys, tokens or passwords in code, commits or pull requests. The Supabase publishable key in `app.js` is public by design.
- **Database:** new tables have row-level security on; user writes go through `security definer` functions with their own checks.
- **User data:** questions people ask Krishna are never sent to analytics or Meta. Signed-in users' conversations are saved to their own account (`chat_threads` / `chat_messages`, readable only by that user); any change to what is stored must be reflected in the privacy policy (`tools/build_legal_pages.py`).

## Style

- Plain browser JavaScript in the website, TypeScript (Deno) in edge functions. Match the surrounding code.
- Comments explain *why*, not what.
- Keep changes focused: one purpose per pull request.
