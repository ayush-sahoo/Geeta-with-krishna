# How translation works in Gita Verse

Gita Verse supports 74 languages (the list ElevenLabs v3 can speak). The 13
Indian languages are fully translated ahead of time; the rest are translated
by Gemini the first time someone uses them, and saved.

There are **three separate language settings**, each translated differently:

| Setting | What it changes | Where it is chosen | How it is translated |
| --- | --- | --- | --- |
| Website language | Menus, buttons, offer screen, all screen text | 🌐 button in the header | A fixed catalog of English strings, translated once per language |
| Chat language | Krishna's replies in Ask Krishna | Chat screen | Gemini writes the reply directly in that language |
| Meaning & audio language | Verse meaning, deep meaning, "apply today", reflection, narration | Verse screen | Stored translations of each text piece, plus ElevenLabs voice |

All AI translation uses the Gemini model set in `GEMINI_MODEL`
(`supabase/functions/_shared/server.ts`), currently `gemini-3.5-flash-lite`.

---

## 1. Website text

### The catalog

Every English string the site can show is listed in
`supabase/functions/_shared/ui-strings.json` (792 strings). Only strings in this
list are ever translated, so nobody can use the function to translate their own
text.

### Translating it: `website-language` edge function

`GET /functions/v1/website-language?language=hi`

1. If `website_locales` already has this language at the current `revision`,
   return it.
2. Otherwise claim the language (`claim_website_locale`, so two visitors don't
   translate it at the same time; a second caller gets `202 preparing` and
   retries).
3. Keep every string already translated under an earlier revision; send only
   the new ones to Gemini, 80 strings per call, 4 calls at a time.
   - The prompt tells Gemini to keep Krishna/Gita names, numbers, prices,
     arrows and symbols, and to return exactly as many strings as it was given
     (enforced with a JSON response schema).
   - Thinking is set to `low`; temperature `0.1`.
4. Save the result in `website_locales` (language, revision, translations).

`revision` is a constant in `website-language/index.ts`. Bumping it is what
makes the function pick up new catalog strings.

### Shipped files for the 13 Indian languages

The 13 Indian languages are also saved as static files, `locales/<code>.json`
(Hindi, Bengali, Marathi, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi,
Urdu, Assamese, Nepali, Sindhi). These load instantly from the website itself,
so the function is only called for the other 61 languages.

The shipped files are reviewed by hand. Gemini Flash-Lite occasionally mixes
scripts in the less common languages (it once produced Gujarati with Devanagari,
Gurmukhi and Arabic words mixed in), so check new lines before shipping them.

### In the browser: `website-language.js`

- `setWebsiteLanguage(code)` loads `/locales/<code>.json`; if there is no file,
  it calls the `website-language` function (retrying while it says
  "preparing").
- `applyWebsiteLanguage()` walks every text node on the page, plus
  `placeholder`, `title` and `aria-label` attributes, and swaps the English for
  the translation. The original English is remembered, so switching back to
  English, or to another language, works without a reload.
- A `MutationObserver` re-applies the translation whenever the app adds or
  changes text, so screens drawn later are translated too.
- Some dynamic labels are handled by pattern: "Verse 12", "Chapter 3" and
  "Welcome, <name>" keep their number or name.
- Content is excluded: chat messages, chat history, and verse text and meanings
  (Sanskrit, transliteration, meaning, reflection, topic verses). Those follow
  their own language settings below.
- The choice is remembered in `localStorage` (`gitaWebsiteLanguage`).

---

## 2. Verse meanings and reflections

### What gets translated

The verse screen is built from fixed English pieces:

- the English meaning of each verse (700),
- the "lens", "deep meaning", "apply today" and reflection texts written in
  `app.js` (46 pieces).

Each piece is registered in `translation_sources`, keyed by the SHA-256 of its
English text. Translations are stored in `text_translations`
(`source_hash`, `language`, `translated`). Today each of the 13 Indian languages
has all 746 pieces.

### Filling the table ahead of time: `translation-worker`

A background edge function, started by hand from SQL (see OPERATIONS.md):

