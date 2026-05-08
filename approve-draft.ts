// FeelReply — One-click draft approval from email
// Deploy: Supabase → Edge Functions → New Function → name "approve-draft" → paste → Deploy
// No extra secrets needed (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-provided)

import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const url      = new URL(req.url)
  const draftId  = url.searchParams.get('draft_id')
  const reviewId = url.searchParams.get('review_id')

  if (!draftId || !reviewId) {
    return page('Missing parameters', false, 'The approval link is invalid or incomplete.')
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Check draft still exists and is pending
  const { data: draft, error: fetchErr } = await supabase
    .from('reply_drafts')
    .select('status')
    .eq('id', draftId)
    .single()

  if (fetchErr || !draft) {
    return page('Draft not found', false, 'This draft may have already been approved or deleted.')
  }

  if (draft.status !== 'pending') {
    return page(
      draft.status === 'approved' ? 'Already approved' : 'Draft rejected',
      draft.status === 'approved',
      draft.status === 'approved'
        ? 'This reply was already approved.'
        : 'This draft was previously rejected. Open the dashboard to generate a new one.'
    )
  }

  const [r1, r2] = await Promise.all([
    supabase.from('reply_drafts').update({ status: 'approved' }).eq('id', draftId),
    supabase.from('reviews').update({ status: 'replied' }).eq('id', reviewId),
  ])

  if (r1.error || r2.error) {
    return page('Something went wrong', false, 'Could not approve the reply. Please try from the dashboard.')
  }

  return page('Reply Approved!', true, 'Your AI reply has been approved and is ready to post on Google Maps.')
})

function page(title: string, success: boolean, message: string) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>FeelReply — ${title}</title>
  <style>
    *{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0a0a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
    .card{background:#111;border:1px solid #1f1f1f;border-radius:20px;padding:2.5rem;text-align:center;max-width:400px;width:100%}
    .icon{width:60px;height:60px;border-radius:50%;margin:0 auto 1.25rem;display:flex;align-items:center;justify-content:center}
    .ok{background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.28)}
    .err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.28)}
    h1{font-size:1.25rem;font-weight:700;margin-bottom:.5rem}
    p{color:#71717a;font-size:.875rem;line-height:1.6;margin-bottom:1.75rem}
    a{display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;text-decoration:none;padding:.75rem 1.75rem;border-radius:10px;font-weight:600;font-size:.875rem;box-shadow:0 0 20px rgba(124,58,237,.35)}
    .logo{font-size:1rem;font-weight:700;margin-bottom:2rem;color:#fff}
    .logo span{color:#a78bfa}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Feel<span>Reply</span></div>
    <div class="icon ${success ? 'ok' : 'err'}">
      ${success
        ? '<svg width="26" height="26" fill="none" stroke="#4ade80" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>'
        : '<svg width="26" height="26" fill="none" stroke="#f87171" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/></svg>'
      }
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="https://flacelol.github.io/feelreply/dashboard.html">Open Dashboard →</a>
  </div>
</body>
</html>`

  return new Response(html, {
    status: success ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
