import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PLANS, serviceKey } from "../_shared/server.ts";

async function hmacHex(secret: string, raw: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// A short, card/bank-free summary of any Razorpay event, so failed or abandoned
// payment attempts (and their reasons) are visible, not only successful ones.
function eventSummary(event: any) {
  const link = event?.payload?.payment_link?.entity || {};
  const order = event?.payload?.order?.entity || {};
  const payment = event?.payload?.payment?.entity || {};
  const contact = String(payment?.contact || "").replace(/\D/g, "");
  return {
    event: String(event?.event || "unknown"),
    user_id: link?.notes?.user_id || order?.notes?.user_id || payment?.notes?.user_id || null,
    payment_link_id: link?.id || null,
    order_id: payment?.order_id || order?.id || link?.order_id || null,
    payment_id: payment?.id || null,
    status: payment?.status || link?.status || null,
    method: payment?.method || null,
    amount_paise: Number.isFinite(Number(payment?.amount)) ? Number(payment.amount) : null,
    contact_last4: contact ? contact.slice(-4) : null,
    error_code: payment?.error_code || null,
    error_description: payment?.error_description || null,
    error_source: payment?.error_source || null,
    error_step: payment?.error_step || null,
    error_reason: payment?.error_reason || null
  };
}

async function sha256(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Same pixel and product metadata as the browser's Purchase event (app.js).
const META_PIXEL_ID = "2178415463100322";
const META_CONTENT: Record<string, { id: string; name: string }> = {
  gita_verse_annual: { id: "gita_annual", name: "Gita Verse Annual Access" },
  gita_verse_quarterly: { id: "gita_quarterly", name: "Gita Verse 3-Month Access" },
};

// The buyer's browser (user agent) from their own visit log, for checkouts
// that didn't pass it (older pages): the latest visit of the browser they
// used while signed in, or the one they signed up from.
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

// Server-side Purchase (Meta Conversions API), so a payment is reported even
// if the buyer never comes back to the site. Uses the browser's event id, so
// Meta counts it once when the pixel also fires. Off until the
// META_CAPI_TOKEN secret is set; never affects payment handling.
async function sendMetaPurchase(admin: any, p: { userId: string; paymentId: string; amount: number; product: string; notes: any }) {
  const token = Deno.env.get("META_CAPI_TOKEN") || "";
  if (!token) return;
  try {
    // Meta needs the browser's user agent for a website event.
    const ua = String(p.notes?.meta_ua || "") || await visitUserAgent(admin, p.userId);
    if (!ua) return;
    const { data } = await admin.auth.admin.getUserById(p.userId);
    const email = String(data?.user?.email || "").trim().toLowerCase();
    const phone = String(data?.user?.phone || "").replace(/\D/g, "");
    const content = META_CONTENT[p.product] || META_CONTENT.gita_verse_annual;
    const user_data: Record<string, unknown> = { external_id: [await sha256(p.userId)], client_user_agent: ua };
    if (email) user_data.em = [await sha256(email)];
    if (phone) user_data.ph = [await sha256(phone)];
    if (p.notes?.meta_fbp) user_data.fbp = String(p.notes.meta_fbp);
    if (p.notes?.meta_fbc) user_data.fbc = String(p.notes.meta_fbc);
    const r = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ data: [{
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: "gita_purchase_" + p.paymentId,
        action_source: "website",
        event_source_url: "https://gitaverse.co.in/",
        user_data,
        custom_data: { value: p.amount / 100, currency: "INR", content_name: content.name, content_ids: [content.id], content_type: "product", num_items: 1 },
      }] }),
    });
    if (!r.ok) console.error("Meta Purchase (server) failed", r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.error("Meta Purchase (server) failed", String(e));
  }
}

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();

  try {
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";
    const signature = req.headers.get("x-razorpay-signature") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const adminKey = serviceKey();

    if (!webhookSecret || !supabaseUrl || !adminKey) {
      throw new Error("Webhook configuration incomplete");
    }

    const expected = await hmacHex(webhookSecret, raw);
    if (!safeEqual(expected, signature)) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = JSON.parse(raw);
    const admin = createClient(supabaseUrl, adminKey);

    // Diagnostics only: never let a logging problem affect payment handling.
    try {
      const { error: logError } = await admin.from("payment_events").insert(eventSummary(event));
      if (logError) console.error("payment event log failed", logError.message);
    } catch (e) {
      console.error("payment event log failed", String(e));
    }

    // Two ways to pay: a hosted payment link (payment_link.paid) or the on-site
    // checkout, whose orders carry notes.checkout = "popup" (order.paid). Other
    // events, and orders from other products on the same Razorpay account, are
    // only logged above. notes.product names the plan bought; the amount paid
    // must be that plan's price.
    const planFor = (product: unknown) => Object.values(PLANS).find((p) => p.product === product);
    const link = event?.payload?.payment_link?.entity || {};
    const order = event?.payload?.order?.entity || {};
    const payment = event?.payload?.payment?.entity || {};
    let userId: string | null, reference: string | null, amount: number, referencePaid: boolean, plan, notes: any;
    if (event?.event === "payment_link.paid") {
      // Links made before the 3-month plan carry no product: they were annual.
      plan = planFor(link?.notes?.product || "gita_verse_annual");
      notes = link?.notes || {};
      userId = link?.notes?.user_id || payment?.notes?.user_id || null;
      reference = link?.id || null;
      amount = Number(payment?.amount ?? link?.amount_paid ?? 0);
      referencePaid = String(link?.status || "") === "paid";
    } else if (event?.event === "order.paid" && order?.notes?.checkout === "popup" && planFor(order?.notes?.product)) {
      plan = planFor(order?.notes?.product);
      notes = order?.notes || {};
      userId = order?.notes?.user_id || null;
      reference = order?.id || null;
      amount = Number(payment?.amount ?? order?.amount_paid ?? 0);
      referencePaid = String(order?.status || "") === "paid" && (!payment?.order_id || payment.order_id === order.id);
    } else {
      return Response.json({ ok: true, ignored: true });
    }
    const paymentId = payment?.id || null;
    const paymentStatus = String(payment?.status || "");

    if (!userId || !paymentId || !reference) {
      return Response.json({ error: "Missing payment identity" }, { status: 400 });
    }

    if (!plan || (amount !== plan.paise && !plan.oldPaise?.includes(amount)) || !referencePaid || !["captured","authorized"].includes(paymentStatus)) {
      return Response.json({ error: "Payment validation failed" }, { status: 400 });
    }

    // The database locks this account and records payment + entitlement in
    // one transaction. A failure returns 500 so Razorpay can safely retry.
    const { data: result, error } = await admin.rpc("apply_annual_payment", {
      p_user_id: userId,
      p_payment_id: paymentId,
      p_payment_link_id: reference,
      p_amount_paise: amount,
      p_currency: payment?.currency || link?.currency || order?.currency || "",
      p_event: event
    });
    if (error) throw error;
    if (!result?.duplicate) {
      await sendMetaPurchase(admin, { userId, paymentId, amount, product: plan.product, notes });
    }
    return Response.json({ ok: true, ...result });

  } catch (e) {
    console.error("razorpay-webhook failed", String(e));
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
});
