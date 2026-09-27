import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Buyers must return to the same domain they signed in on: the login session
// lives in that origin's localStorage, and the Meta Purchase event fires there.
const SITE_URL = "https://gitaverse.co.in";

function getSecretKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try { return JSON.parse(raw)["default"] || ""; } catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishable = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const adminKey = getSecretKey();
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
    const payload = {
      amount: 100000,
      currency: "INR",
      accept_partial: false,
      description: "Gita Verse Annual Access",
      reference_id: referenceId,
      customer: email ? { email } : undefined,
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: SITE_URL + "/?payment=success",
      callback_method: "get",
      notes: {
        user_id: uid,
        product: "gita_verse_annual"
      }
    };

    const rz = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(keyId + ":" + keySecret),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = await rz.json();
    if (!rz.ok) {
      return Response.json({ error: "Razorpay link creation failed", details: body }, { status: 502, headers: cors });
    }

    await admin.from("payment_transactions").insert({
      user_id: uid,
      provider: "razorpay",
      payment_link_id: body.id,
      amount_paise: 100000,
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
    }, { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
