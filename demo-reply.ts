// FeelReply — Public Demo Edge Function (no auth required)
// Deploy: Supabase → Edge Functions → New Function → name "demo-reply" → paste → Deploy
//
// Secrets needed:
//   OPENAI_API_KEY = sk-...

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { reviewerName, rating, reviewText, businessName, tone = 'professional' } = await req.json()

    const toneGuide: Record<string, string> = {
      professional: 'professional and polished, business-appropriate',
      friendly:     'warm and personable, like a trusted local business owner',
      formal:       'formal and respectful, suitable for a premium establishment',
      casual:       'casual and relaxed, but still professional',
      empathetic:   'empathetic and understanding — especially warm on negative reviews',
    }
    const toneDesc  = toneGuide[tone] || toneGuide.professional
    const sentiment = rating >= 4 ? 'positive' : rating === 3 ? 'mixed/neutral' : 'negative'

    const effectiveText     = (reviewText && reviewText !== '(no written review)') ? reviewText : ''
    const hasCyrillic       = /[Ѐ-ӿ]/.test(effectiveText)
    const hasUkrainianChars = /[іїєґІЇЄҐ]/.test(effectiveText)
    const hasRussianChars   = /[ыэъёЫЭЪЁ]/.test(effectiveText)

    const reviewLang = !effectiveText
      ? `Reply in English.`
      : hasRussianChars && !hasUkrainianChars
        ? `IMPORTANT: The review is in Russian. You MUST reply in English.`
        : hasUkrainianChars && !hasRussianChars
          ? `IMPORTANT: The review is in Ukrainian. You MUST reply in Ukrainian.`
          : hasCyrillic
            ? `IMPORTANT: The review is in Ukrainian. You MUST reply in Ukrainian.`
            : `IMPORTANT: Detect the language of the review and reply in that exact same language.`

    const systemPrompt = `You are a local business owner writing authentic Google Maps review replies.

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
        temperature: 0.85,
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error?.message || `OpenAI error ${res.status}`)
    }

    const data  = await res.json()
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
