// FeelReply — Contact form email sender
// Deploy: Supabase → Edge Functions → New Function → name "contact-email" → paste → Deploy
// Uses existing RESEND_API_KEY secret

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { name, email, message } = await req.json()

    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FeelReply Contact <noreply@feelreply.com>',
        to: 'feelreply@gmail.com',
        reply_to: email,
        subject: `Contact from ${name}`,
        html: `
          <div style="font-family:sans-serif;background:#0a0a0a;padding:32px;border-radius:12px;max-width:520px;">
            <p style="color:#a78bfa;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px;">New contact message</p>
            <p style="color:#fff;font-size:18px;font-weight:700;margin:0 0 20px;">From ${name}</p>
            <p style="color:#a1a1aa;font-size:13px;margin:0 0 4px;"><strong style="color:#71717a;">Email:</strong> <a href="mailto:${email}" style="color:#a78bfa;">${email}</a></p>
            <div style="background:#1a1a1a;border:1px solid #262626;border-radius:10px;padding:16px;margin-top:16px;">
              <p style="color:#a1a1aa;font-size:14px;line-height:1.7;margin:0;">${message.replace(/\n/g, '<br>')}</p>
            </div>
          </div>`,
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
