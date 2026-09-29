import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serviceKey } from "../_shared/server.ts";

// Returns the signed-in user's plan, payment and access state, plus whether
// their one free Ask Krishna question is still available.

const FREE_QUESTIONS = 1;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "Sign in required" }, { status: 401, headers: cors });
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const adminKey = serviceKey();
  if (!url || !anon || !adminKey) {
    return Response.json({ error: "Server config missing" }, { status: 500, headers: cors });
  }

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return Response.json({ error: "Invalid session" }, { status: 401, headers: cors });
  }

  const admin = createClient(url, adminKey);
  const { data: account, error } = await admin
    .from("user_accounts")
    .select("email,plan_status,payment_status,payment_provider,payment_id,amount_paid_paise,purchased_at,access_expires_at,auth_provider,free_questions_used")
    .eq("user_id", userData.user.id)
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500, headers: cors });
  }

  const accessActive = account?.plan_status === "annual"
    && account?.payment_status === "paid"
    && account?.access_expires_at
    && new Date(account.access_expires_at).getTime() > Date.now();

  return Response.json({
    ...account,
    access_active: !!accessActive,
    free_question_available: !accessActive && (account?.free_questions_used ?? 0) < FREE_QUESTIONS,
    user_id: userData.user.id,
    auth_email: userData.user.email || null,
  }, { headers: { ...cors, "Content-Type": "application/json" } });
});
