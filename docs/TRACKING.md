# Tracking and attribution

The site measures ads in two independent ways: the **Meta Pixel** (what Meta optimises the campaign on) and **first-party analytics** in our own database (what the admin dashboard shows). Keep them separate: first-party events are never sent to Meta.

Never send a user's questions, answers, passwords or tokens to either system.

## Meta Pixel (id `2178415463100322`)

Loaded in `index.html`. The campaign is optimised for **Purchase**; don't rename or remove the standard events below.

| Event | Type | When | Notes |
| --- | --- | --- | --- |
| `PageView` | standard | Every page load | From `index.html`. |
| `CompleteRegistration` | standard | A new account's first sign-in (email, Google or phone) | `trackNewAccount`. eventID `gita_reg_<user id>`, `registration_method`, fires once per account (localStorage guard). Phone sign-ups count from `phone_confirmed_at`, because the account is created when the OTP is requested. |
| `InitiateCheckout` | standard | Before redirecting to Razorpay | ₹1,000 INR. |
| `Purchase` | standard | Access confirmed after returning from Razorpay | `trackConfirmedPurchase`. eventID `gita_purchase_<payment id>`, fires once per payment. |
| `ViewContent` | standard | Opening a verse | |
| `Login`, `ScreenView`, `AskKrishnaUsed`, `CheckoutClick`, `CheckoutError`, `SaveVerse`, `RegistrationSubmitted`, `GoogleBlockedInApp`, `OpenInBrowser`, `OpenedFromInApp` | custom | As named | Diagnostics only. |

**Advanced matching.** When someone is signed in, the pixel is initialised with `{external_id, em | ph}`. The pixel hashes these (SHA-256) in the browser. `index.html` does this on page load for a stored session; `setMetaUser` in `app.js` does it when someone signs in during the visit. The privacy policy describes this.

## First-party analytics

Anonymous visitor id: `gitaVisitorId` in localStorage.

**Visits.** `log_visit` records one row per page load in `site_visits`: path, referrer, UTM tags, whether `fbclid` was present, the in-app browser (`Instagram`, `Facebook`, `Messenger`, `Threads`), device, country, region and city (from `/api/geo`).

**Events.** `log_event` records rows in `site_events`. It only accepts these names; to add one, update the allowlist with a migration.

| Event | Meaning |
| --- | --- |
| `signin_start`, `google_click`, `google_blocked_in_app`, `open_in_browser` | Sign-in attempts |
| `signup`, `login` | Account created / signed in |
| `ask_krishna`, `open_verse`, `paywall_view`, `checkout_click` | Core actions |
| `tap_hero_ask`, `tap_hero_read`, `tap_offer_free`, `tap_daily_verse`, `tap_topic`, `tap_prompt`, `tap_nav_ask`, `tap_nav_explore`, `tap_sign_in` | Taps (once per page load) |
| `ask_typing` | Started typing a question |
| `scroll_half`, `scroll_end` | Home page scroll depth |
| `stay_15s`, `stay_45s` | Visible time on page |

**Attribution.** After sign-in, `set_my_attribution` copies the visitor's first visit (UTM, `fbclid`, in-app browser, location) into `user_accounts.signup_source` and `signup_visitor_id`. It only fills an empty value, so later logins never overwrite it.

**Android "Open in Chrome".** The hand-off link carries `vid` (so Chrome keeps the same visitor id), `fbclid` and `utm_*`.

## Counting Meta visitors

A visitor counts as coming from Meta when their first visit has `has_fbclid`, a Facebook/Instagram `utm_source`, or an in-app browser. Sign-ups are matched through `user_accounts.signup_visitor_id`.

Exclude the owner's test accounts: the list is `DEFAULT_TEST_USERS` in `supabase/functions/admin-stats/index.ts` (can be overridden with the `TEST_USER_IDS` secret).
