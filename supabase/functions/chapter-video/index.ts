import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

// Chapter explainer videos (animation by Spiritual Point, used with
// permission) are kept in a private Cloudflare R2 bucket. This returns a
// link to one video that works for 3 hours: chapter 1 for everyone, the
// others for members with active paid access.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FREE_CHAPTERS = new Set([1]);
const LINK_SECONDS = 3 * 60 * 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Same rule as ask-krishna and tts-krishna.
async function hasActiveAccess(authHeader: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anon || !authHeader.startsWith("Bearer ")) return false;
  const supabase = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return false;
  const { data: account, error } = await supabase
    .from("user_accounts")
    .select("plan_status,payment_status,access_expires_at")
    .eq("user_id", userData.user.id)
    .single();
  return !error
    && account?.plan_status === "annual"
    && account?.payment_status === "paid"
    && !!account?.access_expires_at
    && new Date(account.access_expires_at).getTime() > Date.now();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const chapter = Number(body?.chapter);
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 18) return json({ error: "Unknown chapter" }, 400);
    if (!FREE_CHAPTERS.has(chapter) && !(await hasActiveAccess(req.headers.get("Authorization") ?? ""))) {
      return json({ error: "Annual Access required", paywall: true }, 403);
    }
    const account = Deno.env.get("R2_ACCOUNT_ID") ?? "", accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "", bucket = Deno.env.get("R2_BUCKET") || "gita-chapter-videos";
    if (!account || !accessKeyId || !secretAccessKey) return json({ error: "This video is not available yet." }, 503);
    const r2 = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
    const target = new URL(`https://${account}.r2.cloudflarestorage.com/${bucket}/gita-chapter-${chapter}.mp4`);
    target.searchParams.set("X-Amz-Expires", String(LINK_SECONDS));
    const signed = await r2.sign(new Request(target, { method: "GET" }), { aws: { signQuery: true } });
    return json({ url: signed.url, expires_in: LINK_SECONDS });
  } catch (e) {
    console.error("chapter-video failed", String(e));
    return json({ error: "Could not load the video. Please try again." }, 500);
  }
});
