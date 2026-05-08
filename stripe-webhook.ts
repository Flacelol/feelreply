// FeelReply — Stripe Webhook Handler
// Deploy: Supabase → Edge Functions → New Function → name "stripe-webhook" → paste → Deploy
//
// Secrets needed:
//   STRIPE_SECRET_KEY      = sk_test_...
//   STRIPE_WEBHOOK_SECRET  = whsec_...  (from Stripe Dashboard → Webhooks → Signing secret)
//   SUPABASE_URL           = auto-provided by Supabase
//   SUPABASE_SERVICE_ROLE_KEY = auto-provided by Supabase
//
// Stripe events to enable on the webhook endpoint:
//   checkout.session.completed
//   invoice.payment_succeeded
//   invoice.payment_failed
//   customer.subscription.deleted

import Stripe from 'npm:stripe@14'
import { createClient } from 'npm:@supabase/supabase-js@2'

const PLAN_IDS: Record<string, string> = {
  'FeelReply Lite': 'lite',
  'FeelReply Pro':  'pro',
  'FeelReply Max':  'max',
}

function addDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString()
}

Deno.serve(async (req) => {
  // Stripe sends POST only; no CORS needed for webhooks
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log('Stripe event:', event.type)

  try {
    if (event.type === 'checkout.session.completed') {
      // Initial purchase — set plan + expiry + store customer ID
      const session = event.data.object as Stripe.Checkout.Session
      const userId     = session.metadata?.user_id
      const plan       = session.metadata?.plan
      const customerId = session.customer as string

      if (userId && plan) {
        const { error } = await supabase.from('profiles').update({
          plan,
          plan_expires_at:    addDays(35),
          stripe_customer_id: customerId,
          updated_at:         new Date().toISOString(),
        }).eq('id', userId)
        if (error) console.error('checkout.session.completed update error:', error)
      }
    }

    else if (event.type === 'invoice.payment_succeeded') {
      // Recurring monthly payment — extend expiry by 35 days from now
      const invoice    = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      if (customerId) {
        const { error } = await supabase.from('profiles').update({
          plan_expires_at: addDays(35),
          updated_at:      new Date().toISOString(),
        }).eq('stripe_customer_id', customerId)
        if (error) console.error('invoice.payment_succeeded update error:', error)
      }
    }

    else if (
      event.type === 'invoice.payment_failed' ||
      event.type === 'customer.subscription.deleted'
    ) {
      // Payment failed or subscription cancelled — revoke access
      const obj        = event.data.object as Stripe.Invoice | Stripe.Subscription
      const customerId = (obj as any).customer as string

      if (customerId) {
        const { error } = await supabase.from('profiles').update({
          plan:            'free',
          plan_expires_at: null,
          updated_at:      new Date().toISOString(),
        }).eq('stripe_customer_id', customerId)
        if (error) console.error('payment_failed/subscription_deleted update error:', error)
      }
    }

  } catch (err) {
    console.error('Handler error:', err)
    return new Response('Internal error', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
