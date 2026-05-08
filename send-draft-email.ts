// FeelReply — Supabase Edge Function
// Deploy: Supabase Dashboard → Edge Functions → New Function → name "send-draft-email" → paste this → Deploy
// Then: Project Settings → Edge Functions → Add secret: RESEND_API_KEY = your key

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { reviewerName, rating, reviewText, draftText, ownerEmail, businessName, dashboardUrl, draftId, reviewId } = await req.json()
    const approveUrl = draftId && reviewId
      ? `https://alqevbdpeuwrosjcvauf.supabase.co/functions/v1/approve-draft?draft_id=${draftId}&review_id=${reviewId}`
      : null

    const starsStr = '★'.repeat(rating) + '☆'.repeat(5 - rating)
    const ratingLabel = rating >= 4 ? '🟢 Positive' : rating === 3 ? '🟡 Neutral' : '🔴 Negative'

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

  <!-- Logo -->
  <tr><td style="padding-bottom:28px;text-align:center;">
    <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Feel<span style="color:#a78bfa;">Reply</span></span>
  </td></tr>

  <!-- Card -->
  <tr><td style="background:#111111;border:1px solid #1f1f1f;border-radius:16px;padding:32px;">

    <!-- Label -->
    <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#7c3aed;text-transform:uppercase;letter-spacing:0.08em;">New Review Detected</p>

    <!-- Headline -->
    <h1 style="margin:0 0 6px;font-size:21px;font-weight:700;color:#ffffff;line-height:1.3;">${starsStr} from ${reviewerName}</h1>
    <p style="margin:0 0 24px;font-size:13px;color:#52525b;">${ratingLabel} · ${businessName}</p>

    <!-- Review -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
    <tr><td style="background:#1a1a1a;border:1px solid #262626;border-radius:10px;padding:16px;">
      <p style="margin:0 0 8px;font-size:10px;font-weight:600;color:#52525b;text-transform:uppercase;letter-spacing:0.08em;">Customer review</p>
      <p style="margin:0;font-size:14px;color:#a1a1aa;line-height:1.7;">${reviewText || '<em>No review text provided.</em>'}</p>
    </td></tr>
    </table>

    <!-- Draft -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
    <tr><td style="background:#16082e;border:1px solid #2d1855;border-radius:10px;padding:16px;">
      <p style="margin:0 0 8px;font-size:10px;font-weight:600;color:#7c3aed;text-transform:uppercase;letter-spacing:0.08em;">✦ AI reply draft</p>
      <p style="margin:0;font-size:14px;color:#d4d4d8;line-height:1.75;white-space:pre-line;">${draftText}</p>
    </td></tr>
    </table>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" width="100%">
    <tr><td align="center" style="padding-bottom:12px;">
      ${approveUrl ? `<a href="${approveUrl}" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:10px;letter-spacing:-0.01em;box-shadow:0 0 24px rgba(22,163,74,0.35);">
        ✓ Accept Reply
      </a>` : ''}
    </td></tr>
    <tr><td align="center">
      <a href="${dashboardUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 28px;border-radius:10px;letter-spacing:-0.01em;opacity:0.85;">
        Open Dashboard →
      </a>
    </td></tr>
    </table>

  </td></tr>

  <!-- Footer -->
  <tr><td style="padding-top:24px;text-align:center;">
    <p style="margin:0 0 4px;font-size:12px;color:#3f3f46;">FeelReply · AI-powered Google Maps review replies</p>
    <p style="margin:0;font-size:12px;color:#3f3f46;">Sent because you have FeelReply active for <strong style="color:#52525b;">${businessName}</strong>.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FeelReply <noreply@feelreply.com>',
        to: ownerEmail,
        subject: `${starsStr} New review from ${reviewerName} — reply ready`,
        html,
      }),
    })

    const data = await res.json()

    return new Response(JSON.stringify(data), {
      status: res.ok ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
