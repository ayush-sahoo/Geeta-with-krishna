# Operations runbook

## Services and where they're managed

| Service | Used for | Managed at |
| --- | --- | --- |
| Vercel (project `geeta-with-krishna`) | Hosting gitaverse.co.in; deploys every push to `main` | vercel.com |
| Supabase (`bkwvuckznpaawmqrjjgk`, Mumbai) | Database, Auth, edge functions, secrets | supabase.com dashboard |
| Razorpay (live keys) | ₹1,000 Annual Access payments; webhook → `razorpay-webhook` | Razorpay dashboard |
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
- **Payments:** `payment_transactions` has one row per checkout started (`payment_link_id` holds the Razorpay order id `order_…` for the on-site checkout, or the link id `plink_…` for the fallback), updated to `paid` by the webhook. The Razorpay webhook must have `order.paid` and `payment_link.paid` ticked. A paid Razorpay payment with no `paid` row means the webhook failed: check `razorpay-webhook` logs and the webhook secret.
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
| Change the price | `ANNUAL_PRICE_PAISE` in `supabase/functions/_shared/server.ts`, then redeploy `create-payment-link` and `razorpay-webhook`. Update the ₹1,000 text in `index.html`/`app.js`, the Meta `annualEvent` value in `app.js`, and the policy pages. |
| Change the Gemini model | `GEMINI_MODEL` in `_shared/server.ts`, then redeploy `ask-krishna`, `tts-krishna` and `translation-worker`. |
| Grant or extend someone's access by hand | Update their `user_accounts` row (`plan_status='annual'`, `payment_status='paid'`, `access_expires_at`) in the SQL editor, and note why. |
| Roll back the website | Vercel → Deployments → pick the previous production deployment → Promote. |
| Roll back an edge function | Redeploy it from the previous commit (`git checkout <sha> -- supabase/functions/<name>` then deploy). |

## Atomic payment processing

`razorpay-webhook` calls the server-only `apply_annual_payment` RPC. It locks the account row, deduplicates payments, and records the transaction and annual entitlement together. Database failures return HTTP 500 so Razorpay can retry. Apply migration `20260930164133_atomic_annual_payment.sql` before deploying the webhook. `tests/annual-payment.sql` tests renewals and duplicate deliveries on the test account inside a rolled-back transaction.
