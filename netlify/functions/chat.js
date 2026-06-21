// netlify/functions/chat.js
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
  const qs = event.queryStringParameters || {}

  try {
    if (event.httpMethod === 'GET') {
      const { action, my_code, peer_code } = qs

      // GET ?action=conversations&my_code=1234
      if (action === 'conversations') {
        if (!my_code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'my_code obrigatório' }) }

        const { data: sent } = await supabase
          .from('chat_messages')
          .select('sender_code, receiver_code, sender_name, content, created_at, read')
          .eq('sender_code', my_code)
          .order('created_at', { ascending: false })
          .limit(100)

        const { data: received } = await supabase
          .from('chat_messages')
          .select('sender_code, receiver_code, sender_name, content, created_at, read')
          .eq('receiver_code', my_code)
          .order('created_at', { ascending: false })
          .limit(100)

        const all = [...(sent || []), ...(received || [])]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        // Agrupa por peer
        const peersMap = {}
        for (const m of all) {
          const peerCode = m.sender_code === my_code ? m.receiver_code : m.sender_code
          const peerName = m.sender_code === my_code ? null : m.sender_name
          if (!peersMap[peerCode]) {
            peersMap[peerCode] = { peer_code: peerCode, peer_name: peerName, last_message: m.content, unread: 0 }
          }
          if (!peersMap[peerCode].peer_name && peerName) peersMap[peerCode].peer_name = peerName
          if (m.receiver_code === my_code && !m.read) peersMap[peerCode].unread++
        }

        // Busca nomes dos peers na tabela users
        const codes = Object.keys(peersMap)
        if (codes.length) {
          const { data: users } = await supabase
            .from('users')
            .select('user_code, author_name, display_name')
            .in('user_code', codes)

          for (const u of users || []) {
            if (peersMap[u.user_code]) {
              peersMap[u.user_code].peer_name = u.author_name
              peersMap[u.user_code].display_name = u.display_name
            }
          }
        }

        return { statusCode: 200, headers, body: JSON.stringify({ conversations: Object.values(peersMap) }) }
      }

      // GET ?action=unread&my_code=1234
      if (action === 'unread') {
        if (!my_code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'my_code obrigatório' }) }

        const { count } = await supabase
          .from('chat_messages')
          .select('*', { count: 'exact', head: true })
          .eq('receiver_code', my_code)
          .eq('read', false)

        return { statusCode: 200, headers, body: JSON.stringify({ count: count || 0 }) }
      }

      // GET ?my_code=1234&peer_code=5678 — conversa entre dois
      if (my_code && peer_code) {
        const { data: sent } = await supabase
          .from('chat_messages')
          .select('id, sender_code, sender_name, receiver_code, content, created_at, read')
          .eq('sender_code', my_code)
          .eq('receiver_code', peer_code)

        const { data: received } = await supabase
          .from('chat_messages')
          .select('id, sender_code, sender_name, receiver_code, content, created_at, read')
          .eq('sender_code', peer_code)
          .eq('receiver_code', my_code)

        const messages = [...(sent || []), ...(received || [])]
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

        // Marca como lidas
        const unreadIds = messages.filter(m => m.receiver_code === my_code && !m.read).map(m => m.id)
        if (unreadIds.length) {
          await supabase.from('chat_messages').update({ read: true }).in('id', unreadIds)
        }

        return { statusCode: 200, headers, body: JSON.stringify({ messages }) }
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Parâmetros inválidos' }) }
    }

    // POST — envia mensagem (texto e/ou áudio)
    if (event.httpMethod === 'POST') {
      const { sender_code, sender_name, receiver_code, content } = JSON.parse(event.body || '{}')

      if (!sender_code || !sender_name || !receiver_code || !content?.trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campos obrigatórios faltando' }) }
      }

      if (sender_code === receiver_code) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Não é possível enviar mensagem para si mesmo' }) }
      }

      const { data: message, error } = await supabase
        .from('chat_messages')
        .insert({
          sender_code: String(sender_code),
          sender_name: sender_name.trim().slice(0, 50),
          receiver_code: String(receiver_code),
          content: content.trim().slice(0, 500),
          read: false,
        })
        .select()
        .single()

      if (error) throw error

      return { statusCode: 201, headers, body: JSON.stringify({ message }) }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) }

  } catch (err) {
    console.error('chat error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Erro interno' }) }
  }
}
