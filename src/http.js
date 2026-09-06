const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_IDS = 100

class HttpError extends Error {
  constructor (status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function headerFor (res, headers = {}) {
  return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
}

export function sendJson (res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data)
  res.writeHead(status, headerFor(res, { ...extraHeaders, 'Content-Length': Buffer.byteLength(body) }))
  res.end(body)
}

export async function parseJsonBody (req, maxBytes = 256 * 1024, { allowEmpty = false } = {}) {
  const contentLength = req.headers?.['content-length']
  if (contentLength !== undefined) {
    const length = Number(contentLength)
    if (!Number.isSafeInteger(length) || length < 0) throw new HttpError(400, 'invalid-content-length', '请求体长度无效')
    if (length > maxBytes) throw new HttpError(413, 'body-too-large', '请求体过大')
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw new HttpError(413, 'body-too-large', '请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '' && allowEmpty) return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid-json', '请求不是有效 JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid-json', '请求体必须是 JSON 对象')
  }
  return parsed
}

function validateIds (value, { allowOmit = false } = {}) {
  if (value === undefined && allowOmit) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'invalid-ids', 'ids 必须是非空数组')
  }
  const seen = new Set()
  const ids = []
  for (const id of value) {
    if (typeof id !== 'string' || !SESSION_ID.test(id)) {
      throw new HttpError(400, 'invalid-ids', 'ids 包含无效会话 ID')
    }
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  if (ids.length > MAX_IDS) {
    throw new HttpError(400, 'too-many-ids', `一次最多操作 ${MAX_IDS} 个会话`)
  }
  return ids
}

function methodNotAllowed (res, allow) {
  sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'HTTP 方法不允许' } }, { Allow: allow })
}

function notFound (res) {
  sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '接口不存在' } })
}

async function dispatch (req, res, store) {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  const method = (req.method ?? 'GET').toUpperCase()

  if (pathname === '/session-manager/archives') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET')
    const archives = await store.listArchived()
    return sendJson(res, 200, { ok: true, archives })
  }

  if (pathname === '/session-manager/trash') {
    if (method === 'GET') {
      const trash = await store.listTrash()
      return sendJson(res, 200, { ok: true, trash })
    }
    if (method === 'POST') {
      const body = await parseJsonBody(req)
      const ids = validateIds(body.ids)
      const result = await store.trash(ids)
      return sendJson(res, 200, { ok: true, ...result })
    }
    return methodNotAllowed(res, 'GET, POST')
  }

  if (pathname === '/session-manager/restore') {
    if (method !== 'POST') return methodNotAllowed(res, 'POST')
    const body = await parseJsonBody(req)
    const ids = validateIds(body.ids)
    const result = await store.restore(ids)
    return sendJson(res, 200, { ok: true, ...result })
  }

  if (pathname === '/session-manager/purge') {
    if (method !== 'POST') return methodNotAllowed(res, 'POST')
    const body = await parseJsonBody(req, undefined, { allowEmpty: true })
    const ids = validateIds(body.ids, { allowOmit: true })
    const result = await store.purge(ids)
    return sendJson(res, 200, { ok: true, ...result })
  }

  return notFound(res)
}

export function registerRoutes ({ webServer, store, getCurrentSessionId }) {
  const disposer = webServer.register({
    kind: 'prefix',
    path: '/session-manager',
    async handler (req, res) {
      try {
        await dispatch(req, res, store)
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
          return
        }
        sendJson(res, 500, { ok: false, error: { code: 'internal-error', message: '操作失败' } })
      }
    }
  })
  return disposer
}
