import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PLANS, serviceKey } from "../_shared/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Buyers must return to the same domain they signed in on: the login session
// lives in that origin's localStorage, and the Meta Purchase event fires there.
const SITE_URL = "https://gitaverse.co.in";

// Razorpay calls are cut off well before the browser gives up (15 s), so a
// slow call fails here instead of being retried while it is still running.
const RAZORPAY_TIMEOUT_MS = 8000;
// An unpaid checkout is handed out again for this long instead of creating
// another payable one (payment links expire after 60 minutes).
const REUSE_ORDER_MS = 30 * 60 * 1000;
const REUSE_LINK_MS = 50 * 60 * 1000;

function razorpay(path: string, auth: string, init: RequestInit = {}) {
  return fetch("https://api.razorpay.com/v1/" + path, {
    ...init,
    headers: { "Authorization": auth, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
  });
}

// One checkout is prepared at a time per account. A parallel or retried request
// waits briefly for the lease; by then the first request's checkout is usually
// there to reuse.
async function claimLease(admin: any, uid: string) {
  for (let i = 0; i < 6; i++) {
    const { data } = await admin.rpc("claim_checkout_lease", { p_user_id: uid, p_seconds: 20 });
    if (data === true) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// The newest unpaid checkout of this kind and price, if it is recent and still payable.
async function reusableCheckout(admin: any, uid: string, popup: boolean, paise: number, auth: string) {
  const { data } = await admin.from("payment_transactions")
    .select("payment_link_id,created_at")
    .eq("user_id", uid).eq("status", "created").eq("amount_paise", paise)
    .like("payment_link_id", popup ? "order_%" : "plink_%")
    .order("created_at", { ascending: false }).limit(1);
  const row = data?.[0];
  if (!row || Date.now() - new Date(row.created_at).getTime() > (popup ? REUSE_ORDER_MS : REUSE_LINK_MS)) return null;
  if (popup) return { order_id: row.payment_link_id };
  try {
    const r = await razorpay("payment_links/" + encodeURIComponent(row.payment_link_id), auth);
    const link = await r.json();
    return r.ok && link?.status === "created" && link?.short_url ? { id: link.id, short_url: link.short_url } : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishable = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const adminKey = serviceKey();
    const keyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    const authHeader = req.headers.get("Authorization") || "";

    const razorpayMode = keyId.startsWith("rzp_live_")
      ? "live"
      : keyId.startsWith("rzp_test_")
        ? "test"
        : "unknown";

    console.log("Razorpay runtime mode:", razorpayMode);

    if (razorpayMode !== "live") {
      return Response.json(
        { error: "Razorpay live credentials are not active on the server", mode: razorpayMode },
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const missing = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!publishable) missing.push("SUPABASE_ANON_KEY");
    if (!adminKey) missing.push("SUPABASE_SECRET_KEYS/SUPABASE_SERVICE_ROLE_KEY");
    if (!keyId) missing.push("RAZORPAY_KEY_ID");
    if (!keySecret) missing.push("RAZORPAY_KEY_SECRET");
    if (missing.length) {
      throw new Error("Missing server secrets: " + missing.join(", "));
    }
    if (!authHeader.startsWith("Bearer ")) {
      return Response.json({ error: "Sign in required" }, { status: 401, headers: cors });
    }

    const userClient = createClient(supabaseUrl, publishable, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return Response.json({ error: "Invalid session" }, { status: 401, headers: cors });
    }

    const admin = createClient(supabaseUrl, adminKey);
    const uid = userData.user.id;
    const email = userData.user.email || "";
    const phone = String(userData.user.phone || "").replace(/\D/g, "");
    // "popup": a Razorpay order for the on-site checkout (which can prefill the
    // buyer's phone or email). Otherwise a hosted payment link, the fallback when
    // the checkout script cannot load.
    // plan: "annual" (₹999, 1 year; the default) or "quarterly" (₹399, 3 months).
    let mode = "link", planKey = "annual";
    try {
      const body = await req.json();
      mode = body?.mode === "popup" ? "popup" : "link";
      if (body?.plan === "quarterly") planKey = "quarterly";
    } catch { /* no body */ }
    const plan = PLANS[planKey];

    const { data: account } = await admin
      .from("user_accounts")
      .select("plan_status,payment_status,access_expires_at")
      .eq("user_id", uid)
      .single();

    const activeAnnual = account?.plan_status === "annual"
      && account?.payment_status === "paid"
      && account?.access_expires_at
      && new Date(account.access_expires_at).getTime() > Date.now();

    if (activeAnnual) {
      return Response.json({
        already_paid: true,
        access_expires_at: account.access_expires_at
      }, { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const referenceId = "gita_" + uid.replaceAll("-", "").slice(0, 16) + "_" + Date.now().toString(36);
    const razorpayAuth = "Basic " + btoa(keyId + ":" + keySecret);
    const popup = mode === "popup";
    const json = { ...cors, "Content-Type": "application/json" };
    const popupResponse = (orderId: string) => Response.json({
      order_id: orderId,
      key_id: keyId,
      amount: plan.paise,
      currency: "INR",
      plan: planKey,
      prefill: { ...(phone ? { contact: "+" + phone } : {}), ...(email ? { email } : {}) }
    }, { headers: json });

    const leased = await claimLease(admin, uid);
    try {
      const reuse = await reusableCheckout(admin, uid, popup, plan.paise, razorpayAuth);
      if (reuse) {
        return "order_id" in reuse ? popupResponse(reuse.order_id) : Response.json(reuse, { headers: json });
      }
      if (!leased) {
        return Response.json({ error: "Your payment is being prepared. Please try again in a moment." }, { status: 409, headers: json });
      }

      if (popup) {
        const rzOrder = await razorpay("orders", razorpayAuth, {
          method: "POST",
          body: JSON.stringify({
            amount: plan.paise,
            currency: "INR",
            receipt: referenceId,
            // razorpay-webhook unlocks only orders carrying this marker, so other
            // products on the same Razorpay account can never grant access.
            notes: { user_id: uid, product: plan.product, checkout: "popup" }
          })
        });
        const order = await rzOrder.json();
        if (!rzOrder.ok || !order?.id) {
          console.error("Razorpay order creation failed", rzOrder.status, JSON.stringify(order).slice(0, 300));
          return Response.json({ error: "Could not start payment. Please try again." }, { status: 502, headers: cors });
        }
        // The order id is kept in payment_link_id, the column that holds the
        // Razorpay reference a payment is matched against.
        await admin.from("payment_transactions").insert({
          user_id: uid,
          provider: "razorpay",
          payment_link_id: order.id,
          amount_paise: plan.paise,
          currency: "INR",
          status: "created"
        });
        await admin.from("user_accounts").update({
          payment_provider: "razorpay",
          payment_link_id: order.id,
          updated_at: new Date().toISOString()
        }).eq("user_id", uid);
        return popupResponse(order.id);
      }
      const payload = {
        amount: plan.paise,
        currency: "INR",
        accept_partial: false,
        description: plan.description,
        reference_id: referenceId,
        customer: email ? { email } : undefined,
        notify: { sms: false, email: false },
        reminder_enable: false,
        // Unpaid links expire so an old tab can't be paid long after a later purchase.
        expire_by: Math.floor(Date.now() / 1000) + 60 * 60,
        callback_url: SITE_URL + "/?payment=success",
        callback_method: "get",
        notes: {
          user_id: uid,
          product: plan.product
        }
      };

      const rz = await razorpay("payment_links", razorpayAuth, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const body = await rz.json();
      if (!rz.ok) {
        console.error("Razorpay link creation failed", rz.status, JSON.stringify(body).slice(0, 300));
        return Response.json({ error: "Could not start payment. Please try again." }, { status: 502, headers: cors });
      }

      await admin.from("payment_transactions").insert({
        user_id: uid,
        provider: "razorpay",
        payment_link_id: body.id,
        amount_paise: plan.paise,
        currency: "INR",
        status: body.status || "created"
      });

      await admin.from("user_accounts").update({
        payment_provider: "razorpay",
        payment_link_id: body.id,
        updated_at: new Date().toISOString()
      }).eq("user_id", uid);

      return Response.json({
        id: body.id,
        short_url: body.short_url
      }, { headers: json });
    } finally {
      if (leased) await admin.rpc("release_checkout_lease", { p_user_id: uid });
    }
  } catch (e) {
    // Details (e.g. missing secret names) go to the logs, not the browser.
    console.error("create-payment-link failed", String(e));
    return Response.json({ error: "Could not start payment. Please try again." }, { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
