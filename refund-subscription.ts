// FeelReply — Refund Subscription Edge Function
// Deploy: Supabase → Edge Functions → New Function → name "refund-subscription" → paste → Deploy
//
// Secrets needed (auto-provided or already set):
//   SUPABASE_URL              = auto-provided
//   SUPABASE_SERVICE_ROLE_KEY = auto-provided
//   STRIPE_SECRET_KEY         = already set

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const REFUND_WINDOW_DAYS = 7

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const jwt = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: { user } } = await sb.auth.getUser(jwt)
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { data: prof } = await sb.from('profiles')
      .select('stripe_customer_id, plan')
      .eq('id', user.id)
      .single()

    if (!prof?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'No subscription found on this account.' }), { status: 400, headers: corsHeaders })
    }

    if (!prof.plan || prof.plan === 'free') {
      return new Response(JSON.stringify({ error: 'No active subscription to refund.' }), { status: 400, headers: corsHeaders })
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!

    // Find the most recent paid charge for this customer
    const chargesRes = await fetch(
      `https://api.stripe.com/v1/charges?customer=${prof.stripe_customer_id}&limit=5`,
      { headers: { 'Authorization': `Bearer ${stripeKey}` } }
    )
    const chargesData = await chargesRes.json()

    // Pick the most recent successful, non-refunded charge
    const charge = chargesData.data?.find((c: any) => c.paid && !c.refunded && c.status === 'succeeded')

    if (!charge) {
      return new Response(JSON.stringify({ error: 'No eligible charge found to refund.' }), { status: 400, headers: corsHeaders })
    }

    // Check 7-day refund window
    const chargeDate = new Date(charge.created * 1000)
    const daysSince  = (Date.now() - chargeDate.getTime()) / (1000 * 60 * 60 * 24)

    if (daysSince > REFUND_WINDOW_DAYS) {
      const expiredOn = new Date(chargeDate.getTime() + REFUND_WINDOW_DAYS * 86400000)
        .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      return new Response(
        JSON.stringify({ error: `Refund window expired on ${expiredOn}. Refunds are only available within 7 days of purchase.` }),
        { status: 400, headers: corsHeaders }
      )
    }

    // Issue refund via Stripe
    const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ charge: charge.id, reason: 'requested_by_customer' }).toString(),
    })
    const refundData = await refundRes.json()
    if (!refundRes.ok) throw new Error(refundData.error?.message || 'Stripe refund failed')

    // Cancel active Stripe subscription immediately
    const subsRes = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${prof.stripe_customer_id}&status=active&limit=1`,
      { headers: { 'Authorization': `Bearer ${stripeKey}` } }
    )
    const subsData = await subsRes.json()
    if (subsData.data?.length) {
      await fetch(`https://api.stripe.com/v1/subscriptions/${subsData.data[0].id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${stripeKey}` },
      })
    }

    // Downgrade to free in database
    await sb.from('profiles')
      .update({ plan: 'free', plan_expires_at: null })
      .eq('id', user.id)

    const amount   = (refundData.amount / 100).toFixed(2)
    const currency = refundData.currency.toUpperCase()

    return new Response(
      JSON.stringify({ success: true, amount, currency }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
