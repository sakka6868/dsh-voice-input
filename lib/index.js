// dsh-voice-input — static host half (cordis plugin, ESM).
//
// Adapted from the dynamic plugin form for the STATIC plugin shape:
//   - the dynamic plugin's harness.handle('voice.proofread') RPC is replaced
//     by a webServer exact POST route (/dsh-voice-input/proofread);
//   - the proofread prompt, stream collection and degradation semantics are
//     kept identical to the dynamic form: any missing service, missing model
//     or failed call degrades to "return the raw transcript unchanged".
//
// The route is deliberately small: the Client half owns speech recognition
// (browser Web Speech API) and only asks the Host to proofread one string.
export const name = 'dsh-voice-input'

/** Hard dependency: the host HTTP carrier that owns the route table. */
export const inject = ['webServer']

const PROOFREAD_SYSTEM = [
  '你是专业中文校对助手。请对用户提供的语音转写文本进行校对：',
  '1. 修正错别字；',
  '2. 修正因读音相同或相近导致的转录偏差；',
  '3. 将繁体字统一转换为简体中文；',
  '4. 理顺标点符号与断句；',
  '5. 使表达通顺自然。',
  '要求：不改变原意、不增删实质信息、不添加解释或评论；只输出校对后的文本本身。',
].join('')

/** Collect the request body as UTF-8 text (bounded to 256 KiB). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 262144) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, data) {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

/**
 * Proofread one transcript with the session's default model.
 * Never fails the caller: on any degradation the raw text is returned.
 */
async function proofread(ctx, text) {
  if (text === '') return { ok: true, text: '', skipped: true }
  const llm = ctx.get('llm')
  if (llm === undefined) return { ok: true, text: text, skipped: true }
  const model = ctx.get('agentDefaultModel')
  let provider = ''
  let modelId = ''
  try {
    if (model !== undefined) {
      const sel = model.currentSelection()
      if (sel && typeof sel.provider === 'string') provider = sel.provider
      if (sel && typeof sel.model === 'string') modelId = sel.model
    }
  } catch (_e) { /* fall through to directory lookup */ }
  if (provider === '') {
    try {
      const ps = llm.listProviders()
      if (ps && ps.length > 0 && ps[0] && typeof ps[0].id === 'string') provider = ps[0].id
    } catch (_e) { /* noop */ }
  }
  if (provider !== '' && modelId === '') {
    try {
      const ms = await llm.listModels(provider)
      if (ms && ms.length > 0 && ms[0] && typeof ms[0].id === 'string') modelId = ms[0].id
    } catch (_e) { /* noop */ }
  }
  if (provider === '' || modelId === '') return { ok: true, text: text, skipped: true }
  try {
    const stream = llm.stream({
      provider: provider,
      model: modelId,
      system: PROOFREAD_SYSTEM,
      temperature: 0,
      maxTokens: 4000,
      messages: [{
        id: 'voice-proof-user',
        role: 'user',
        content: [{ type: 'text', text: text }],
        source: { kind: 'plugin', plugin: 'dsh-voice-input' },
      }],
    })
    let out = ''
    for await (const chunk of stream) {
      if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
      else if (chunk && chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') out = chunk.block.text
    }
    const cleaned = out.trim()
    return cleaned.length > 0 ? { ok: true, text: cleaned, skipped: false } : { ok: true, text: text, skipped: true }
  } catch (err) {
    return {
      ok: true,
      text: text,
      skipped: true,
      error: (err && err.message) ? String(err.message) : String(err),
    }
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-voice-input/proofread',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      let payload
      try {
        payload = JSON.parse(await readBody(req))
      } catch (_e) {
        sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
        return
      }
      const text = (payload && typeof payload.text === 'string') ? payload.text.trim() : ''
      const result = await proofread(ctx, text)
      sendJson(res, 200, result)
    },
  }), 'dsh-voice-input: /dsh-voice-input/proofread route')
}
