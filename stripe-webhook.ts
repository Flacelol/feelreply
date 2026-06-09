// FeelReply — Stripe Webhook Handler
// Deploy: Supabase → Edge Functions → New Function → name "stripe-webhook" → paste → Deploy
//
// Secrets needed:
//   STRIPE_SECRET_KEY         = sk_test_...
//   STRIPE_WEBHOOK_SECRET     = whsec_...  (from Stripe Dashboard → Webhooks → Signing secret)
//   SUPABASE_URL              = auto-provided by Supabase
//   SUPABASE_SERVICE_ROLE_KEY = auto-provided by Supabase
//   TELEGRAM_BOT_TOKEN        = 123456:ABC-...  (from @BotFather)
//   TELEGRAM_CHAT_ID          = your personal chat ID (get it from @userinfobot)
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

const PLAN_RANK: Record<string, number> = { free: 0, lite: 1, pro: 2, max: 3 }

const PLAN_LABELS: Record<string, string> = {
  lite: 'Lite  €19/mo',
  pro:  'Pro  €49/mo',
  max:  'Max  €99/mo',
}

function addDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString()
}

function fmt(amountCents: number, currency: string): string {
  return (amountCents / 100).toLocaleString('de-DE', {
    style: 'currency', currency: currency.toUpperCase(),
  })
}

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
    event = await stripe.webhooks.constructEventAsync(
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
      // New purchase or upgrade — set plan + expiry + store customer ID
      const session = event.data.object as Stripe.Checkout.Session
      const userId        = session.metadata?.user_id
      const plan          = session.metadata?.plan
      const billing       = session.metadata?.billing
      const customerId    = session.customer as string
      const newSubId      = session.subscription as string

      if (userId && plan) {
        const { error } = await supabase.from('profiles').update({
          plan,
          stripe_customer_id: customerId,
          plan_expires_at:    billing === 'yearly' ? addDays(365) : addDays(30),
          updated_at:         new Date().toISOString(),
        }).eq('id', userId)
        if (error) console.error('checkout.session.completed update error:', error)
      }

      // Cancel any old subscriptions so user isn't double-charged on upgrade
      if (customerId && newSubId) {
        const [activeSubs, trialingSubs] = await Promise.all([
          stripe.subscriptions.list({ customer: customerId, status: 'active' }),
          stripe.subscriptions.list({ customer: customerId, status: 'trialing' }),
        ])
        for (const sub of [...activeSubs.data, ...trialingSubs.data]) {
          if (sub.id !== newSubId) {
            await stripe.subscriptions.cancel(sub.id)
            console.log('Cancelled old subscription on upgrade:', sub.id)
          }
        }
      }

      await tg(
        `💳 <b>New subscriber!</b>\n` +
        `👤 ${session.customer_email ?? 'unknown'}\n` +
        `📦 ${PLAN_LABELS[plan ?? ''] ?? plan}\n` +
        `💰 ${fmt(session.amount_total ?? 0, session.currency ?? 'eur')}`
      )
    }

    else if (event.type === 'invoice.payment_succeeded') {
      const invoice    = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      const isYearly   = invoice.lines?.data?.[0]?.plan?.interval === 'year'

      // Derive plan from the product name on the invoice line item
      const productName = invoice.lines?.data?.[0]?.description ?? ''
      const renewedPlan = Object.entries(PLAN_IDS).find(([k]) => productName.includes(k))?.[1]

      if (customerId) {
        const updates: Record<string, string> = {
          plan_expires_at: isYearly ? addDays(365) : addDays(30),
          updated_at:      new Date().toISOString(),
        }
        // Only update plan on renewal, and only if it's the same or higher tier than current
        if (renewedPlan && invoice.billing_reason === 'subscription_cycle') {
          const { data: currentProf } = await supabase.from('profiles').select('plan').eq('stripe_customer_id', customerId).single()
          const currentRank = PLAN_RANK[currentProf?.plan ?? 'free'] ?? 0
          const renewedRank = PLAN_RANK[renewedPlan] ?? 0
          if (renewedRank >= currentRank) {
            updates.plan = renewedPlan
          } else {
            console.log(`Skipping plan downgrade: current=${currentProf?.plan}, renewed=${renewedPlan}`)
          }
        }
        const { error } = await supabase.from('profiles').update(updates).eq('stripe_customer_id', customerId)
        if (error) console.error('invoice.payment_succeeded update error:', error)
      }

      // Skip the first invoice (covered by checkout.session.completed)
      if (invoice.billing_reason !== 'subscription_create') {
        await tg(
          `🔄 <b>Renewal payment</b>\n` +
          `👤 ${invoice.customer_email ?? customerId}\n` +
          `💰 ${fmt(invoice.amount_paid, invoice.currency)}`
        )
      }
    }

    else if (event.type === 'invoice.payment_failed') {
      const invoice    = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      if (customerId) {
        const { error } = await supabase.from('profiles').update({
          plan:            'free',
          plan_expires_at: null,
          updated_at:      new Date().toISOString(),
        }).eq('stripe_customer_id', customerId)
        if (error) console.error('invoice.payment_failed update error:', error)
      }

      await tg(
        `⚠️ <b>Payment FAILED</b>\n` +
        `👤 ${invoice.customer_email ?? customerId}\n` +
        `💰 ${fmt(invoice.amount_due, invoice.currency)}`
      )
    }

    else if (event.type === 'customer.subscription.deleted') {
      const sub        = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string

      if (customerId) {
        // Only downgrade to free if no other active subscriptions remain.
        // This prevents old-sub cancellations (during upgrade) from wiping the new plan.
        const remaining = await stripe.subscriptions.list({ customer: customerId, status: 'active' })
        if (remaining.data.length === 0) {
          const { error } = await supabase.from('profiles').update({
            plan:            'free',
            plan_expires_at: null,
            updated_at:      new Date().toISOString(),
          }).eq('stripe_customer_id', customerId)
          if (error) console.error('subscription_deleted update error:', error)

          await tg(
            `❌ <b>Subscription cancelled</b>\n` +
            `👤 Customer: <code>${customerId}</code>`
          )
        } else {
          console.log(`Subscription deleted but customer still has ${remaining.data.length} active sub(s), skipping downgrade`)
        }
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
