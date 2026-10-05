# Operations runbook

## Services and where they're managed

| Service | Used for | Managed at |
| --- | --- | --- |
| Vercel (project `geeta-with-krishna`) | Hosting gitaverse.co.in; deploys every push to `main` | vercel.com |
| Supabase (`bkwvuckznpaawmqrjjgk`, Mumbai) | Database, Auth, edge functions, secrets | supabase.com dashboard |
| Razorpay (live keys) | ₹999 Annual Access and ₹399 3-Month Access payments; webhook → `razorpay-webhook` | Razorpay dashboard |
| Google Gemini | Ask Krishna replies, translations | Google AI Studio |
| ElevenLabs | Verse narration | elevenlabs.io |
| MSG91 | Sign-in OTP SMS (DLT template) | msg91.com (keep the wallet topped up) |
| Meta | Ads, Pixel `2178415463100322` | Events Manager / Ads Manager |

Support email shown to users: support@edumorph.in.

## Admin dashboard

`https://gitaverse.co.in/admin.html`. It has its own login, separate from the main site. Access requires **both** the admin email and the admin account id pinned in `supabase/functions/admin-stats/index.ts` (`DEFAULT_ADMINS`, `DEFAULT_ADMIN_IDS`, or the `ADMIN_EMAILS` / `ADMIN_USER_IDS` secrets).

The owner's test accounts are listed with a "Test" label and excluded from funnel counts. To add one, append its user id to `DEFAULT_TEST_USERS` in the same file and redeploy `admin-stats`.

## Checking health

- **Function errors:** Supabase dashboard → Edge Functions → the function → Logs. Provider problems are logged as `ElevenLabs error <status>`, `Gemini error <status>`, `MSG91 rejected the SMS: …`, `Razorpay link creation failed …`.
- **Phone sign-in:** Auth logs show `/otp` (code requested) and `/verify` (code entered). An SMS that never arrives usually means an empty MSG91 wallet or a template problem; the `send-sms` logs say which.
- **Payments:** `payment_transactions` has one row per checkout started (`payment_link_id` holds the Razorpay order id `order_…` for the on-site checkout, or the link id `plink_…` for the fallback), updated to `paid` by the webhook. The Razorpay webhook must have `order.paid` and `payment_link.paid` ticked. A buyer who retries within 30 minutes (orders) or 50 minutes (links, while Razorpay still shows them unpaid) gets the same checkout back instead of a new payable one; `user_accounts.checkout_lease_until` holds a 20-second per-account lease while one is being created (`claim_checkout_lease` / `release_checkout_lease`). A paid Razorpay payment with no `paid` row means the webhook failed: check `razorpay-webhook` logs and the webhook secret. If a new order or link can't be recorded in `payment_transactions` (one retry), it is not handed to the buyer; they see "Could not start payment" and try again.
- **Server-side Meta Purchase (Conversions API):** off until the `META_CAPI_TOKEN` edge-function secret is set (Supabase → Edge Functions → Secrets; token from Meta Events Manager → the pixel → Settings → Conversions API → Generate access token). Then `razorpay-webhook` also reports each new payment to Meta with the pixel's event id (`gita_purchase_<payment id>`), so Meta counts it once even when the buyer never returns to the site. Check it under Events Manager → Purchase → "Server". Each paid row in `payment_transactions` records the delivery (`meta_sent_at`, `meta_attempts`, `meta_last_error`, `meta_next_try_at`). A rejected or timed-out send is retried by the webhook on a repeat delivery and by the `meta-purchase-retry` function, which the pg_cron job `meta-purchase-retry` calls every 10 minutes with the vault secret `meta_retry_token` (back-off 5 min doubling to 6 h, up to 12 attempts, within 6 days because Meta takes events up to 7 days old). Failures never affect the payment. Anything still pending:

  ```sql
  select payment_id, paid_at, meta_attempts, meta_last_error, meta_next_try_at
  from payment_transactions where status = 'paid' and meta_sent_at is null order by paid_at desc;
  ```
- **Failed or abandoned payments:** `payment_events` has one row per verified Razorpay webhook event (`payment.failed`, `payment_link.paid`, etc.) with the method, status and Razorpay's error reason; it holds no card, bank or UPI ID details, only the last 4 digits of the payer's phone. Which events arrive depends on what is ticked in Razorpay → Webhooks. For example:

  ```sql
  select received_at, event, status, method, contact_last4, error_reason, error_description
  from payment_events order by received_at desc limit 50;
  ```

## Translation worker

Stored translations of the verse text make other languages appear instantly. The worker translates whatever is missing, a few languages per run, in the background. Start a run from the Supabase SQL editor:

```sql
select net.http_post(
  url := 'https://bkwvuckznpaawmqrjjgk.supabase.co/functions/v1/translation-worker',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-worker-token', (select decrypted_secret from vault.decrypted_secrets where name = 'translation_worker_token')
  ),
  body := '{}'::jsonb   -- or '{"languages": ["hi", "ta"]}'
);
```

Each run works for about 90 seconds. Check what is left, then start another run if needed:

```sql
select * from public.translation_missing(array['hi','bn','mr','ta','te','gu','kn','ml','pa','ur','as','ne','sd']);
```

(Pass the language codes to check; `missing` is how many verse-text pieces still need translating.)

There is no automatic schedule; runs are started by hand. The 13 Indian languages are fully translated. Other languages are translated on first use and saved.

## Common tasks

| Task | How |
| --- | --- |
| Add or change website text | Add the exact English string to `supabase/functions/_shared/ui-strings.json`, bump `revision` in `website-language/index.ts` and deploy it (with the `_shared` files). Call `website-language?language=<code>` once per language (e.g. `net.http_get` from SQL); only new strings are translated, saved ones are reused. Copy the new keys from `website_locales` into `locales/*.json`, which the site loads first. `tests/website-language.cjs` fails if offer-screen text is missing. |
| Change a price | `PLANS` in `supabase/functions/_shared/server.ts`, then redeploy `create-payment-link` and `razorpay-webhook`, and change the amount → length mapping in `apply_annual_payment` (a migration). Update the price text in `index.html`/`app.js` (plan cards, `OFFER_PLANS`), the Meta `annualEvent`/`quarterlyEvent` values and `paidPlan()` in `app.js`, and the policy pages. |
| Change the Gemini model | `GEMINI_MODEL` in `_shared/server.ts`, then redeploy `ask-krishna`, `tts-krishna`, `website-language` and `translation-worker`. Currently Flash-Lite: answers in about 2 s with no thinking tokens. |
| Grant or extend someone's access by hand | Update their `user_accounts` row (`plan_status='annual'`, `payment_status='paid'`, `access_expires_at`) in the SQL editor, and note why. |
| Roll back the website | Vercel → Deployments → pick the previous production deployment → Promote. |
| Roll back an edge function | Redeploy it from the previous commit (`git checkout <sha> -- supabase/functions/<name>` then deploy). |

## Atomic payment processing

`razorpay-webhook` calls the server-only `apply_annual_payment` RPC. It locks the account row, deduplicates payments, and records the transaction and annual entitlement together. Database failures return HTTP 500 so Razorpay can retry. Apply migration `20260930164133_atomic_annual_payment.sql` before deploying the webhook. `tests/annual-payment.sql` tests renewals and duplicate deliveries on the test account inside a rolled-back transaction.