- It checks a token kept in Vault (`translation_worker_token`).
- It claims up to 4 unfinished languages at a time (`claim_translation_languages`,
  with a lease so runs don't overlap), Indian languages first.
- For each language it takes batches of untranslated pieces of up to 5,000
  English characters (`next_translation_batch`) and sends them to Gemini.
  - The prompt asks for a faithful, natural translation for a devotional app,
    keeping meaning, tone and line breaks, adding nothing.
  - A JSON schema enforces the same number of strings back.
  - Thinking is `minimal`; temperature `0.2`.
  - If a batch fails, it retries one piece at a time.
- It saves to `text_translations` and stops starting new batches after about
  90 seconds.
- `translation_missing(array[...])` shows how many pieces are left per
  language.

### On demand: `tts-krishna` (`operation: "translate"`)

For a language that isn't pre-translated, the site asks `tts-krishna` to
translate the piece (this needs active paid access, like narration). It checks `text_translations` first; if nothing is stored,
it asks Gemini (thinking `minimal`). If the text is a known piece from
`translation_sources`, it saves the result, so the next reader gets it
instantly. Arbitrary text is translated but never stored.

### In the browser (`app.js`)

- `loadStoredTranslations(language)` downloads all stored translations for a
  language once (signed-in users only), as a map from text hash to translation.
- `translateText(text, language)` hashes the English, uses the stored
  translation if there is one, and otherwise calls `tts-krishna`.
- `translateTab()` translates a verse tab piece by piece; `renderTab()` shows the
  English at once and swaps in the translation when it is ready. If that takes
  more than 0.3 s it shows "Translating to …", and on failure a Retry button.

---

## 3. Narration (audio)

`tts-krishna` with ElevenLabs. Narration needs active paid access.

- **Sanskrit verse:** always chanted in Sanskrit with a female voice
  (`eleven_multilingual_v2`), with pauses added at the verse markers.
- **Meaning:** read in the chosen meaning language with a male voice
  (`eleven_v3`, `language_code` set). The meaning is translated first as
  above.
- **Default "English text · Hindi audio":** the meaning is shown in English but
  narrated from the Hindi translation.

---

## 4. Ask Krishna replies

No separate translation step. `ask-krishna` asks Gemini to write the reply
directly in the user's language:

- **Auto (default):** reply in the same language and script the user wrote in
  (English, Hindi or Hinglish).
- **A chosen language:** the system prompt adds "RESPONSE LANGUAGE: <language>.
  Use its native script for all prose…", keeping verse references as
  `BG chapter.verse`.

The verse texts given to Gemini as context are English; Gemini paraphrases them
in the reply language.

---

## Common tasks

| Task | Steps |
| --- | --- |
| **Add or change website text** | 1. Add the exact English string to `ui-strings.json`.<br>2. Bump `revision` in `website-language/index.ts` and deploy it (with the `_shared` files).<br>3. Call `website-language?language=<code>` once for each of the 13 shipped languages (e.g. `net.http_get` from SQL). Only new strings are translated.<br>4. Review the new lines and copy them from `website_locales` into `locales/*.json`.<br>5. `tests/website-language.cjs` fails if any offer-screen text is missing from the catalog or a shipped file. |
| **Change verse-page pieces** (lens, deep meaning, apply today, reflections in `app.js`) | 1. `node tools/translation_sources.mjs > pieces.sql`, then run `pieces.sql` in Supabase.<br>2. Run the translation worker (OPERATIONS.md). |
| **Add a language** | 1. Add it to `languages.js` and `supabase/functions/_shared/languages.ts` (a unit test checks they match).<br>2. Redeploy `ask-krishna`, `tts-krishna`, `translation-worker` and `website-language`.<br>3. Optionally run the worker for it and ship a `locales/<code>.json`. |
| **See what is left to translate** | `select * from translation_missing(array['hi','bn',...]);` |
| **Change the AI model** | `GEMINI_MODEL` in `_shared/server.ts`, then redeploy the four functions above. |

## Files and tables

| Piece | Where |
| --- | --- |
| Language list | `languages.js`, `supabase/functions/_shared/languages.ts` |
| Website text catalog | `supabase/functions/_shared/ui-strings.json` |
| Website translator | `supabase/functions/website-language/index.ts` → table `website_locales` |
| Shipped website translations | `locales/*.json` (13 Indian languages) |
| Website text swapping | `website-language.js` |
| Verse pieces | table `translation_sources` (`tools/translation_sources.mjs` registers app.js pieces) |
| Verse translations | table `text_translations` |
| Pre-translation | `supabase/functions/translation-worker/index.ts` |
| On-demand translation and narration | `supabase/functions/tts-krishna/index.ts` |
| Chat replies | `supabase/functions/ask-krishna/index.ts` |
| Verse screen logic | `app.js`: `setupLanguages`, `loadStoredTranslations`, `translateText`, `translateTab`, `renderTab` |
| Tests | `tests/website-language.cjs` and the other unit tests under `tests/` |
