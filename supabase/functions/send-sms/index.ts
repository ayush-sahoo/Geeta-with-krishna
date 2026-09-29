import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

// Supabase Auth "Send SMS" hook: Supabase generates the OTP and calls this
// function, which delivers it through MSG91 using the DLT-approved template
// (its text contains ##OTP##). Requests are verified with the hook secret.
//
// Secrets: SEND_SMS_HOOK_SECRET (from Auth > Hooks), MSG91_AUTH_KEY,
// MSG91_TEMPLATE_ID.

const hookSecret = (Deno.env.get("SEND_SMS_HOOK_SECRET") || "").replace("v1,whsec_", "");

function fail(message: string, status = 500) {
  console.error("send-sms:", message);
  return Response.json({ error: { http_code: status, message } }, { status });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);
  const authKey = Deno.env.get("MSG91_AUTH_KEY") || "";
  const templateId = Deno.env.get("MSG91_TEMPLATE_ID") || "";
  if (!hookSecret || !authKey || !templateId) return fail("SMS is not configured");

  let user: { phone?: string }, sms: { otp?: string };
  try {
    ({ user, sms } = new Webhook(hookSecret).verify(await req.text(), Object.fromEntries(req.headers)) as any);
  } catch {
    return fail("Invalid signature", 401);
  }

  const mobile = String(user?.phone || "").replace(/\D/g, "");
  const otp = String(sms?.otp || "");
  if (!/^91[6-9]\d{9}$/.test(mobile)) return fail("Only Indian mobile numbers are supported", 400);
  if (!/^\d{4,8}$/.test(otp)) return fail("Missing OTP", 400);

  const url = new URL("https://control.msg91.com/api/v5/otp");
  url.search = new URLSearchParams({ template_id: templateId, mobile, otp, otp_expiry: "10" }).toString();
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: { authkey: authKey, "Content-Type": "application/json", accept: "application/json" },
      body: "{}",
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.type !== "success") return fail(`MSG91 rejected the SMS: ${d?.message || r.status}`, 502);
  } catch (e) {
    return fail(`MSG91 unreachable: ${String(e)}`, 502);
  }
  return Response.json({});
});
