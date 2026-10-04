"""Generates privacy.html, terms.html, refund.html and contact.html from one
template so the policy pages share a header, footer and theme.
Edit the PAGES content below, then run: python3 tools/build_legal_pages.py"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EMAIL = "support@edumorph.in"
UPDATED = "30 September 2026"
# Pages changed since then show their own date.
UPDATED_ON = {"privacy.html": "4 October 2026", "terms.html": "4 October 2026", "refund.html": "4 October 2026"}
MAIL = f'<a href="mailto:{EMAIL}">{EMAIL}</a>'
NAV = [("privacy.html", "Privacy Policy"), ("terms.html", "Terms of Service"),
       ("refund.html", "Refund Policy"), ("contact.html", "Contact Us")]

PAGES = {
"privacy.html": ("Privacy Policy", "Privacy", f"""
<p>This Privacy Policy explains how Gita Verse (<a href="https://gitaverse.co.in">gitaverse.co.in</a>, "we", "us") collects, uses and protects your information when you use our website and services.</p>

<h2>Information we collect</h2>
<ul>
<li><strong>Account details:</strong> your mobile number or email address, depending on how you sign in, and, if you sign in with Google, your name and email as shared by Google.</li>
<li><strong>Purchase details:</strong> the amount, date, payment ID and access expiry of your access purchase. Payments are processed by Razorpay; we never see or store your card, UPI or bank details.</li>
<li><strong>Questions you ask Krishna:</strong> the text you type in Ask Krishna, and your recent messages in that conversation, are sent to generate a reply. If you are signed in, your conversations with Krishna are saved to your account so you can see and continue them later; only you can see them. If you ask without signing in, the conversation is kept only in your browser, and to limit misuse of the free question we keep a one-way code (hash) of your network address, never the address itself.</li>
<li><strong>Usage and device data:</strong> basic technical information such as browser type, pages visited and approximate location derived from your IP address.</li>
<li><strong>Saved verses:</strong> verses you save are stored in your own browser, not on our servers.</li>
</ul>

<h2>How we use your information</h2>
<ul>
<li>To create and secure your account and let you sign in.</li>
<li>To process your purchase and give you access to paid features for the period you paid for.</li>
<li>To generate Ask Krishna replies and verse narration.</li>
<li>To measure and improve our advertising and the service.</li>
<li>To respond to your messages and support requests.</li>
</ul>

<h2>Service providers we share data with</h2>
<p>We share only what each provider needs to perform its service:</p>
<ul>
<li><strong>Supabase</strong> (database and sign-in; data stored in Mumbai, India).</li>
<li><strong>Vercel</strong> (website hosting).</li>
<li><strong>Razorpay</strong> (payment processing).</li>
<li><strong>MSG91</strong> (sends the one-time sign-in code to your mobile number by SMS).</li>
<li><strong>Google</strong> (Google sign-in, and Gemini to generate Ask Krishna replies).</li>
<li><strong>ElevenLabs</strong> (text-to-speech for verse narration).</li>
<li><strong>Meta</strong> (the Meta Pixel measures visits, sign-ups and purchases for our Facebook and Instagram ads). When you are signed in, your email address or mobile number and account ID are converted to a one-way code (hashed) in your browser before being sent, so Meta can match ad results without receiving them in readable form. When you buy a plan, our server may also tell Meta that a purchase happened (plan and amount), with the same one-way codes and your browser's Meta cookie IDs, so the purchase is counted even if you don't return to the site.</li>
</ul>
<p>We do not sell your personal information.</p>

<h2>Cookies and tracking</h2>
<p>We use your browser's local storage to keep you signed in and remember saved verses. The Meta Pixel uses cookies to measure ad performance. You can clear these at any time in your browser settings, or limit ad tracking in your Facebook and Instagram ad preferences.</p>

<h2>Data retention</h2>
<p>We keep your account, saved conversations and purchase records while your account exists, and purchase records as long as required by law (for example, tax and accounting records). You can delete your saved conversations yourself at any time from the Account screen ("Delete my chat history"), or ask us to delete them or your whole account by emailing {MAIL} from your registered email or mobile number.</p>

<h2>Your rights</h2>
<p>Under the Digital Personal Data Protection Act, 2023 and other applicable Indian law, you may ask to access, correct or delete your personal data, or withdraw consent. Email {MAIL} from your registered address and we will respond within 30 days.</p>

<h2>Children</h2>
<p>Gita Verse is intended for users aged 18 and above. Users under 18 should use it only with the consent and supervision of a parent or guardian.</p>

<h2>Security</h2>
<p>We use encrypted connections (HTTPS), access controls and reputable providers to protect your data. No online service is completely secure, but we work to protect your information.</p>

<h2>Changes and grievances</h2>
<p>We may update this policy; the date above shows the latest version. For questions or grievances about your data, contact our grievance officer at {MAIL}.</p>
"""),

"terms.html": ("Terms of Service", "Terms", f"""
<p>These Terms govern your use of Gita Verse (<a href="https://gitaverse.co.in">gitaverse.co.in</a>). By creating an account or using the service, you agree to them.</p>

<h2>The service</h2>
<p>Gita Verse offers Bhagavad Gita verses with translations and explanations, life-topic guidance, verse narration and "Ask Krishna", an AI-generated devotional reflection based on the Gita. Some content is free; full access requires a paid plan (Annual Access or 3-Month Access).</p>

<h2>Your account</h2>
<ul>
<li>Provide accurate information and keep your login secure. You are responsible for activity on your account.</li>
<li>Accounts are for personal use and may not be shared, sold or transferred.</li>
<li>You must be 18 or older, or use Gita Verse with a parent or guardian's consent.</li>
</ul>

