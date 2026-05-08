// FeelReply — One-click draft approval from email
// Deploy: Supabase → Edge Functions → New Function → name "approve-draft" → paste → Deploy
// No extra secrets needed (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-provided)

import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const url      = new URL(req.url)
  const draftId  = url.searchParams.get('draft_id')
  const reviewId = url.searchParams.get('review_id')

  if (!draftId || !reviewId) {
    return page('error', 'Something went wrong', 'The approval link is invalid or incomplete.')
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: draft, error: fetchErr } = await supabase
    .from('reply_drafts')
    .select('status')
    .eq('id', draftId)
    .single()

  if (fetchErr || !draft) {
    return page('error', 'Draft not found', 'This draft may have already been approved or deleted.')
  }

  if (draft.status !== 'pending') {
    if (draft.status === 'approved') {
      return page('already', 'Already Approved', 'This reply was already approved earlier.')
    }
    return page('error', 'Draft rejected', 'This draft was previously rejected. Open the dashboard to generate a new one.')
  }

  const [r1, r2] = await Promise.all([
    supabase.from('reply_drafts').update({ status: 'approved' }).eq('id', draftId),
    supabase.from('reviews').update({ status: 'replied' }).eq('id', reviewId),
  ])

  if (r1.error || r2.error) {
    return page('error', 'Something went wrong', 'Could not approve the reply. Please try from the dashboard.')
  }

  return page('success', 'Reply Approved!', 'Your AI reply has been approved and is ready to post on Google Maps.')
})

function page(status: 'success' | 'already' | 'error', title: string, subtitle: string) {
  const isSuccess = status === 'success'
  const isAlready = status === 'already'

  const iconColor  = isSuccess ? '#4ade80' : isAlready ? '#a78bfa' : '#f87171'
  const iconBg     = isSuccess ? 'rgba(74,222,128,0.12)'  : isAlready ? 'rgba(124,58,237,0.12)' : 'rgba(239,68,68,0.12)'
  const iconBorder = isSuccess ? 'rgba(74,222,128,0.28)'  : isAlready ? 'rgba(124,58,237,0.28)' : 'rgba(239,68,68,0.28)'
  const iconGlow   = isSuccess ? 'rgba(74,222,128,0.12)'  : isAlready ? 'rgba(124,58,237,0.12)' : 'rgba(239,68,68,0.12)'
  const orbColor   = isSuccess ? 'rgba(74,222,128,0.08)'  : isAlready ? 'rgba(124,58,237,0.08)' : 'rgba(239,68,68,0.06)'

  const iconPath = isSuccess
    ? '<path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>'
    : isAlready
      ? '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>'
      : '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/>'

  const confetti = isSuccess ? `
    <div class="dots" id="dots"></div>
    <script>
      const colors = ['#a78bfa','#7c3aed','#4ade80','#e0d7ff','#fbbf24']
      const dots = document.getElementById('dots')
      for (let i = 0; i < 28; i++) {
        const d = document.createElement('div')
        d.className = 'dot'
        const size = 5 + Math.random() * 8
        d.style.cssText = 'width:'+size+'px;height:'+size+'px;left:'+(Math.random()*100)+'%;background:'+colors[Math.floor(Math.random()*colors.length)]+';opacity:'+(0.4+Math.random()*0.5)+';animation-duration:'+(2+Math.random()*3)+'s;animation-delay:'+(Math.random()*0.8)+'s;'
        dots.appendChild(d)
      }
    <\/script>` : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FeelReply</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{font-family:'Inter',sans-serif;box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%}
    body{background:#0a0a0a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;-webkit-font-smoothing:antialiased;background-image:linear-gradient(rgba(255,255,255,0.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.022) 1px,transparent 1px);background-size:56px 56px}
    .card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:2.5rem 2rem;text-align:center;max-width:420px;width:100%;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 24px 64px rgba(0,0,0,0.5);animation:fadeUp 0.45s cubic-bezier(0.16,1,0.3,1) forwards}
    @keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
    .logo{font-size:1.0625rem;font-weight:700;color:#fff;letter-spacing:-0.02em;margin-bottom:2rem}
    .logo span{color:#a78bfa}
    .icon-wrap{width:72px;height:72px;border-radius:50%;margin:0 auto 1.5rem;display:flex;align-items:center;justify-content:center;background:${iconBg};border:1px solid ${iconBorder};box-shadow:0 0 32px ${iconGlow}}
    h1{font-size:1.375rem;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:0.5rem}
    .subtitle{font-size:0.9375rem;color:#52525b;line-height:1.65;margin-bottom:2rem}
    .btn{display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;text-decoration:none;padding:0.8rem 1.75rem;border-radius:10px;font-weight:600;font-size:0.9375rem;letter-spacing:-0.01em;box-shadow:0 0 24px rgba(124,58,237,0.35);transition:opacity 0.2s,transform 0.15s}
    .btn:hover{opacity:0.87;transform:translateY(-1px)}
    .dots{position:fixed;inset:0;pointer-events:none;overflow:hidden}
    .dot{position:absolute;border-radius:50%;animation:fall linear forwards}
    @keyframes fall{0%{transform:translateY(-20px) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(360deg);opacity:0}}
  </style>
</head>
<body>
  <div style="position:fixed;inset:0;pointer-events:none;">
    <div style="position:absolute;width:600px;height:600px;border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%);background:radial-gradient(circle,${orbColor} 0%,transparent 65%)"></div>
  </div>
  ${confetti}
  <div class="card">
    <div class="logo">Feel<span>Reply</span></div>
    <div class="icon-wrap">
      <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="${iconColor}">${iconPath}</svg>
    </div>
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    <a href="https://flacelol.github.io/feelreply/dashboard.html" class="btn">Open Dashboard →</a>
  </div>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
