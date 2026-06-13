// FeelReply — Stripe Checkout Edge Function
// Deploy: Supabase → Edge Functions → New Function → name "create-checkout-session" → paste → Deploy
// Secrets to add: STRIPE_SECRET_KEY = sk_test_51TPMxhFT3x12aTgMcb7LTVV4r82NQ28zQhzrwLWeMwl2Neq8EMetYZ8wMDdp5cYkWLEZTwHIPVjRAY6rrZa0Tj6o002zMiKJb4

import Stripe from 'npm:stripe@14'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PLANS: Record<string, { name: string; monthly: number; yearly: number }> = {
  lite: { name: 'FeelReply Lite', monthly: 1900, yearly: 18000 },
  pro:  { name: 'FeelReply Pro',  monthly: 4900, yearly: 46800 },
  max:  { name: 'FeelReply Max',  monthly: 9900, yearly: 94800 },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
    const { plan, billing, email, userId, stripeCustomerId, origin } = await req.json()

    const planInfo = PLANS[plan]
    if (!planInfo) throw new Error(`Invalid plan: ${plan}`)

    const isYearly = billing === 'yearly'
    const amount = isYearly ? planInfo.yearly : planInfo.monthly
    const interval = isYearly ? 'year' : 'month'
    const description = isYearly ? 'Annual subscription · cancel anytime' : 'Monthly subscription · cancel anytime'

    // Reuse existing Stripe customer to prevent duplicate customers on upgrade
    const customerParam = stripeCustomerId
      ? { customer: stripeCustomerId }
      : { customer_email: email }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: planInfo.name, description },
          unit_amount: amount,
          recurring: { interval },
        },
        quantity: 1,
      }],
      ...customerParam,
      success_url: `${origin}/dashboard.html?payment=success&plan=${plan}`,
      cancel_url: `${origin}/index.html#pricing`,
      metadata: { user_id: userId, plan, billing: billing || 'monthly' },
      automatic_tax: { enabled: true },
      allow_promotion_codes: true,
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