<h2>Plans and payment</h2>
<ul>
<li>Annual Access costs <strong>₹999</strong> (inclusive of applicable taxes) and gives full access for <strong>12 months</strong> from the date of payment.</li>
<li>3-Month Access costs <strong>₹399</strong> (inclusive of applicable taxes) and gives full access for <strong>3 months</strong> from the date of payment.</li>
<li>Each plan is a one-time payment. It does <strong>not</strong> renew automatically, and you will never be charged again unless you choose to buy again. A purchase made while access is active is added on after the current access ends.</li>
<li>Payments are processed securely by Razorpay. All purchases are final and non-refundable, except for billing errors described in our <a href="refund.html">Refund Policy</a>.</li>
<li>We may change prices for future purchases; this never affects access you have already paid for.</li>
</ul>

<h2>About Ask Krishna and AI content</h2>
<p>Ask Krishna replies are generated by artificial intelligence in a devotional voice inspired by the Bhagavad Gita. They are <strong>not</strong> the words of any deity or religious authority, and they may sometimes be inaccurate. They are for spiritual reflection only and are not medical, psychological, legal or financial advice. If you are in distress or danger, please contact a qualified professional or call Tele-MANAS at 14416 or emergency services at 112.</p>

<h2>Acceptable use</h2>
<p>You agree not to misuse the service, including by attempting to access paid content without paying, copying or scraping content in bulk, interfering with the service's security or operation, or using it for anything unlawful or abusive.</p>

<h2>Content and intellectual property</h2>
<p>The Bhagavad Gita is an ancient text. The design, explanations, audio, artwork and software of Gita Verse belong to us or our licensors and may not be reproduced without permission.</p>

<h2>Suspension</h2>
<p>We may suspend or close accounts that breach these Terms. You may stop using the service at any time and ask us to delete your account.</p>

<h2>Disclaimer and liability</h2>
<p>The service is provided "as is". We work to keep it available and accurate but do not guarantee it will be uninterrupted or error-free. To the extent permitted by law, our total liability to you is limited to the amount you paid us in the 12 months before the claim.</p>

<h2>Governing law</h2>
<p>These Terms are governed by the laws of India, and disputes are subject to the jurisdiction of the courts of India.</p>

<h2>Changes and contact</h2>
<p>We may update these Terms; the date above shows the latest version. Questions? Email {MAIL}.</p>
"""),

"refund.html": ("Refund Policy", "Refunds", f"""
<p>This policy applies to Annual Access (₹999 for 12 months) and 3-Month Access (₹399 for 3 months) on Gita Verse.</p>

<h2>No refunds</h2>
<p>All purchases of Annual Access and 3-Month Access are <strong>final and non-refundable</strong>. Once your payment is successful and access is activated, we do not offer refunds or partial refunds, including for unused time.</p>
<p>You can explore today's verse and the free parts of Gita Verse before you buy.</p>

<h2>Billing errors</h2>
<p>If you were charged more than once for the same purchase, or money was deducted but your access was not activated, email {MAIL} with your payment ID or the date and time of payment. We will activate your access or return the extra charge to your original payment method through Razorpay.</p>

<h2>No automatic renewals</h2>
<p>Both plans are one-time payments and never renew automatically, so there is nothing to cancel. You will not be charged again unless you choose to buy again.</p>

<h2>Contact</h2>
<p>For any payment question, email {MAIL}. We usually reply within 2 business days.</p>
"""),

"contact.html": ("Contact Us", "Contact", f"""
<p>We are happy to help with your account, payments, or any question about Gita Verse.</p>
<a class="legal-contact" href="mailto:{EMAIL}"><small>Email us</small><strong>{EMAIL}</strong></a>
<p>We usually reply within <strong>2 business days</strong>.</p>

<h2>For payment questions</h2>
<p>Please write from the email address you use to sign in, and include your payment ID or the date and time of payment. This helps us find your purchase quickly.</p>

<h2>Useful links</h2>
<ul>
<li><a href="refund.html">Refund Policy</a>: all sales final; billing errors</li>
<li><a href="privacy.html">Privacy Policy</a>: your data and how to delete it</li>
<li><a href="terms.html">Terms of Service</a></li>
</ul>

<h2>Website</h2>
<p><a href="https://gitaverse.co.in">gitaverse.co.in</a></p>
"""),
}

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="only light">
<title>{title} · Gita Verse</title>
<meta name="description" content="{title} for Gita Verse (gitaverse.co.in).">
<link rel="stylesheet" href="legal.css">
</head>
<body>
<div class="legal-app">
<header class="legal-top">
<a class="legal-brand" href="/"><span class="om">ॐ</span><span><b>Gita Verse</b><small>Read · Reflect · Ask</small></span></a>
<a class="legal-home" href="/">← Home</a>
</header>
<main class="legal-card">
<div class="legal-label">{label}</div>
<h1>{title}</h1>
<p class="legal-updated">Last updated: {updated}</p>
{body}
</main>
<footer>
<ul class="legal-links">{links}</ul>
<p class="legal-foot">© 2026 Gita Verse · {email}</p>
</footer>
</div>
</body>
</html>
"""

for name, (title, label, body) in PAGES.items():
    current = ' aria-current="page"'
    links = "".join(
        f'<li><a href="{href}"{current if href == name else ""}>{text}</a></li>'
        for href, text in NAV)
    (ROOT / name).write_text(TEMPLATE.format(
        title=title, label=label, updated=UPDATED_ON.get(name, UPDATED), body=body.strip(), links=links, email=EMAIL))
    print("wrote", name)
