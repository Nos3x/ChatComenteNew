// netlify/functions/comments.js
const { createClient } = require('@supabase/supabase-js')

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers }

  const supabase = sb()

  try {
    // GET ?post_id=xxx
    if (event.httpMethod === 'GET') {
      const { post_id } = event.queryStringParameters || {}
      if (!post_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'post_id obrigatório' }) }

      const { data: comments, error } = await supabase
        .from('comments')
        .select('id, author_name, user_code, content, created_at, visitor_id')
        .eq('post_id', post_id)
        .order('created_at', { ascending: true })

      if (error) throw error

      return { statusCode: 200, headers, body: JSON.stringify({ comments: comments || [] }) }
    }

    // POST — cria comentário
    if (event.httpMethod === 'POST') {
      const { post_id, author_name, content, user_code, visitor_id } = JSON.parse(event.body || '{}')

      if (!post_id || !author_name?.trim() || !content?.trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'post_id, author_name e content obrigatórios' }) }
      }

      const { data: comment, error } = await supabase
        .from('comments')
        .insert({
          post_id,
          author_name: author_name.trim().slice(0, 50),
          content: content.trim().slice(0, 500),
          user_code: user_code || null,
          visitor_id: visitor_id || null,
        })
        .select()
        .single()

      if (error) throw error

      return { statusCode: 201, headers, body: JSON.stringify({ comment }) }
    }

    // DELETE — apaga comentário (só o criador)
    if (event.httpMethod === 'DELETE') {
      const { comment_id, visitor_id } = JSON.parse(event.body || '{}')

      if (!comment_id || !visitor_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'comment_id e visitor_id obrigatórios' }) }
      }

      const { data: comment } = await supabase
        .from('comments')
        .select('visitor_id')
        .eq('id', comment_id)
        .single()

      if (!comment) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Comentário não encontrado' }) }
      if (comment.visitor_id !== visitor_id) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Você só pode apagar seus próprios comentários' }) }
      }

      const { error } = await supabase.from('comments').delete().eq('id', comment_id)
      if (error) throw error

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) }

  } catch (err) {
    console.error('comments error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro interno' }) }
  }
}
