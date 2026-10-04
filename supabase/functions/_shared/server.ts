import { createClient } from "npm:@supabase/supabase-js@2";

// Settings and helpers shared by the edge functions. Change the price or the
// AI model here, not in each function.

// Annual Access price in paise (₹1,000).
export const ANNUAL_PRICE_PAISE = 100000;

// The plans on sale. create-payment-link charges the chosen plan's price and
// tags the checkout with its product; razorpay-webhook unlocks access only when
// the amount paid matches that product. The database function
// apply_annual_payment sets each price's length (1 year / 3 months).
export const PLANS: Record<string, { paise: number; product: string; description: string }> = {
  annual: { paise: ANNUAL_PRICE_PAISE, product: "gita_verse_annual", description: "Gita Verse Annual Access" },
  quarterly: { paise: 39900, product: "gita_verse_quarterly", description: "Gita Verse 3-Month Access" },
};

// Gemini model used for Ask Krishna answers and translations.
export const GEMINI_MODEL = "gemini-3.5-flash";
export const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// The project's server key (bypasses row-level security; never send it to a browser).
export function serviceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try { return JSON.parse(raw)["default"] || ""; } catch { /* fall through */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

// A client that acts as the server, or null when the project settings are missing.
export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = serviceKey();
  return url && key ? createClient(url, key) : null;
}
