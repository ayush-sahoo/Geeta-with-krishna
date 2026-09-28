// Visitor location from Vercel's edge (IP-based, city-level). The site sends
// it along with each page visit so the admin dashboard can show where
// visitors and sign-ups come from. Nothing is stored here.
export default function handler(req, res) {
  const h = (k) => {
    const v = req.headers[k];
    if (!v) return null;
    try { return decodeURIComponent(v).slice(0, 80); } catch { return String(v).slice(0, 80); }
  };
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({ country: h('x-vercel-ip-country'), region: h('x-vercel-ip-country-region'), city: h('x-vercel-ip-city') });
}
