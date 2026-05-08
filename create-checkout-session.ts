// FeelReply — Stripe Checkout Edge Function
// Deploy: Supabase → Edge Functions → New Function → name "create-checkout-session" → paste → Deploy
// Secrets to add: STRIPE_SECRET_KEY = sk_test_51TPMxhFT3x12aTgMcb7LTVV4r82NQ28zQhzrwLWeMwl2Neq8EMetYZ8wMDdp5cYkWLEZTwHIPVjRAY6rrZa0Tj6o002zMiKJb4

import Stripe from 'npm:stripe@14'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PLANS: Record<string, { name: string; amount: number }> = {
  lite: { name: 'FeelReply Lite', amount: 1900 },
  pro:  { name: 'FeelReply Pro',  amount: 4900 },
  max:  { name: 'FeelReply Max',  amount: 9900 },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
    const { plan, email, userId, origin } = await req.json()

    const planInfo = PLANS[plan]
    if (!planInfo) throw new Error(`Invalid plan: ${plan}`)

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: planInfo.name, description: 'Monthly subscription · cancel anytime' },
          unit_amount: planInfo.amount,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      customer_email: email,
      success_url: `${origin}/dashboard.html?payment=success&plan=${plan}`,
      cancel_url: `${origin}/index.html#pricing`,
      metadata: { user_id: userId, plan },
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
