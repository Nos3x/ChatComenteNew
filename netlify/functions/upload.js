// netlify/functions/upload.js
const { createClient } = require('@supabase/supabase-js')

const BUCKET = 'posts-images'

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

    if (!type.startsWith('image/')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Apenas imagens são aceitas' }) }
    }

    const fileBuffer = Buffer.from(file, 'base64')

    if (fileBuffer.length > 5 * 1024 * 1024) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Imagem muito grande (máx 5 MB)' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

    const ext = (name || 'img').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uniqueName, fileBuffer, { contentType: type, upsert: false })

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(uniqueName)

    return { statusCode: 200, headers, body: JSON.stringify({ url: publicUrl }) }

  } catch (err) {
    console.error('upload error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro no upload' }) }
  }
}
