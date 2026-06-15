// FeelReply — Cancel Stripe subscription at period end
// Deploy: Supabase → Edge Functions → New Function → name "cancel-subscription" → paste → Deploy
// Secrets needed: STRIPE_SECRET_KEY (already set for stripe-webhook)

import { createClient } from 'npm:@supabase/supabase-js@2'

async function tg(text: string): Promise<void> {
  const token  = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')
  if (!token || !chatId) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(() => {})
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const jwt = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: { user } } = await sb.auth.getUser(jwt)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const { data: profile } = await sb.from('profiles').select('stripe_customer_id, plan, notification_email').eq('id', user.id).single()

    let customerId = profile?.stripe_customer_id

    // Fallback: look up customer by email if stripe_customer_id is missing
    if (!customerId) {
      const searchRes = await fetch(
        `https://api.stripe.com/v1/customers/search?query=email:"${encodeURIComponent(user.email!)}"&limit=1`,
        { headers: { 'Authorization': `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` } }
      )
      const searchData = await searchRes.json()
      customerId = searchData.data?.[0]?.id
      if (customerId) {
        await sb.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id)
      }
    }

    if (!customerId) {
      return new Response(JSON.stringify({ error: 'No subscription found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Find active or trialing subscription
    const [activeRes, trialRes] = await Promise.all([
      fetch(`https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active&limit=1`, {
        headers: { 'Authorization': `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` },
      }),
      fetch(`https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=trialing&limit=1`, {
        headers: { 'Authorization': `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` },
      }),
    ])
    const [activeData, trialData] = await Promise.all([activeRes.json(), trialRes.json()])
    const listData = { data: [...(activeData.data || []), ...(trialData.data || [])] }

    if (!listData.data?.length) {
      return new Response(JSON.stringify({ error: 'No active subscription found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const subId = listData.data[0].id

    // Cancel at period end (not immediately)
    const cancelRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'cancel_at_period_end=true',
    })
    const cancelData = await cancelRes.json()

    if (!cancelRes.ok) {
      return new Response(JSON.stringify({ error: cancelData.error?.message || 'Failed to cancel' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Save cancel_at to profile so dashboard can show "access until" date
    if (cancelData.cancel_at) {
      await sb.from('profiles')
        .update({ plan_expires_at: new Date(cancelData.cancel_at * 1000).toISOString() })
        .eq('id', user.id)
    }

    const accessUntil = cancelData.cancel_at
      ? new Date(cancelData.cancel_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'end of period'
    await tg(
      `😢 <b>Cancellation requested</b>\n` +
      `User: ${profile?.notification_email || user.email}\n` +
      `Plan: ${(profile?.plan || 'unknown').toUpperCase()}\n` +
      `Access until: ${accessUntil}`
    )

    return new Response(JSON.stringify({ success: true, cancel_at: cancelData.cancel_at }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
