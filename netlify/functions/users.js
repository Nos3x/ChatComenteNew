// netlify/functions/users.js
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcryptjs')

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

const MAX_ATTEMPTS = 5          // máximo de tentativas erradas
const WINDOW_MINUTES = 15       // dentro desse período

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

async function checkRateLimit(supabase, user_code) {
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()

  const { count } = await supabase
    .from('login_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('user_code', user_code)
    .eq('success', false)
    .gte('created_at', windowStart)

  return (count || 0) >= MAX_ATTEMPTS
}

async function logAttempt(supabase, user_code, visitor_id, success) {
  await supabase.from('login_attempts').insert({ user_code, visitor_id, success })
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers }

  const supabase = sb()

  try {
    // GET ?visitor_id=xxx OU ?user_code=xxxx
    if (event.httpMethod === 'GET') {
      const { visitor_id, user_code } = event.queryStringParameters || {}

      if (user_code) {
        const { data: user } = await supabase
          .from('users')
          .select('author_name, user_code, display_name')
          .eq('user_code', user_code)
          .maybeSingle()
        return { statusCode: 200, headers, body: JSON.stringify({ exists: !!user }) }
      }

      if (!visitor_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'visitor_id ou user_code obrigatório' }) }

      const { data: user } = await supabase
        .from('users')
        .select('author_name, user_code, display_name')
        .eq('visitor_id', visitor_id)
        .maybeSingle()

      return { statusCode: 200, headers, body: JSON.stringify({ user: user || null }) }
    }

    // PATCH — reentrada: exige código + PIN corretos, com rate limiting
    if (event.httpMethod === 'PATCH') {
      const { user_code, pin, visitor_id } = JSON.parse(event.body || '{}')

      if (!user_code || !pin || !visitor_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_code, pin e visitor_id obrigatórios' }) }
      }

      // Verifica rate limit antes de qualquer coisa
      const blocked = await checkRateLimit(supabase, user_code)
      if (blocked) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: `Muitas tentativas. Aguarde ${WINDOW_MINUTES} minutos e tente novamente.` }) }
      }

      const { data: user } = await supabase
        .from('users')
        .select('author_name, user_code, display_name, pin_hash')
        .eq('user_code', user_code)
        .maybeSingle()

      const pinMatches = user?.pin_hash ? await bcrypt.compare(pin, user.pin_hash) : false

      if (!user || !pinMatches) {
        await logAttempt(supabase, user_code, visitor_id, false)
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Código ou PIN incorretos.' }) }
      }

      await logAttempt(supabase, user_code, visitor_id, true)

      const { error } = await supabase
        .from('users')
        .update({ visitor_id })
        .eq('user_code', user_code)

      if (error) throw error

      await supabase.from('posts').update({ visitor_id }).eq('user_code', user_code)
      await supabase.from('comments').update({ visitor_id }).eq('user_code', user_code)

      return { statusCode: 200, headers, body: JSON.stringify({
        ok: true,
        user: { author_name: user.author_name, user_code: user.user_code, display_name: user.display_name }
      }) }
    }

    // POST — registra novo usuário (PIN é hasheado antes de salvar)
    if (event.httpMethod === 'POST') {
      const { visitor_id, author_name, pin } = JSON.parse(event.body || '{}')

      if (!visitor_id || !author_name?.trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'visitor_id e author_name obrigatórios' }) }
      }

      if (!pin || !/^\d{4}$/.test(pin)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'PIN deve ter exatamente 4 dígitos' }) }
      }

      const { data: existing } = await supabase
        .from('users')
        .select('author_name, user_code, display_name')
        .eq('visitor_id', visitor_id)
        .maybeSingle()

      if (existing) return { statusCode: 200, headers, body: JSON.stringify({ user: existing }) }

      const pin_hash = await bcrypt.hash(pin, 10)

      let inserted = null
      for (let i = 0; i < 10; i++) {
        const user_code = generateCode()
        const { data, error } = await supabase
          .from('users')
          .insert({
            visitor_id,
            author_name: author_name.trim().slice(0, 50),
            user_code,
            pin_hash,
          })
          .select('author_name, user_code, display_name')
          .single()

        if (!error) { inserted = data; break }
        if (!error.message?.includes('unique')) throw error
      }

      if (!inserted) throw new Error('Não foi possível gerar código único')

      return { statusCode: 201, headers, body: JSON.stringify({ user: inserted }) }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) }

  } catch (err) {
    console.error('users error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro interno' }) }
  }
}
