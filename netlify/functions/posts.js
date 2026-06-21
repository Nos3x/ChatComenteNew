// netlify/functions/posts.js
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
    // GET /posts/:id — post único
    if (event.httpMethod === 'GET' && event.path.match(/\/posts\/[^/]+$/)) {
      const postId = event.path.split('/').pop()
      const visitor = event.queryStringParameters?.visitor || ''

      const { data: post, error } = await supabase
        .from('posts')
        .select('*')
        .eq('id', postId)
        .single()

      if (error || !post) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }

      const [reactions, userReaction, { count: comment_count }] = await Promise.all([
        getReactions(supabase, postId),
        getUserReaction(supabase, postId, visitor),
        supabase.from('comments').select('*', { count: 'exact', head: true }).eq('post_id', postId),
      ])

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ post: { ...post, reactions, user_reaction: userReaction, comment_count: comment_count || 0 } }),
      }
    }

    // GET /posts — feed completo
    if (event.httpMethod === 'GET') {
      const visitor = event.queryStringParameters?.visitor || ''

      const { data: posts, error } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      if (!posts?.length) return { statusCode: 200, headers, body: JSON.stringify({ posts: [] }) }

      const enriched = await Promise.all(posts.map(async (post) => {
        const [reactions, userReaction, { count: comment_count }] = await Promise.all([
          getReactions(supabase, post.id),
          getUserReaction(supabase, post.id, visitor),
          supabase.from('comments').select('*', { count: 'exact', head: true }).eq('post_id', post.id),
        ])
        return { ...post, reactions, user_reaction: userReaction, comment_count: comment_count || 0 }
      }))

      return { statusCode: 200, headers, body: JSON.stringify({ posts: enriched }) }
    }

    // POST — cria post
    if (event.httpMethod === 'POST') {
      const { caption, image_url, visitor_id, author_name, user_code } = JSON.parse(event.body || '{}')

      if (!caption?.trim() && !image_url) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'caption ou image_url obrigatório' }) }
      }

      const { data: post, error } = await supabase
        .from('posts')
        .insert({
          caption: caption?.trim().slice(0, 1000) || null,
          image_url: image_url || null,
          visitor_id,
          author_name: author_name?.trim().slice(0, 50) || 'Anônimo',
          user_code: user_code || null,
        })
        .select()
        .single()

      if (error) throw error

      return { statusCode: 201, headers, body: JSON.stringify({ post }) }
    }

    // DELETE /posts — apaga post (só o criador)
    if (event.httpMethod === 'DELETE') {
      const { post_id, visitor_id } = JSON.parse(event.body || '{}')

      if (!post_id || !visitor_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'post_id e visitor_id obrigatórios' }) }
      }

      // Verifica se o post pertence a esse visitor_id
      const { data: post } = await supabase
        .from('posts')
        .select('visitor_id')
        .eq('id', post_id)
        .single()

      if (!post) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Post não encontrado' }) }
      if (post.visitor_id !== visitor_id) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Você só pode apagar seus próprios posts' }) }
      }

      const { error } = await supabase.from('posts').delete().eq('id', post_id)
      if (error) throw error

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) }

  } catch (err) {
    console.error('posts error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro interno' }) }
  }
}

async function getReactions(supabase, postId) {
  const { data } = await supabase.from('reactions').select('emoji').eq('post_id', postId)
  const counts = {}
  for (const r of data || []) counts[r.emoji] = (counts[r.emoji] || 0) + 1
  return counts
}

async function getUserReaction(supabase, postId, visitorId) {
  if (!visitorId) return null
  const { data } = await supabase
    .from('reactions')
    .select('emoji')
    .eq('post_id', postId)
    .eq('visitor_id', visitorId)
    .maybeSingle()
  return data?.emoji || null
}
