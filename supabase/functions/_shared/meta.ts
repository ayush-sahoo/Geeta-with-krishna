// Server-side Meta Purchase (Conversions API). Used by razorpay-webhook right
// after a payment and by meta-purchase-retry on a schedule, until Meta accepts
// it. Each paid payment_transactions row records the outcome (meta_sent_at,
// meta_attempts, meta_last_error, meta_next_try_at). The event id is the
// browser pixel's, so Meta counts a purchase once however often it is sent.
// Nothing is sent without the META_CAPI_TOKEN secret; rows then stay pending.

const META_PIXEL_ID = "2178415463100322";
const META_CONTENT: Record<string, { id: string; name: string }> = {
  gita_verse_annual: { id: "gita_annual", name: "Gita Verse Annual Access" },
  gita_verse_quarterly: { id: "gita_quarterly", name: "Gita Verse 3-Month Access" },
};
// Meta takes events up to 7 days old; stop a little before that.
export const META_RETRY_WINDOW_MS = 6 * 864e5;
export const META_MAX_ATTEMPTS = 12;

async function sha256(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// The buyer's browser (user agent) from their own visit log, for checkouts
// that didn't pass it: the latest visit of the browser they used while signed
// in, or the one they signed up from.
async function visitUserAgent(admin: any, userId: string) {
  const { data: ev } = await admin.from("site_events").select("visitor_id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
  let visitor = ev?.[0]?.visitor_id;
  if (!visitor) {
    const { data: acct } = await admin.from("user_accounts").select("signup_visitor_id").eq("user_id", userId).maybeSingle();
    visitor = acct?.signup_visitor_id;
  }
  if (!visitor) return "";
  const { data: v } = await admin.from("site_visits").select("user_agent").eq("visitor_id", visitor).order("created_at", { ascending: false }).limit(1);
  return String(v?.[0]?.user_agent || "");
}

// Waits before the next try: 5 min, 10, 20 ... capped at 6 hours.
export function nextTryAt(attempts: number, now = Date.now()) {
  return new Date(now + Math.min(5 * 60e3 * 2 ** Math.max(attempts - 1, 0), 6 * 3600e3)).toISOString();
}

// Sends the Purchase for one paid payment unless Meta already accepted it.
// Returns "sent", "failed", "pending" (no token yet) or "skipped".
export async function deliverMetaPurchase(admin: any, paymentId: string): Promise<string> {
  const { data: t } = await admin.from("payment_transactions")
    .select("id,user_id,amount_paise,paid_at,raw_event,meta_sent_at,meta_attempts")
    .eq("payment_id", paymentId).eq("status", "paid").maybeSingle();
  if (!t || t.meta_sent_at) return "skipped";
  const token = Deno.env.get("META_CAPI_TOKEN") || "";
  if (!token) return "pending";
  // Saves the delivery outcome, retrying the write once. If it still fails the
  // payment simply stays pending: a later retry re-sends, and Meta counts it
  // once (same event id).
  const record = async (fields: Record<string, unknown>) => {
    for (let i = 0; i < 2; i++) {
      const { error } = await admin.from("payment_transactions").update(fields).eq("id", t.id).is("meta_sent_at", null);
      if (!error) return true;
      console.error("Meta Purchase delivery status not saved", paymentId, error.message);
    }
    return false;
  };
  const attempts = Number(t.meta_attempts || 0) + 1;
  const fail = async (error: string) => {
    console.error("Meta Purchase (server) failed", paymentId, error);
    await record({ meta_attempts: attempts, meta_last_error: error.slice(0, 300), meta_next_try_at: nextTryAt(attempts) });
    return "failed";
  };
  try {
    const entity = t.raw_event?.payload?.order?.entity || t.raw_event?.payload?.payment_link?.entity || {};
    const notes = entity.notes || {};
    // Meta needs the browser's user agent for a website event.
    const ua = String(notes.meta_ua || "") || await visitUserAgent(admin, t.user_id);
    if (!ua) return await fail("no user agent for this buyer");
    const { data } = await admin.auth.admin.getUserById(t.user_id);
    const email = String(data?.user?.email || "").trim().toLowerCase();
    const phone = String(data?.user?.phone || "").replace(/\D/g, "");
    const content = META_CONTENT[notes.product] || META_CONTENT.gita_verse_annual;
    const user_data: Record<string, unknown> = { external_id: [await sha256(t.user_id)], client_user_agent: ua };
    if (email) user_data.em = [await sha256(email)];
    if (phone) user_data.ph = [await sha256(phone)];
    if (notes.meta_fbp) user_data.fbp = String(notes.meta_fbp);
    if (notes.meta_fbc) user_data.fbc = String(notes.meta_fbc);
    const r = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ data: [{
        event_name: "Purchase",
        event_time: Math.floor(new Date(t.paid_at || Date.now()).getTime() / 1000),
        event_id: "gita_purchase_" + paymentId,
        action_source: "website",
        event_source_url: "https://gitaverse.co.in/",
        user_data,
        custom_data: { value: t.amount_paise / 100, currency: "INR", content_name: content.name, content_ids: [content.id], content_type: "product", num_items: 1 },
      }] }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !(body?.events_received >= 1)) return await fail(`HTTP ${r.status} ${JSON.stringify(body?.error?.message || body).slice(0, 200)}`);
    await record({ meta_sent_at: new Date().toISOString(), meta_attempts: attempts, meta_last_error: null, meta_next_try_at: null });
    return "sent";
  } catch (e) {
    return await fail(String(e));
  }
}
