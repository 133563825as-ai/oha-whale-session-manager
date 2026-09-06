import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArchiveStore } from '../src/archive-store.js'

const archivedId = '11111111-1111-4111-8111-111111111111'
const liveId = '22222222-2222-4222-8222-222222222222'
const otherId = '33333333-3333-4333-8333-333333333333'
const numericId = '44444444-4444-4444-8444-444444444444'

async function fixture (options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'archive-store-'))
  const sessionsRoot = join(root, 'sessions')
  const trashRoot = join(root, 'trash')
  const source = join(sessionsRoot, 'archived')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'session.jsonl.zstd'), 'artifact')
  await writeFile(join(source, 'metadata.json'), 'keep me')
  const headers = [
    { id: archivedId, version: 0, createdAt: 1000, cwd: '/work/demo' },
    { id: otherId, version: 0, createdAt: 2000, cwd: '/gone' },
    { id: liveId, version: 0, createdAt: 3000, cwd: '/live' },
    { id: numericId, version: 0, createdAt: 3000000000000, cwd: '/numeric' },
  ]
  const sessionPersistence = {
    list: async () => headers,
    locate: (meta) => {
      if (meta.id === otherId && options.locateFailure) throw new Error('locate failed')
      return { path: join(sessionsRoot, meta.id === archivedId ? 'archived/session.jsonl.zstd' : `${meta.id}/session.jsonl.zstd`) }
    },
    inspect: async (id) => {
      if (id === otherId && options.inspectFailure) throw new Error('inspect failed')
      return {
        meta: { version: 0, id, createdAt: 1000, cwd: '/work' },
        events: [
          { type: 'user/message', seq: 1, time: 1000, data: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'old user' }], source: { kind: 'user' } } },
          { type: 'assistant/message', seq: 2, time: 2000, data: { turn: 1, step: 1, message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'old assistant' }], source: { kind: 'model', provider: 'x', model: 'y' } } } },
          { type: 'user/message', seq: 3, time: 3000, data: { id: 'm3', role: 'user', content: [{ type: 'text', text: 'new user ' .repeat(100) }], source: { kind: 'user' } } },
          { type: 'assistant/message', seq: 4, time: 4000, data: { turn: 2, step: 1, message: { id: 'm4', role: 'assistant', content: [{ type: 'text', text: 'new assistant' }], source: { kind: 'model', provider: 'x', model: 'y' } } } },
        ],
      }
    },
  }
  const workspaceRegistry = { archivedSessionIds: new Set([archivedId, otherId, numericId]) }
  const sessions = { list: async () => [{ id: liveId, header: { id: liveId } }] }
  const store = createArchiveStore({ sessionPersistence, workspaceRegistry, sessions, sessionsRoot, trashRoot, now: () => 30, ...options })
  return { root, source, sessionsRoot, trashRoot, store, sessionPersistence, headers }
}

async function has (path) {
  try { await access(path); return true } catch { return false }
}

test('lists archived sessions with numeric and date updatedAt ordering', async () => {
  const f = await fixture()
  try {
    const entries = await f.store.listArchived()
    assert.deepEqual(entries.map(({ id, missing }) => ({ id, missing })), [
      { id: numericId, missing: true },
      { id: archivedId, missing: undefined },
      { id: otherId, missing: true },
    ])
    assert.equal(entries.find((e) => e.id === archivedId).title, 'demo')
    assert.equal(entries.find((e) => e.id === numericId).title, 'numeric')
    assert.equal(entries.find((e) => e.id === otherId).title, 'gone')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('degrades locate and inspect failures to missing rows', async () => {
  const f = await fixture({ locateFailure: true, inspectFailure: true })
  try {
    const entries = await f.store.listArchived()
    assert.equal(entries.find((entry) => entry.id === otherId).missing, true)
    assert.equal(entries.find((entry) => entry.id === archivedId).lastUser.length, 280)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('previews newest DSH messages and text parts truncated to 280 code units', async () => {
  const f = await fixture()
  try {
    const preview = await f.store.previewSession(archivedId)
    assert.equal(preview.lastUser, 'new user '.repeat(100).slice(0, 280))
    assert.equal(preview.lastAssistant, 'new assistant')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('trashes with manifest, preserves every source file, and restores metadata', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(await f.store.trash([archivedId]), { moved: [archivedId] })
    const manifest = JSON.parse(await readFile(join(f.trashRoot, archivedId, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest, { version: 1, sessionId: archivedId, originalDir: f.source, title: 'demo', cwd: '/work/demo', updatedAt: 1000, deletedAt: 30 })
    assert.equal(await readFile(join(f.trashRoot, archivedId, 'metadata.json'), 'utf8'), 'keep me')
    assert.deepEqual(await f.store.restore([archivedId]), { restored: [archivedId] })
    assert.equal(await readFile(join(f.source, 'metadata.json'), 'utf8'), 'keep me')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('rolls back the source directory when publishing manifest fails', async () => {
  const f = await fixture({ writeManifest: async () => {
    throw new Error('manifest write failed')
  } })
  try {
    await assert.rejects(f.store.trash([archivedId]), /manifest write failed/)
    assert.equal(await has(f.source), true)
    assert.equal(await has(join(f.source, 'metadata.json')), true)
    assert.equal(await has(join(f.trashRoot, archivedId)), false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('rejects live sessions, invalid ids, destination collisions, and manifest path escapes', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.store.trash([liveId]), /live session/)
    await assert.rejects(f.store.trash(['bad']), /invalid session id/)
    await f.store.trash([archivedId])
    await mkdir(f.source, { recursive: true })
    await assert.rejects(f.store.restore([archivedId]), /destination collision/)
    await rm(f.source, { recursive: true, force: true })
    const manifestPath = join(f.trashRoot, archivedId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.originalDir = join(f.root, 'outside')
    await writeFile(manifestPath, JSON.stringify(manifest))
    await assert.rejects(f.store.restore([archivedId]), /outside sessions root/)
    await rm(f.sessionsRoot, { recursive: true, force: true })
    manifest.originalDir = f.sessionsRoot
    await writeFile(manifestPath, JSON.stringify(manifest))
    await assert.rejects(f.store.restore([archivedId]), /outside sessions root/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('purges only validated trash entries and is irreversible', async () => {
  const f = await fixture()
  try {
    await f.store.trash([archivedId])
    await writeFile(join(f.trashRoot, '55555555-5555-4555-8555-555555555555'), 'not a directory')
    assert.deepEqual(await f.store.purge(), { purged: [archivedId] })
    assert.equal(await has(join(f.trashRoot, archivedId)), false)
    assert.deepEqual(await f.store.listTrash(), [])
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
