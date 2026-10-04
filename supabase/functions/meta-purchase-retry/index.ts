import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient } from "../_shared/server.ts";
import { deliverMetaPurchase, META_MAX_ATTEMPTS, META_RETRY_WINDOW_MS } from "../_shared/meta.ts";

// Retries server-side Meta Purchases that Meta hasn't accepted yet (rejected,
// timed out, or sent before the token was set). Run every 10 minutes by the
// pg_cron job "meta-purchase-retry"; callers must send the x-worker-token
// held in the vault secret meta_retry_token.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const admin = adminClient();
  if (!admin) return Response.json({ error: "Unavailable" }, { status: 503 });
  const { data: ok } = await admin.rpc("meta_retry_token_ok", { p_token: req.headers.get("x-worker-token") || "" });
  if (ok !== true) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { data: rows, error } = await admin.from("payment_transactions")
    .select("payment_id")
    .eq("status", "paid").is("meta_sent_at", null).not("payment_id", "is", null)
    .gte("paid_at", new Date(Date.now() - META_RETRY_WINDOW_MS).toISOString())
    .lt("meta_attempts", META_MAX_ATTEMPTS)
    .or("meta_next_try_at.is.null,meta_next_try_at.lte." + new Date().toISOString())
    .order("paid_at", { ascending: true }).limit(20);
  if (error) {
    console.error("meta-purchase-retry query failed", error.message);
    return Response.json({ error: "Query failed" }, { status: 500 });
  }
  const results: Record<string, number> = {};
  for (const r of rows || []) {
    const outcome = await deliverMetaPurchase(admin, r.payment_id);
    results[outcome] = (results[outcome] || 0) + 1;
  }
  return Response.json({ checked: rows?.length || 0, ...results });
});
