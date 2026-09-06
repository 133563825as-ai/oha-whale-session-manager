import test from 'node:test'
import assert from 'node:assert/strict'
import { registerRoutes } from '../src/http.js'

const id = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'

function response () {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead (status, headers) {
      this.status = status
      this.headers = headers
    },
    end (body = '') {
      this.body = body
    }
  }
}

function request (method, body, url = '/session-manager/trash') {
  return {
    method,
    url,
    headers: { 'content-length': body ? String(Buffer.byteLength(body)) : '0' },
    async *[Symbol.asyncIterator] () {
      if (body) yield Buffer.from(body)
    }
  }
}

function route (store = {}) {
  const routes = new Map()
  registerRoutes({
    webServer: {
      register (route) {
        routes.set(`${route.kind}:${route.path}`, route.handler)
        return () => {}
      }
    },
    store
  })
  return routes.get('prefix:/session-manager')
}

test('rejects malformed JSON with invalid-json', async () => {
  const handler = route()
  const res = response()
  await handler(request('POST', '{'), res)
  assert.equal(res.status, 400)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'invalid-json')
})

test('rejects non-object JSON bodies', async () => {
  const handler = route()
  const res = response()
  await handler(request('POST', '"text"'), res)
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.body).error.code, 'invalid-json')
})

test('trashes ids through the store', async () => {
  const calls = []
  const handler = route({
    trash: async (ids) => {
      calls.push(ids)
      return { moved: ids }
    }
  })
  const res = response()
  await handler(request('POST', JSON.stringify({ ids: [id] })), res)
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [[id]])
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.deepEqual(body.moved, [id])
})

test('get archives and trash through the store', async () => {
  const handler = route({
    listArchived: async () => [{ id, title: 'Archived' }],
    listTrash: async () => [{ id, title: 'Trashed' }]
  })
  const archivesRes = response()
  await handler(request('GET', null, '/session-manager/archives'), archivesRes)
  assert.equal(archivesRes.status, 200)
  assert.deepEqual(JSON.parse(archivesRes.body).archives, [{ id, title: 'Archived' }])

  const trashRes = response()
  await handler(request('GET', null, '/session-manager/trash'), trashRes)
  assert.equal(trashRes.status, 200)
  assert.deepEqual(JSON.parse(trashRes.body).trash, [{ id, title: 'Trashed' }])
})

test('restores and purges ids through the store', async () => {
  const restored = []
  const purged = []
  const handler = route({
    restore: async (ids) => {
      restored.push(ids)
      return { restored: ids }
    },
    purge: async (ids) => {
      purged.push(ids)
      return { purged: ids ?? ['all'] }
    }
  })
  const restoreRes = response()
  await handler(request('POST', JSON.stringify({ ids: [otherId] }), '/session-manager/restore'), restoreRes)
  assert.equal(restoreRes.status, 200)
  assert.deepEqual(restored, [[otherId]])
  assert.deepEqual(JSON.parse(restoreRes.body).restored, [otherId])

  const purgeRes = response()
  await handler(request('POST', null, '/session-manager/purge'), purgeRes)
  assert.equal(purgeRes.status, 200)
  assert.deepEqual(purged, [undefined])
  assert.deepEqual(JSON.parse(purgeRes.body).purged, ['all'])
})

test('deduplicates ids while preserving order', async () => {
  const calls = []
  const handler = route({
    trash: async (ids) => {
      calls.push(ids)
      return { moved: ids }
    }
  })
  const res = response()
  await handler(request('POST', JSON.stringify({ ids: [id, otherId, id] })), res)
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [[id, otherId]])
})

test('rejects invalid ids and unsupported methods', async () => {
  const handler = route()
  const invalidRes = response()
  await handler(request('POST', JSON.stringify({ ids: ['..'] })), invalidRes)
  assert.equal(invalidRes.status, 400)
  assert.equal(JSON.parse(invalidRes.body).error.code, 'invalid-ids')

  const methodRes = response()
  await handler(request('DELETE', null, '/session-manager/trash'), methodRes)
  assert.equal(methodRes.status, 405)
  assert.match(methodRes.headers.Allow, /GET, POST/)
})

test('accepts session-prefixed ids in trash operations', async () => {
  const prefixedId = 'session-66666666-6666-4666-8666-666666666666'
  const calls = []
  const handler = route({
    trash: async (ids) => {
      calls.push(ids)
      return { moved: ids }
    }
  })
  const res = response()
  await handler(request('POST', JSON.stringify({ ids: [prefixedId] })), res)
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [[prefixedId]])
})

test('returns 404 for unknown paths and hides internal errors', async () => {
  const handler = route()
  const notFoundRes = response()
  await handler(request('GET', null, '/session-manager/unknown'), notFoundRes)
  assert.equal(notFoundRes.status, 404)
  assert.equal(JSON.parse(notFoundRes.body).error.code, 'not-found')

  const errorRes = response()
  const errorHandler = route({
    listArchived: async () => {
      throw new Error('/private/path leaked')
    }
  })
  await errorHandler(request('GET', null, '/session-manager/archives'), errorRes)
  assert.equal(errorRes.status, 500)
  const body = JSON.parse(errorRes.body)
  assert.equal(body.error.code, 'internal-error')
  assert.equal(body.error.message, '操作失败')
  assert.doesNotMatch(errorRes.body, /private|path/)
})
