import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Admin dashboard data, for the business owner only. A caller must match BOTH
// the admin email and a pinned account id: email sign-up doesn't verify inbox
// ownership, so an email match alone could be claimed by anyone who registers
// that address first. Override with the ADMIN_EMAILS / ADMIN_USER_IDS secrets.
const DEFAULT_ADMINS = ["ayush@edumorph.in"];
const DEFAULT_ADMIN_IDS = ["67471da2-2513-4e93-b101-503e2a36f88b"]; // ayush@edumorph.in
// Your own test accounts: shown in the users list, excluded from funnel counts.
const DEFAULT_TEST_USERS = [
  "9ebada1d-bd5a-4318-a604-ce232f88cbf7", // ayushsahoo2000@gmail.com
  "97d6832f-5c25-4360-a712-a38858d6eb7b", // ayushpicbackup2.0@gmail.com
  "d4dd8e62-ccb3-49c1-82af-76f4b367f059", // ayush@edumoprh.in
  "67471da2-2513-4e93-b101-503e2a36f88b", // ayush@edumorph.in (admin)
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getSecretKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try { return JSON.parse(raw)["default"] || ""; } catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function list(env: string, fallback: string[]) {
  const v = Deno.env.get(env);
  return (v ? v.split(",") : fallback).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const adminKey = getSecretKey();
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);

    const { data: userData, error: userError } = await createClient(url, anon, {
      global: { headers: { Authorization: auth } },
    }).auth.getUser();
    if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);

    const email = (userData.user.email || "").toLowerCase();
    const adminIds = list("ADMIN_USER_IDS", DEFAULT_ADMIN_IDS);
    if (!list("ADMIN_EMAILS", DEFAULT_ADMINS).includes(email) || !adminIds.includes(userData.user.id.toLowerCase())) {
      return json({ error: "This account is not an admin" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const since = new Date(body?.since || 0);
    if (isNaN(since.getTime())) return json({ error: "Bad 'since' date" }, 400);

    const { data, error } = await createClient(url, adminKey).rpc("admin_stats", {
      p_since: since.toISOString(),
      p_exclude: list("TEST_USER_IDS", DEFAULT_TEST_USERS),
    });
    if (error) throw error;

    return json({ ...data, generated_at: new Date().toISOString(), admin: email });
  } catch (e) {
    console.error("admin-stats failed", String(e?.message || e));
    return json({ error: "Could not load stats" }, 500);
  }
});
