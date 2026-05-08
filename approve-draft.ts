// FeelReply — One-click draft approval from email
// Deploy: Supabase → Edge Functions → New Function → name "approve-draft" → paste → Deploy
// No extra secrets needed (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-provided)
// IMPORTANT: disable JWT verification for this function in Supabase dashboard

import { createClient } from 'npm:@supabase/supabase-js@2'

const PAGES_BASE = 'https://flacelol.github.io/feelreply/approved.html'

function redirect(status: 'success' | 'already' | 'error', msg?: string) {
  const dest = new URL(PAGES_BASE)
  dest.searchParams.set('status', status)
  if (msg) dest.searchParams.set('msg', msg)
  return new Response(null, { status: 302, headers: { Location: dest.toString() } })
}

Deno.serve(async (req) => {
  const url      = new URL(req.url)
  const draftId  = url.searchParams.get('draft_id')
  const reviewId = url.searchParams.get('review_id')

  if (!draftId || !reviewId) {
    return redirect('error', 'The approval link is invalid or incomplete.')
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
    return redirect('error', 'This draft may have already been approved or deleted.')
  }

  if (draft.status !== 'pending') {
    return redirect(
      draft.status === 'approved' ? 'already' : 'error',
      draft.status !== 'approved' ? 'This draft was previously rejected. Open the dashboard to generate a new one.' : undefined
    )
  }

  const [r1, r2] = await Promise.all([
    supabase.from('reply_drafts').update({ status: 'approved' }).eq('id', draftId),
    supabase.from('reviews').update({ status: 'replied' }).eq('id', reviewId),
  ])

  if (r1.error || r2.error) {
    return redirect('error', 'Could not approve the reply. Please try from the dashboard.')
  }

  return redirect('success')
})
