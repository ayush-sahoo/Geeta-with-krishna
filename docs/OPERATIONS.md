# Operations runbook

## Services and where they're managed

| Service | Used for | Managed at |
| --- | --- | --- |
| Vercel (project `geeta-with-krishna`) | Hosting gitaverse.co.in; deploys every push to `main` | vercel.com |
| Supabase (`bkwvuckznpaawmqrjjgk`, Mumbai) | Database, Auth, edge functions, secrets | supabase.com dashboard |
| Razorpay (live keys) | ₹499 Annual Access and ₹149 1-Month Access payments; webhook → `razorpay-webhook` | Razorpay dashboard |
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

## Chapter videos

Each chapter page has an animated explainer video (from Spiritual Point's "Bhagavad Gita: The Ultimate Guide To Life", licensed by the owner from the channel, with their agreement to rebrand: the channel's corner logo is replaced by a Gita Verse badge and the channel-logo shot near the end of chapter 18 is replaced by a hold on the preceding frame, the "Presented by" card in the first 0.3 s of chapter 1 is cut, and the YouTube calls to action in the last part of chapter 18 ("कमेंट में लिखें", "लाइक करें, शेयर करें") are cut with a short dissolve; the rest of the narration is unchanged). Chapter 1 plays for everyone; chapters 2-18 for members, others see a lock that opens the plans.

