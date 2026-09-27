import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired: this public diagnostic endpoint spent API quota on every call.
Deno.serve(() => Response.json({ error: "Not found" }, { status: 404 }));
