import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArchiveStore } from '../src/archive-store.js'

const archivedId = '11111111-1111-4111-8111-111111111111'
const liveId = '22222222-2222-4222-8222-222222222222'
const otherId = '33333333-3333-4333-8333-333333333333'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'archive-store-'))
  const sessionsRoot = join(root, 'sessions')
  const trashRoot = join(root, 'trash')
  const source = join(sessionsRoot, 'archived')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'session.jsonl.zstd'), 'artifact')
  const headers = [
    { id: archivedId, title: 'Archived', cwd: '/work', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: otherId, title: 'Missing', cwd: '/gone', updatedAt: '2026-01-03T00:00:00.000Z' },
    { id: liveId, title: 'Live', cwd: '/live', updatedAt: '2026-01-04T00:00:00.000Z' },
  ]
  const sessionPersistence = {
    list: async () => headers,
    locate: (meta) => ({ path: join(sessionsRoot, meta.id === archivedId ? 'archived/session.jsonl.zstd' : `${meta.id}/session.jsonl.zstd`) }),
    inspect: async () => [
      { type: 'assistant', subtype: 'message', content: 'old assistant' },
      { type: 'user', subtype: 'message', content: 'new user '.repeat(100) },
      { type: 'assistant', subtype: 'message', content: 'new assistant' },
    ],
  }
  const workspaceRegistry = { archivedSessionIds: new Set([archivedId, otherId]) }
  const sessions = { list: async () => [{ id: liveId }] }
  const store = createArchiveStore({ sessionPersistence, workspaceRegistry, sessions, sessionsRoot, trashRoot, now: () => '2026-02-01T00:00:00.000Z' })
  return { root, source, sessionsRoot, trashRoot, store, sessionPersistence }
}

test('lists only materialized archived sessions sorted by updatedAt descending', async () => {
  const f = await fixture()
  try {
    const entries = await f.store.listArchived()
    assert.deepEqual(entries.map(({ id, missing }) => ({ id, missing })), [
      { id: otherId, missing: true },
      { id: archivedId, missing: undefined },
    ])
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('previews newest user and assistant messages truncated to 280 code units', async () => {
  const f = await fixture()
  try {
    const preview = await f.store.previewSession(archivedId)
    assert.equal(preview.lastUser.length, 280)
    assert.equal(preview.lastAssistant, 'new assistant')
    assert.equal(preview.lastUser, 'new user '.repeat(100).slice(0, 280))
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('trashes with manifest, restores the complete source directory, and preserves metadata', async () => {
  const f = await fixture()
  try {
    const result = await f.store.trash([archivedId])
    assert.deepEqual(result, { moved: [archivedId] })
    const manifest = JSON.parse(await readFile(join(f.trashRoot, archivedId, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest, { version: 1, sessionId: archivedId, originalDir: f.source, title: 'Archived', cwd: '/work', updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: '2026-02-01T00:00:00.000Z' })
    assert.deepEqual((await f.store.listTrash()).map((x) => x.id), [archivedId])
    assert.deepEqual(await f.store.restore([archivedId]), { restored: [archivedId] })
    await access(join(f.source, 'session.jsonl.zstd'))
    assert.deepEqual((await f.store.listTrash()).map((x) => x.id), [])
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('rejects current sessions, invalid ids, and destination collisions', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.store.trash([liveId]), /live session/)
    await assert.rejects(f.store.trash(['bad']), /invalid session id/)
    await f.store.trash([archivedId])
    await mkdir(f.source, { recursive: true })
    await assert.rejects(f.store.restore([archivedId]), /destination collision/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('purges only validated trash entries and is irreversible', async () => {
  const f = await fixture()
  try {
    await f.store.trash([archivedId])
    assert.deepEqual(await f.store.purge(), { purged: [archivedId] })
    await assert.rejects(access(join(f.trashRoot, archivedId)))
    assert.deepEqual(await f.store.listTrash(), [])
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
