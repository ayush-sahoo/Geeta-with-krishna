import { adminClient } from "./server.ts";
import { GITA_LANGUAGES } from "./languages.ts";

// Krishna's voice (ElevenLabs), shared by tts-krishna and ask-krishna's
// Talk to Krishna turns.
export const MEANING_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const MEANING_SETTINGS = { stability: 0.5, similarity_boost: 0.82, speed: 1.05 };

// ElevenLabs allows only a few requests at once per account; when it says
// "too many" (429), wait briefly and try again.
async function elevenLabs(url: string, init: RequestInit, timeoutMs: number) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (r.status !== 429 || attempt === 3) return r;
    await r.body?.cancel();
    await new Promise((ok) => setTimeout(ok, 500 * 2 ** attempt + Math.random() * 300));
  }
}

// Speech to text with ElevenLabs Scribe. It names the spoken language in
// ISO 639-3; map the ones the site supports to its codes.
const SPOKEN_LANGUAGE: Record<string, string> = {
  eng: "en", hin: "hi", asm: "as", ben: "bn", guj: "gu", kan: "kn", mal: "ml", mar: "mr", nep: "ne", pan: "pa", snd: "sd",
  tam: "ta", tel: "te", urd: "ur", ara: "ar", fra: "fr", deu: "de", spa: "es", por: "pt", rus: "ru", jpn: "ja", kor: "ko",
  cmn: "zh", zho: "zh", ita: "it", nld: "nl", tur: "tr", pol: "pl", ind: "id", tha: "th", vie: "vi", fil: "fil", tgl: "fil",
  swe: "sv", ukr: "uk", fas: "fa", heb: "he", ell: "el", msa: "ms", zsm: "ms",
};
export class VoiceError extends Error {}
export async function transcribe(audioBase64: string, mimeType: string) {
  if (!audioBase64 || audioBase64.length > 3_000_000) throw new VoiceError("Recording is missing or too long");
  const type = /^audio\/[a-z0-9.+-]+/i.exec(String(mimeType ?? ""))?.[0] ?? "audio/webm";
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([bytes], { type }), "speech." + (type.includes("mp4") ? "m4a" : type.split("/")[1].split(";")[0]));
  const r = await elevenLabs("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": Deno.env.get("ELEVENLABS_API_KEY") ?? "" }, body: form,
  }, 30000);
  if (!r.ok) {
    console.error("ElevenLabs speech-to-text error", r.status, (await r.text()).slice(0, 300));
    throw new VoiceError("Could not hear that. Please try again.");
  }
  const d = await r.json();
  const code = String(d?.language_code ?? "").toLowerCase();
  const language = Object.hasOwn(GITA_LANGUAGES, code) ? code : SPOKEN_LANGUAGE[code] ?? "";
  return { text: String(d?.text ?? "").trim().slice(0, 1000), language };
}

// Krishna's voice for one piece of text, with the time each letter is spoken
// (for the portrait's lip sync and the highlighted words).
export async function voiceWithTimestamps(text: string, language: string) {
  const r = await elevenLabs(`https://api.elevenlabs.io/v1/text-to-speech/${MEANING_VOICE_ID}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": Deno.env.get("ELEVENLABS_API_KEY") ?? "", "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_v3", ...(language.length === 2 ? { language_code: language } : {}), voice_settings: MEANING_SETTINGS }),
  }, 45000);
  if (!r.ok) {
    console.error("ElevenLabs error", r.status, (await r.text()).slice(0, 300));
    throw new VoiceError("Voice provider returned an error");
  }
  const d = await r.json();
  if (typeof d?.audio_base64 !== "string" || !Array.isArray(d?.alignment?.characters)) throw new VoiceError("Voice provider returned an error");
  return { audio_base64: d.audio_base64 as string, alignment: d.alignment };
}

// What Krishna says aloud: the paragraphs and closing question, without the
// verse references. Must match spokenAnswer in app.js.
export function spokenText(reply: { paragraphs?: string[]; follow_up?: string }) {
  return [...(reply.paragraphs ?? []), reply.follow_up ?? ""].filter(Boolean).join(" ")
    .replace(/\s*\((?:BG \d+\.\d+[,;\s]*)+\)/g, "").replace(/\s*BG \d+\.\d+/g, "").replace(/\s+/g, " ").trim();
}

// Spoken text in pieces at sentence ends, so Krishna can start after the
// first sentence is voiced (about 2 s) instead of the whole reply (about 10 s).
// The first piece ends at the first sentence end after 40 letters; later
// pieces hold up to about 160 letters.
// Must match speechChunks in app.js.
export function speechChunks(text: string) {
  const sentences = text.split(/(?<=[।॥.!?؟۔])\s+/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > 160) { chunks.push(current); current = sentence; }
    else current = current ? current + " " + sentence : sentence;
    if (!chunks.length && current.length >= 40) { chunks.push(current); current = ""; }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Shared persistent budget, reserved atomically before spending provider credits.
export class VoiceQuotaError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function claimVoiceBudget(userId: string, units: number) {
  const admin = adminClient();
  if (!admin) throw new VoiceQuotaError("Voice is temporarily unavailable. Please try again later.", 503);
  const { data, error } = await admin.rpc("claim_voice_budget", { p_user_id: userId, p_units: units });
  if (error) throw new VoiceQuotaError("Voice is temporarily unavailable. Please try again later.", 503);
  if (data !== true) throw new VoiceQuotaError("Voice usage limit reached. Please try again later.", 429);
}
