// Retired: the site plays its own copy of the raga (/alex-morgan-indian-classical-raga-537491.mp3).
// This used to proxy audio from Pixabay for anyone who called it.
Deno.serve(() => new Response("Gone", { status: 410 }));
