// FeelReply — Auto-approve pending drafts after 24 hours (Pro / Max plans only)
// Deploy: Supabase → Edge Functions → New Function → name "auto-approve" → paste → Deploy
//
// Then set up the hourly cron in Supabase SQL Editor:
//
//   select cron.schedule(
//     'auto-approve-drafts',
//     '0 * * * *',   -- every hour
//     $$
//       select net.http_post(
//         url    := 'https://alqevbdpeuwrosjcvauf.supabase.co/functions/v1/auto-approve',
//         headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
//         body   := '{}'::jsonb
//       );
//     $$
//   );
//
// Replace YOUR_SERVICE_ROLE_KEY with the actual key from Supabase → Project Settings → API.
// Requires pg_cron and pg_net extensions (enable in Supabase → Database → Extensions).

import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  // Only allow calls with the service role key (from cron or internal)
  const auth = req.headers.get('authorization')?.replace('Bearer ', '')
  if (auth !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const sb      = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const cutoff  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Find all pending drafts older than 24 hours
  const { data: drafts, error } = await sb
    .from('reply_drafts')
    .select('id, review_id, user_id, created_at')
    .eq('status', 'pending')
    .lt('created_at', cutoff)

  if (error) {
    console.error('Query error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  if (!drafts?.length) {
    return new Response(JSON.stringify({ approved: 0, skipped: 0, message: 'No eligible drafts' }))
  }

  let approved = 0
  let skipped  = 0

  for (const draft of drafts) {
    // Check user has an active Pro or Max plan AND has enabled auto-post
    const { data: profile } = await sb
      .from('profiles')
      .select('plan, plan_expires_at, auto_post_enabled')
      .eq('id', draft.user_id)
      .single()

    const plan    = profile?.plan
    const expires = profile?.plan_expires_at
    const isPro   = plan &&
      ['pro', 'max'].includes(plan) &&
      (!expires || new Date(expires) > new Date())

    if (!isPro || !profile?.auto_post_enabled) { skipped++; continue }

    const [r1, r2] = await Promise.all([
      sb.from('reply_drafts').update({ status: 'approved' }).eq('id', draft.id),
      sb.from('reviews').update({ status: 'replied' }).eq('id', draft.review_id),
    ])

    if (r1.error || r2.error) {
      console.error('Update error for draft', draft.id, r1.error?.message, r2.error?.message)
      skipped++
    } else {
      approved++
      console.log('Auto-approved draft', draft.id, 'for user', draft.user_id)
    }
  }

  return new Response(JSON.stringify({ approved, skipped, total: drafts.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
