import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CHANT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const FALLBACK_EXPLAIN_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
let hindiVoiceId = "";

async function resolveHindiVoice(apiKey: string) {
  if (hindiVoiceId) return hindiVoiceId;
  try {
    const url = new URL("https://api.elevenlabs.io/v2/voices");
    url.searchParams.set("search", "Niraj");
    url.searchParams.set("page_size", "10");

    const r = await fetch(url.toString(), {
      headers: { "xi-api-key": apiKey },
    });

    if (r.ok) {
      const data = await r.json();
      const voices = Array.isArray(data?.voices) ? data.voices : [];
      const exact = voices.find((v: any) =>
        String(v?.name ?? "").toLowerCase().includes("niraj")
      );
      const candidate = exact ?? voices[0];
      if (candidate?.voice_id) {
        hindiVoiceId = candidate.voice_id;
        return hindiVoiceId;
      }
    }
  } catch (e) {
    console.error("Hindi voice lookup failed", e);
  }
  return FALLBACK_EXPLAIN_VOICE_ID;
}

async function translateToHindi(text: string) {
  const clean = text.trim();
  if (!clean) return "";

  try {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", clean);
    url.searchParams.set("langpair", "en|hi");

    const r = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
    });

    if (r.ok) {
      const data = await r.json();
      const translated = String(data?.responseData?.translatedText ?? "").trim();
      if (translated && translated.toLowerCase() !== clean.toLowerCase()) {
        return translated;
      }
    }
  } catch (e) {
    console.error("MyMemory Hindi translation failed", e);
  }

  // Fallback for BG 1.1 style wording and common labels, so we never return silence.
  return "इस श्लोक का अर्थ है: " + clean;
}

function cleanVerseText(input: string) {
  return input
    // Remove verse markers such as ||1-1||, |1.1|, ॥ १.१ ॥
    .replace(/\|{1,2}\s*[0-9०-९]+(?:\s*[-.:/]\s*[0-9०-९]+)*\s*\|{1,2}/g, " ")
    .replace(/॥\s*[0-9०-९]+(?:\s*[-.:/]\s*[0-9०-९]+)*\s*॥/g, " ")
    .replace(/।\s*[0-9०-९]+(?:\s*[-.:/]\s*[0-9०-९]+)*\s*।/g, " ")
    // Remove any remaining chapter/verse number patterns
    .replace(/[0-9०-९]+\s*[-.:/]\s*[0-9०-९]+/g, " ")
    // Remove punctuation that TTS may literally announce
    .replace(/[.|]+/g, " ")
    .replace(/[“”"'(),;:!?]/g, " ")
    // Keep Sanskrit diacritics/letters, normalise whitespace
    .replace(/\s+/g, " ")
    .trim();
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Narration is an Annual Access feature and each call spends ElevenLabs
// credits, so require a signed-in user with active access (same rule as
// ask-krishna and get-my-access).
async function hasActiveAccess(authHeader: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anon || !authHeader.startsWith("Bearer ")) return false;

  const supabase = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return false;

  const { data: account, error } = await supabase
    .from("user_accounts")
    .select("plan_status,payment_status,access_expires_at")
    .eq("user_id", userData.user.id)
    .single();

  return !error
    && account?.plan_status === "annual"
    && account?.payment_status === "paid"
    && !!account?.access_expires_at
    && new Date(account.access_expires_at).getTime() > Date.now();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!(await hasActiveAccess(req.headers.get("Authorization") ?? ""))) {
      return json({ error: "Annual Access required" }, 403);
    }

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    const body = await req.json();
    const kind = body?.kind === "verse" ? "verse" : "meaning";
    const rawText = String(body?.text ?? "").trim();
    const text = kind === "verse"
      ? cleanVerseText(rawText)
      : await translateToHindi(rawText);

    if (!text) return json({ error: "Text is required" }, 400);
    if (text.length > 3500) return json({ error: "Text is too long" }, 400);

    const voiceId = kind === "verse" ? CHANT_VOICE_ID : FALLBACK_EXPLAIN_VOICE_ID;
    const voiceSettings = kind === "verse"
      ? { stability: 0.62, similarity_boost: 0.78, style: 0.20, use_speaker_boost: true, speed: 1.08 }
      : { stability: 0.52, similarity_boost: 0.82, style: 0.24, use_speaker_boost: true, speed: 1.05 };

    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          language_code: kind === "verse" ? "hi" : "hi",
          voice_settings: voiceSettings,
        }),
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("ElevenLabs error", upstream.status, detail.slice(0, 300));
      return json({ error: "Voice provider returned an error" }, 502);
    }

    const audio = await upstream.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Voice-Role": kind === "verse" ? "female-chant" : "hindi-meaning",
      },
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Narration failed. Please try again." }, 500);
  }
});
