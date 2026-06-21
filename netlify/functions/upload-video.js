// netlify/functions/upload-video.js
const { createClient } = require('@supabase/supabase-js')

const BUCKET = 'posts-videos'
const MAX_BYTES = 12 * 1024 * 1024 // ~12MB real (cobre 15s em qualidade razoável)

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
    const { file, name, type } = JSON.parse(event.body || '{}')

    if (!file || !type) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'file e type são obrigatórios' }) }
    }

    if (!type.startsWith('video/')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Apenas vídeos são aceitos' }) }
    }

    const fileBuffer = Buffer.from(file, 'base64')

    if (fileBuffer.length > MAX_BYTES) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Vídeo muito grande. Máximo 15 segundos.' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

    const ext = (name || 'video').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uniqueName, fileBuffer, { contentType: type, upsert: false })

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(uniqueName)

    return { statusCode: 200, headers, body: JSON.stringify({ url: publicUrl }) }

  } catch (err) {
    console.error('upload-video error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro no upload do vídeo' }) }
  }
}
