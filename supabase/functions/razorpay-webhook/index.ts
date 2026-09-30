import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ANNUAL_PRICE_PAISE, serviceKey } from "../_shared/server.ts";

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
    if (event?.event !== "payment_link.paid") {
      return Response.json({ ok: true, ignored: true });
    }

    const link = event?.payload?.payment_link?.entity || {};
    const payment = event?.payload?.payment?.entity || {};
    const userId = link?.notes?.user_id || payment?.notes?.user_id || null;
    const paymentLinkId = link?.id || null;
    const paymentId = payment?.id || null;
    const amount = Number(payment?.amount ?? link?.amount_paid ?? 0);
    const linkStatus = String(link?.status || "");
    const paymentStatus = String(payment?.status || "");

    if (!userId || !paymentId || !paymentLinkId) {
      return Response.json({ error: "Missing payment identity" }, { status: 400 });
    }

    if (amount !== ANNUAL_PRICE_PAISE || !["paid"].includes(linkStatus) || !["captured","authorized"].includes(paymentStatus)) {
      return Response.json({ error: "Payment validation failed" }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, adminKey);

    // The database locks this account and records payment + entitlement in
    // one transaction. A failure returns 500 so Razorpay can safely retry.
    const { data: result, error } = await admin.rpc("apply_annual_payment", {
      p_user_id: userId,
      p_payment_id: paymentId,
      p_payment_link_id: paymentLinkId,
      p_amount_paise: amount,
      p_currency: payment?.currency || link?.currency || "",
      p_event: event
    });
    if (error) throw error;
    return Response.json({ ok: true, ...result });

  } catch (e) {
    console.error("razorpay-webhook failed", String(e));
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
});