- **Files.** Each chapter (cut from the creator's video at its title card) is split into short parts of about 1-1.5 minutes, 131 MP4s in all (720p, H.264, AAC, `+faststart`), named `gita-chapter-N-part-K.mp4`, in the private Cloudflare R2 bucket `gita-chapter-videos`. Parts are cut only in pauses in the narration (at least 0.75 s, found with a speech detector), preferring the long musical pauses where the scene also changes, with a short fade at each join. Parts per chapter: `CHAPTER_VIDEO_PARTS` in `app.js` and `PARTS` in the `chapter-video` function, which must match. The page lists the part numbers under the video and plays each part on into the next. The player hides the browser's download button (`controlsList="nodownload"`) and long-press menu; links expire after 3 hours, though a determined member could still save a part with other tools. Posters: `assets/chapter-video/poster-N.webp`. The Gita Verse badge (244×120 at 1080p) is overlaid at x 1670, y 956, over the channel logo (x 1681-1899, y 967-1061). Lengths shown on the card: `CHAPTER_VIDEO_LENGTH` in `app.js`.
- **Access.** The `chapter-video` edge function checks access (chapter 1 free, others need active paid access) and returns signed R2 links to all parts of the chapter that work for 3 hours. R2 has no download charges, so the videos never use Supabase's bandwidth.
- **Secrets** (Supabase → Edge Functions → Secrets): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (an R2 API token with Object Read on the bucket), optional `R2_BUCKET`. Until they are set, the card says the video is not available yet.
- **Replacing a video.** Upload a file with the same name to the bucket; no deploy needed (unless the number of parts changes). Plays are counted as `chapter_video_play`.

## Talking Krishna

**Talk to Krishna (voice to voice).** The Ask Krishna screen has two sections: *Chat with Krishna* (the text chat) and *Talk to Krishna*. In Talk, a paid member taps the mic and speaks; recording stops after 1.3 s of quiet (or a second tap, or 30 s). One `ask-krishna` call (with `audio_base64`) turns the recording into text (ElevenLabs Scribe, which also names the spoken language), answers with a short spoken-style reply (under about 90 words) in the chat language if one is chosen, otherwise in the language spoken, and voices the first sentence. Krishna's portrait starts on that sentence (about 2 s of voicing instead of about 10 s for a whole reply) while the app voices the rest through `tts-krishna`, at most two requests at a time. Opening Talk, and tapping the mic, wake both functions up in advance (`{warm:true}`) so the turn doesn't wait for a sleeping function. Tapping the mic while he speaks interrupts him. Each spoken turn is also added to the text chat and saved with the conversation. Free members see the portrait and a "See plans" card instead of the mic. Each turn costs one speech-to-text and the same total voice characters at ElevenLabs as before (split into sentence pieces), plus the usual Gemini answer. ElevenLabs allows only a few requests at once per account; when it answers "too many" (429), the functions wait and retry (`_shared/voice.ts`). Sentence pieces are voiced separately (the v3 voice model does not accept surrounding text), split the same way in `app.js` and `_shared/voice.ts` (`speechChunks`; `tests/voice-chunks.cjs` checks they match). Counted as `talk_open` (first open per visit) and `talk_turn`.

**Hear Krishna say this.** Paid members see **▶ Hear Krishna say this** on each new Ask Krishna answer. It opens Krishna's portrait (`assets/krishna-avatar.webp`, cut from the original 1254 px painting at x 250, y 120, 800 px square), which speaks the answer's paragraphs and closing question (verse references are not read out). `tts-krishna` makes the voice with `timestamps: true`, using the same ElevenLabs voice as verse meanings, so each tap of a new answer costs one ElevenLabs request; hearing the same answer again reuses it. Language: the chat language if one is chosen; for "Auto", Devanagari → Hindi, Hinglish → Hindi voice, otherwise English.

The mouth follows the letters (Devanagari rules, which also cover Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada and Malayalam; simple rules for English and Urdu) and the loudness of the voice for everything else. The face landmarks (lip line, mouth corners, eyelids) in `krishna-avatar.js` are pixel positions in the original painting, so a different portrait needs new landmarks. Taps are counted as the `hear_krishna` event.

## Android app (Google Play)

The Play Store app is a Trusted Web Activity: it opens https://gitaverse.co.in in Chrome, full-screen, so it always shows the live site (payments, Ask Krishna, languages) and needs no update when the site changes. Package `com.ayushsahoo.gitawithkrishna`; project in `android/` (generated with Bubblewrap; settings in `android/twa-manifest.json`). It opens `/?utm_source=android_app`, so app visits show up as their own source in the admin dashboard. That parameter also switches the site to an **app layout** (`html.app-mode`, set by a small script in `index.html`): bottom tabs (Home, Ask Krishna, Explore Gita, Account) instead of the top menu, and the phone's back button steps back through screens. The website itself is unchanged; add `?app=1` to any URL to preview the app layout in a browser.

- **Full-screen check.** Android hides the browser bar only if `/.well-known/assetlinks.json` lists the SHA-256 fingerprint of the key that signs the installed app: the upload key (in the file now) and, once Play Console has created it, the **app signing key** (Play Console → Test and release → App integrity → App signing). Add that fingerprint to the same list and deploy the site; without it, Play installs show a URL bar.
- **App-only features** (version 1.0.2 on):
  - **Verse of the day notification**, every morning at about 7 (`DailyVerse.java`). It fetches the same verse as the home page (`get_daily_verse`, with the public key), shows the Sanskrit line and English meaning, and opens `?open=verse` when tapped. It falls back to "Your verse for today is ready" without a connection. On Android 13 and later the app asks for notification permission once, on first launch. The alarm is set again when the app starts and after a phone restart. Users can turn it off in Android's app notification settings (channel "Verse of the day").
  - **Long-press shortcuts** on the app icon: Ask Krishna, Talk to Krishna and Today's verse (`?open=ask`, `?open=talk`, `?open=verse`). They are listed in `twaManifest.shortcuts` in `android/app/build.gradle`, which writes `res/xml/shortcuts.xml` on every build; icons are in `res/drawable`.
  - **Offline screen** (website, so it also works for the app): `sw.js` shows `offline.html` instead of the browser's error when a page opens without internet. It shows the last verse of the day the phone saw and reloads by itself when the connection is back. Only `offline.html` and its logo are cached, so the site is never stale.
  - **Always Chrome** (1.0.3 on): the app opens the site in Chrome when it is installed, even if another browser is the default. Samsung Internet's dark mode recolours the site; Chrome respects its light-only design (`color-scheme: only light`).
  - The Android project has hand-written code (`DailyVerse.java`, `LauncherActivity.java`, `Application.java`, the manifest). Don't regenerate it with `bubblewrap update`, which would overwrite it.
- **Upload key.** `gitaverse-upload.jks` (alias `upload`) is kept by the owner, never in this repo. Play App Signing holds the real signing key, so a lost upload key can be reset from Play Console.
- **New version.** Raise `versionCode` (and `versionName`) in `android/app/build.gradle`, then with the Android SDK installed (`sdk.dir` in `android/local.properties`): `cd android && ./gradlew bundleRelease`, sign `app/build/outputs/bundle/release/app-release.aab` with `jarsigner -keystore gitaverse-upload.jks … upload`, and upload it. A new version is only needed for app-level changes (name, icon, colours, Android settings), not for website changes.

## Common tasks

| Task | How |
| --- | --- |
| Add or change website text | Add the exact English string to `supabase/functions/_shared/ui-strings.json`, bump `revision` in `website-language/index.ts` and deploy it (with the `_shared` files). Call `website-language?language=<code>` once per language (e.g. `net.http_get` from SQL); only new strings are translated, saved ones are reused. Copy the new keys from `website_locales` into `locales/*.json`, which the site loads first. `tests/website-language.cjs` fails if offer-screen text is missing. |
| Change a price | `PLANS` in `supabase/functions/_shared/server.ts`, then redeploy `create-payment-link` and `razorpay-webhook`, and change the amount → length mapping in `apply_annual_payment` (a migration). Update the price text in `index.html`/`app.js` (plan cards, `OFFER_PLANS`), the Meta `annualEvent`/`monthlyEvent` values and `paidPlan()` in `app.js`, and the policy pages. |
| Change the Gemini model | `GEMINI_MODEL` in `_shared/server.ts`, then redeploy `ask-krishna`, `tts-krishna`, `website-language` and `translation-worker`. Currently Flash-Lite: answers in about 2 s with no thinking tokens. |
| Grant or extend someone's access by hand | Update their `user_accounts` row (`plan_status='annual'`, `payment_status='paid'`, `access_expires_at`) in the SQL editor, and note why. |
| Roll back the website | Vercel → Deployments → pick the previous production deployment → Promote. |
| Roll back an edge function | Redeploy it from the previous commit (`git checkout <sha> -- supabase/functions/<name>` then deploy). |

## Atomic payment processing

`razorpay-webhook` calls the server-only `apply_annual_payment` RPC. It locks the account row, deduplicates payments, and records the transaction and annual entitlement together. Database failures return HTTP 500 so Razorpay can retry. Apply migration `20260930164133_atomic_annual_payment.sql` before deploying the webhook. `tests/annual-payment.sql` tests renewals and duplicate deliveries on the test account inside a rolled-back transaction.

## Voice reliability and usage budget

Apply the voice_limits_and_plan_views migration BEFORE deploying ask-krishna, tts-krishna and the frontend. Missing quota RPC fails closed with HTTP 503. No production migration is applied by this PR.

Voice usage is reserved atomically per verified account across both endpoints: 40 requests per rolling one-minute window anchored at the first reservation, 600 per UTC day, and 120,000 text units per UTC day. TTS reserves input character count; transcription/Talk reserves 1,500 units (including its initial sentence). Failed provider calls still consume the reservation to prevent retry abuse. Cached browser replay spends no new credits. Limits return HTTP 429 with a retry message. This bounds usage, rather than promising unlimited audio.

Saved answers regain replay buttons for paid members. Legacy saved text includes titles/actions; replay reads the saved answer text. The overlay uses a browser-history entry so Android Back closes it first. Interrupted sentence queues show an explicit error.
