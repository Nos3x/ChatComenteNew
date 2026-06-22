// netlify/functions/reactions.js
const { createClient } = require('@supabase/supabase-js')

const VALID_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍']

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) }
  }

  try {
    const { post_id, visitor_id, emoji } = JSON.parse(event.body || '{}')

    if (!post_id || !visitor_id || !emoji) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'post_id, visitor_id e emoji obrigatórios' }) }
    }

    if (!VALID_EMOJIS.includes(emoji)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Emoji inválido' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

    const { data: existing } = await supabase
      .from('reactions')
      .select('id, emoji')
      .eq('post_id', post_id)
      .eq('visitor_id', visitor_id)
      .maybeSingle()

    if (existing) {
      if (existing.emoji === emoji) {
        await supabase.from('reactions').delete().eq('id', existing.id)
      } else {
        await supabase.from('reactions').update({ emoji }).eq('id', existing.id)
      }
    } else {
      await supabase.from('reactions').insert({ post_id, visitor_id, emoji })
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }

  } catch (err) {
    console.error('reactions error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro interno' }) }
  }
}
