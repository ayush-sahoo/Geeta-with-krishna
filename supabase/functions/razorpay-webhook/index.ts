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

    // create-payment-link already inserted a "created" row for this link
    // (payment_link_id is unique), so match on the link as well as the payment.
    const { data: existing, error: lookupError } = await admin
      .from("payment_transactions")
      .select("id,status")
      .or(`payment_id.eq.${paymentId},payment_link_id.eq.${paymentLinkId}`)
      .limit(1)
      .maybeSingle();
    if (lookupError) console.error("payment_transactions lookup failed", lookupError.message);

    if (existing?.status === "paid") {
      return Response.json({ ok: true, duplicate: true });
    }

    const paidDate = new Date();
    const paidAt = paidDate.toISOString();

    // A second payment while access is still active (e.g. two links opened in
    // two tabs) adds a year on top of the current expiry instead of resetting it.
    const { data: account } = await admin
      .from("user_accounts")
      .select("payment_status,access_expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    const currentExpiry = account?.payment_status === "paid" && account?.access_expires_at
      ? new Date(account.access_expires_at)
      : null;
    const expires = currentExpiry && currentExpiry > paidDate ? new Date(currentExpiry) : new Date(paidDate);
    expires.setUTCFullYear(expires.getUTCFullYear() + 1);
    const accessExpiresAt = expires.toISOString();

    // Unlock access first: a bookkeeping failure must never block a paying user.
    const { error: updateError } = await admin
      .from("user_accounts")
      .update({
        plan_status: "annual",
        payment_status: "paid",
        payment_provider: "razorpay",
        payment_id: paymentId,
        payment_link_id: paymentLinkId,
        amount_paid_paise: amount,
        purchased_at: paidAt,
        access_expires_at: accessExpiresAt,
        updated_at: paidAt
      })
      .eq("user_id", userId)
      // A redelivered event for a payment already applied must not push the expiry forward.
      .or(`payment_id.is.null,payment_id.neq.${paymentId}`);

    if (updateError) throw updateError;

    const txn = {
      status: "paid",
      payment_id: paymentId,
      payment_link_id: paymentLinkId,
      amount_paise: amount,
      raw_event: event,
      paid_at: paidAt
    };
    const { error: txnError } = existing?.id
      ? await admin.from("payment_transactions").update(txn).eq("id", existing.id)
      : await admin.from("payment_transactions").insert({
          ...txn,
          user_id: userId,
          provider: "razorpay",
          currency: payment?.currency || "INR"
        });
    if (txnError) console.error("payment_transactions write failed", paymentId, txnError.message);

    return Response.json({ ok: true, unlocked: userId, access_expires_at: accessExpiresAt });
  } catch (e) {
    console.error("razorpay-webhook failed", String(e));
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
});
