import { GITA_LANGUAGES } from "../_shared/languages.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Pre-translates the verse-text pieces in translation_sources into every
// language, so the site reads stored translations instead of waiting for the
// AI. Callers send a token kept in Vault; each call claims a few unfinished
// languages (optionally limited by {"languages": [...]}) and works on them in
// the background. Languages that aren't pre-translated are translated on first
// use by tts-krishna and saved.

const PRIORITY = ["hi", "bn", "mr", "ta", "te", "gu", "kn", "ml", "pa", "ur", "as", "ne", "sd"];
const ORDER = [...PRIORITY, ...Object.keys(GITA_LANGUAGES).filter((l) => l !== "en" && !PRIORITY.includes(l))];
const PARALLEL = 4;          // languages per run
const LEASE_SECONDS = 150;   // matches the edge function's wall-clock limit
const STOP_AFTER_MS = 90_000; // start no new batch after this
const MAX_CHARS = 5000;      // English characters per model call

function getSecretKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try { return JSON.parse(raw)["default"] || ""; } catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

async function translateBatch(apiKey: string, language: string, texts: string[]): Promise<string[] | null> {
  for (const thinkingLevel of ["minimal", "low", ""]) {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `Translate each string in the JSON array into ${GITA_LANGUAGES[language]}, using its native script. The strings are explanations of Bhagavad Gita verses for a devotional app. Translate faithfully and naturally; keep the meaning, tone and any line breaks; do not add, drop, merge or explain anything. Return JSON {"texts": [...]} with exactly ${texts.length} strings in the same order.` }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(texts) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { texts: { type: "ARRAY", items: { type: "STRING" } } }, required: ["texts"] },
          temperature: 0.2,
          maxOutputTokens: 16384,
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        },
      }),
    });
    if (r.status === 400 && thinkingLevel) continue;
    if (!r.ok) {
      console.error("Gemini error", language, r.status);
      return null;
    }
    try {
      const d = await r.json();
      const output = (d.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
      const out = JSON.parse(output)?.texts;
      if (!Array.isArray(out) || out.length !== texts.length) throw new Error(`expected ${texts.length} texts, got ${out?.length}`);
      if (out.some((t: unknown) => typeof t !== "string" || !t.trim() || t.length > 12000)) throw new Error("empty or oversized text");
      return out.map((t: string) => t.trim());
    } catch (e) {
      console.error("Unusable translation batch", language, String(e));
      return null;
    }
  }
  return null;
}

async function workOn(admin: any, apiKey: string, language: string, stopAt: number) {
  let saved = 0;
  while (Date.now() < stopAt) {
    const { data: batch, error } = await admin.rpc("next_translation_batch", { p_language: language, p_max_chars: MAX_CHARS });
    if (error) { console.error("next_translation_batch failed", language, error.message); break; }
    if (!batch?.length) break;
    // A batch the model can't return cleanly is retried one text at a time.
    let items = batch as { source_hash: string; source: string }[];
    let out = await translateBatch(apiKey, language, items.map((b) => b.source));
    if (!out && items.length > 1) {
      items = items.slice(0, 1);
      out = await translateBatch(apiKey, language, [items[0].source]);
    }
    if (!out) break;
    const rows = items.map((b, i) => ({ source_hash: b.source_hash, language, translated: out![i] }));
    const { error: writeError } = await admin.from("text_translations").upsert(rows, { onConflict: "source_hash,language", ignoreDuplicates: true });
    if (writeError) { console.error("text_translations write failed", language, writeError.message); break; }
    saved += rows.length;
  }
  return saved;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL") || "";
  const adminKey = getSecretKey();
  const apiKey = Deno.env.get("GEMINI_API_KEY") || "";
  if (!url || !adminKey || !apiKey) return Response.json({ error: "Server config missing" }, { status: 500 });

  const admin = createClient(url, adminKey);
  const { data: ok } = await admin.rpc("translation_worker_token_ok", { p_token: req.headers.get("x-worker-token") || "" });
  if (ok !== true) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const only = Array.isArray(body?.languages) ? ORDER.filter((l) => body.languages.includes(l)) : ORDER;
  const { data: languages, error } = await admin.rpc("claim_translation_languages", { p_languages: only, p_count: PARALLEL, p_lease_seconds: LEASE_SECONDS });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!languages?.length) return Response.json({ working_on: [] });

  const stopAt = Date.now() + STOP_AFTER_MS;
  const job = Promise.all(languages.map((l: string) => workOn(admin, apiKey, l, stopAt)))
    .then((counts) => console.log("translation-worker saved", JSON.stringify(Object.fromEntries(languages.map((l: string, i: number) => [l, counts[i]])))))
    .catch((e) => console.error("translation-worker failed", String(e)));
  // Answer now and keep translating in the background.
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime.
  EdgeRuntime.waitUntil(job);
  return Response.json({ working_on: languages }, { status: 202 });
});
