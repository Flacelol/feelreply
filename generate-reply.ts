// FeelReply — AI Reply Generation Edge Function
// Deploy: Supabase → Edge Functions → New Function → name "generate-reply" → paste → Deploy
//
// Secrets needed:
//   OPENAI_API_KEY            = sk-...  (Platform → API Keys)
//   SUPABASE_URL              = auto-provided by Supabase
//   SUPABASE_SERVICE_ROLE_KEY = auto-provided by Supabase

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const jwt = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: { user } } = await sb.auth.getUser(jwt)
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { data: prof } = await sb.from('profiles').select('plan, plan_expires_at').eq('id', user.id).single()
    const active = prof?.plan && prof.plan !== 'free' && (!prof.plan_expires_at || new Date(prof.plan_expires_at) > new Date())
    if (!active) return new Response(JSON.stringify({ error: 'No active subscription' }), { status: 403, headers: corsHeaders })

    // ── Rate limit: max 50 AI replies per user per hour ───
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count: recentCount } = await sb
      .from('reply_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', hourAgo)
    if ((recentCount ?? 0) >= 50) {
      return new Response(
        JSON.stringify({ error: 'Rate limit: max 50 AI replies per hour. Try again later.' }),
        { status: 429, headers: corsHeaders }
      )
    }
    // ─────────────────────────────────────────────────────

    const { reviewerName, rating, reviewText, businessName, businessType = '', tone = 'professional', language = 'auto', customTonePrompt = '' } = await req.json()

    const toneGuide: Record<string, string> = {
      professional: 'professional and polished, business-appropriate',
      friendly:     'warm and personable, like a trusted local business owner',
      formal:       'formal and respectful, suitable for a premium establishment',
      casual:       'casual and relaxed, but still professional',
      empathetic:   'empathetic and understanding — especially warm on negative reviews',
    }
    // Max plan: custom tone overrides preset
    const toneDesc = customTonePrompt?.trim()
      ? customTonePrompt.trim()
      : toneGuide[tone] || toneGuide.professional
    const sentiment = rating >= 4 ? 'positive' : rating === 3 ? 'mixed/neutral' : 'negative'

    const langNames: Record<string, string> = {
      en: 'English', fr: 'French', es: 'Spanish', it: 'Italian',
      de: 'German',  pt: 'Portuguese', uk: 'Ukrainian',
    }

    let reviewLang: string
    if (language !== 'auto' && langNames[language]) {
      reviewLang = `IMPORTANT: You MUST reply in ${langNames[language]}, regardless of what language the review is written in.`
    } else {
      const hasCyrillic       = /[Ѐ-ӿ]/.test(reviewText || '')
      const hasUkrainianChars = /[іїєґІЇЄҐ]/.test(reviewText || '')
      const hasRussianChars   = /[ыэъёЫЭЪЁ]/.test(reviewText || '')
      reviewLang = !reviewText
        ? `Reply in English.`
        : hasRussianChars && !hasUkrainianChars
          ? `IMPORTANT: The review is in Russian. You MUST reply in English.`
          : hasUkrainianChars && !hasRussianChars
            ? `IMPORTANT: The review is in Ukrainian. You MUST reply in Ukrainian.`
            : hasCyrillic
              ? `IMPORTANT: The review is in Ukrainian. You MUST reply in Ukrainian.`
              : `IMPORTANT: Detect the language of the review and reply in that exact same language.`
    }

    const businessTypeLabels: Record<string, string> = {
      restaurant_fine:  'fine dining restaurant',
      restaurant_casual:'casual dining restaurant',
      restaurant_fast:  'fast food restaurant',
      cafe:             'café or coffee shop',
      bar:              'bar or pub',
      retail:           'retail store',
      salon:            'salon or spa',
      gym:              'gym or fitness center',
      medical:          'medical or healthcare clinic',
      automotive:       'automotive services business',
      home_services:    'home services business',
      professional:     'professional services firm',
      hotel:            'hotel or lodging',
      other:            'local business',
    }
    const btypeDesc = businessType && businessTypeLabels[businessType]
      ? `This is a ${businessTypeLabels[businessType]} — use industry-appropriate vocabulary in your reply.`
      : ''

    const systemPrompt = `You are a local business owner writing authentic Google Maps review replies.
${btypeDesc ? `\n${btypeDesc}` : ''}
${reviewLang}

Rules:
- 2–4 sentences maximum. Concise.
- Never start with "Thank you for your review", "We appreciate your feedback", or any cliché opener.
- Vary your openings. Be natural and human, not corporate.
- Use the reviewer's first name once, naturally.
- No more than one exclamation mark per reply.
- Never mention "Google" or "Google Maps" explicitly.
- For negative reviews: acknowledge the issue, apologize sincerely, invite them back or to contact you.
- For positive reviews: express genuine appreciation, highlight something specific if possible.
- Sign off with the business name on the last line.`

    const userPrompt = `Write a reply to this ${sentiment} review.

Business: ${businessName}
Reviewer: ${reviewerName}
Rating: ${rating}/5 stars
Review text: ${reviewText || '(no written review — star rating only)'}
Tone style: ${toneDesc}

Reply (plain text only, no quotes, no markdown):`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: 280,
        temperature: 0.8,
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error?.message || `OpenAI error ${res.status}`)
    }

    const data = await res.json()
    const draft = data.choices?.[0]?.message?.content?.trim()
    if (!draft) throw new Error('Empty response from OpenAI')

    return new Response(JSON.stringify({ draft }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
