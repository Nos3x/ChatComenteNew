// netlify/functions/upload-audio.js
const { createClient } = require('@supabase/supabase-js')

const BUCKET = 'chat-audios'
const MAX_BYTES = 3 * 1024 * 1024 // ~3MB cobre 15s de áudio comprimido

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
    const { file, type } = JSON.parse(event.body || '{}')

    if (!file || !type) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'file e type são obrigatórios' }) }
    }

    if (!type.startsWith('audio/')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Apenas áudios são aceitos' }) }
    }

    const fileBuffer = Buffer.from(file, 'base64')

    if (fileBuffer.length > MAX_BYTES) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Áudio muito grande. Máximo 15 segundos.' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

    const ext = type.includes('webm') ? 'webm' : type.includes('mp4') ? 'm4a' : 'ogg'
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uniqueName, fileBuffer, { contentType: type, upsert: false })

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(uniqueName)

    return { statusCode: 200, headers, body: JSON.stringify({ url: publicUrl }) }

  } catch (err) {
    console.error('upload-audio error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro no upload do áudio' }) }
  }
}
