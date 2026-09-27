import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createArchiveStore } from '../src/archive-store.js'

const archivedId = '11111111-1111-4111-8111-111111111111'
const liveId = '22222222-2222-4222-8222-222222222222'
const otherId = '33333333-3333-4333-8333-333333333333'
const numericId = '44444444-4444-4444-8444-444444444444'
const prefixedId = 'session-55555555-5555-4555-8555-555555555555'
const childId = '88888888-8888-4888-8888-888888888888'

async function fixture (options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'archive-store-'))
  const sessionsRoot = join(root, 'sessions')
  const trashRoot = join(root, 'trash')
  const source = join(sessionsRoot, 'archived')
  await mkdir(source, { recursive: true })
  // Deliberately the OLD generation filename: a restored v0 log that was never
  // migrated. `locate()` names session.v3.jsonl.zstd, which does not exist here.
  await writeFile(join(source, 'session.jsonl.zstd'), 'artifact')
  await writeFile(join(source, 'metadata.json'), 'keep me')
  const prefixedSource = join(sessionsRoot, prefixedId)
  await mkdir(prefixedSource, { recursive: true })
  await writeFile(join(prefixedSource, 'session.v3.jsonl.zstd'), 'prefixed artifact')
  // A subagent session: it carries parentSession and is never archived on its
  // own, so only a cascading delete keeps its log from being orphaned on disk.
  const childSource = join(sessionsRoot, childId)
  await mkdir(childSource, { recursive: true })
  await writeFile(join(childSource, 'session.v3.jsonl.zstd'), 'child artifact')
  const headers = [
    { id: archivedId, version: 0, createdAt: 1000, cwd: '/work/demo' },
    { id: otherId, version: 0, createdAt: 2000, cwd: '/gone' },
    { id: liveId, version: 0, createdAt: 3000, cwd: '/live' },
    { id: numericId, version: 0, createdAt: 3000000000000, cwd: '/numeric' },
    { id: prefixedId, version: 0, createdAt: 4000, cwd: '/prefixed' },
    { id: childId, version: 0, createdAt: 5000, cwd: '/child', parentSession: archivedId },
  ]
  const sessionPersistence = {
    // Real contract: list() resolves to { header, revision, ... } snapshots.
    list: async () => headers.map((header) => ({ header, revision: 'rev-1' })),
    // Real contract: stat() resolves whichever generation is on disk, so it finds
    // an older (unmigrated) log that `locate()` cannot name.
    stat: async (id) => {
      const header = headers.find((entry) => entry.id === id)
      if (header === undefined) return undefined
      const dir = dirname(sessionPersistence.locate(header).path)
      const generations = ['session.v3.jsonl.zstd', 'session.v2.jsonl.zstd', 'session.v1.jsonl.zstd', 'session.jsonl.zstd']
      for (const name of generations) {
        if (await has(join(dir, name))) return { header, revision: 'rev-1' }
      }
      return undefined
    },
    // Real contract: locate() names the CURRENT generation only.
    locate: (meta) => {
      if (meta.id === otherId && options.locateFailure) throw new Error('locate failed')
      const dir = meta.id === archivedId ? 'archived' : meta.id
      return { path: join(sessionsRoot, `${dir}/session.v3.jsonl.zstd`) }
    },
    // Real contract: a cold read opens a read handle; there is no `inspect`.
    open: async (id) => {
      if (id === otherId && options.readFailure) throw new Error('open failed')
      return {
        id,
        header: headers.find((header) => header.id === id),
        async read () {
          return {
            events: [
              { type: 'user/message', seq: 1, time: 1000, data: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'old user' }], source: { kind: 'user' } } },
              { type: 'assistant/message', seq: 2, time: 2000, data: { turn: 1, step: 1, message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'old assistant' }], source: { kind: 'model', provider: 'x', model: 'y' } } } },
              { type: 'user/message', seq: 3, time: 3000, data: { id: 'm3', role: 'user', content: [{ type: 'text', text: 'new user ' .repeat(100) }], source: { kind: 'user' } } },
              { type: 'assistant/message', seq: 4, time: 4000, data: { turn: 2, step: 1, message: { id: 'm4', role: 'assistant', content: [{ type: 'text', text: 'new assistant' }], source: { kind: 'model', provider: 'x', model: 'y' } } } },
            ],
          }
        },
        async close () {},
      }
    },
  }
  const workspaceState = {
    archivedSessionIds: [archivedId, otherId, numericId, prefixedId],
    initialized: true,
    workspaceIds: ['ws-1', 'ws-2'],
    pendingMutation: undefined
  }
  // Mutable records mirroring the host's WorkspaceEntity. `detachSession` is the
  // face the delete path must call, otherwise the grouping surface keeps a row
  // for a session log that no longer exists.
  const workspaceRecords = [
    {
      id: 'ws-1', title: 'demo', path: '/work/demo', sessionIds: [archivedId], updatedAt: '2026-01-01T00:00:00.000Z',
      async detachSession (sessionId) { this.sessionIds = this.sessionIds.filter((id) => id !== sessionId) }
    },
    {
      id: 'ws-2', title: 'prefixed', path: '/prefixed', sessionIds: [prefixedId], updatedAt: '2026-01-01T00:00:00.000Z',
      async detachSession (sessionId) { this.sessionIds = this.sessionIds.filter((id) => id !== sessionId) }
    }
  ]
  const workspaceRegistry = {
    get archivedSessionIds () { return workspaceState.archivedSessionIds },
    list: () => workspaceRecords,
    enqueueOperation: (operation) => operation(),
    requireState: () => workspaceState,
    setState: async (next) => { workspaceState.archivedSessionIds = next.archivedSessionIds }
  }
  const sessions = { list: async () => [{ id: liveId, header: { id: liveId } }] }
  // History lists read these checkpoints, and a checkpoint whose session log is
  // gone is what keeps a deleted session visible on the sidebar.
  const projectionCacheRoot = join(root, 'projcache')
  await mkdir(projectionCacheRoot, { recursive: true })
  const store = createArchiveStore({ sessionPersistence, workspaceRegistry, sessions, sessionsRoot, trashRoot, projectionCacheRoot, now: () => 30, ...options })
  return { root, source, sessionsRoot, trashRoot, projectionCacheRoot, store, sessionPersistence, headers, workspaceState }
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
      { id: prefixedId, missing: undefined },
      { id: otherId, missing: true },
    ])
    assert.equal(entries.find((e) => e.id === archivedId).title, 'demo')
    assert.equal(entries.find((e) => e.id === numericId).title, 'numeric')
    assert.equal(entries.find((e) => e.id === otherId).title, 'gone')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('unwraps persistence snapshots so archived sessions are never dropped', async () => {
  const f = await fixture()
  try {
    const snapshots = await f.sessionPersistence.list()
    assert.ok(snapshots.every((entry) => entry.header !== undefined), 'list() must resolve to { header, ... } snapshots')
    const entries = await f.store.listArchived()
    assert.equal(entries.length, 4)
    assert.ok(entries.some((entry) => entry.id === archivedId), 'archived session must survive the snapshot unwrap')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('degrades locate and read failures to missing rows', async () => {
  const f = await fixture({ locateFailure: true, readFailure: true })
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
    assert.equal(preview.firstUser, 'old user')
    assert.equal(preview.lastUser, 'new user '.repeat(100).slice(0, 280))
    assert.equal(preview.lastAssistant, 'new assistant')
    assert.equal(preview.cwdBase, 'demo')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('trashes with manifest, preserves every source file, and restores metadata', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(await f.store.trash([archivedId]), { moved: [archivedId, childId] })
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
    const purged = (await f.store.purge()).purged
    assert.deepEqual([...purged].sort(), [archivedId, childId].sort(), 'emptying the trash clears every entry it holds')
    assert.equal(await has(join(f.trashRoot, archivedId)), false)
    assert.deepEqual(await f.store.listTrash(), [])
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('accepts session-prefixed ids in validation, listing, and trash', async () => {
  const f = await fixture()
  try {
    const entries = await f.store.listArchived()
    const prefixed = entries.find((e) => e.id === prefixedId)
    assert.ok(prefixed, 'prefixed id should appear in archived list')
    assert.equal(prefixed.missing, undefined, 'prefixed id should not be missing')
    assert.equal(typeof prefixed.title, 'string')
    const preview = await f.store.previewSession(prefixedId)
    assert.ok(preview.lastUser || preview.lastAssistant)
    assert.deepEqual(await f.store.trash([prefixedId]), { moved: [prefixedId] })
    assert.deepEqual(await f.store.restore([prefixedId]), { restored: [prefixedId] })
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('lists workspaces with archive counts from the registry', async () => {
  const f = await fixture()
  try {
    const workspaces = await f.store.listWorkspaces()
    assert.deepEqual(workspaces.map((ws) => ({ title: ws.title, path: ws.path, sessionCount: ws.sessionCount, archivedCount: ws.archivedCount })), [
      { title: 'demo', path: '/work/demo', sessionCount: 1, archivedCount: 1 },
      { title: 'prefixed', path: '/prefixed', sessionCount: 1, archivedCount: 1 }
    ])
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('trash carries subagent descendants so no child log is orphaned', async () => {
  const f = await fixture()
  try {
    // The child is never archived on its own, so the archive-set check must not
    // apply to it — but its directory has to leave with the parent's.
    assert.deepEqual(await f.store.trash([archivedId]), { moved: [archivedId, childId] })
    assert.equal(await has(f.source), false)
    assert.equal(await has(join(f.sessionsRoot, childId)), false, 'child log must not be left behind as an orphan')
    assert.equal(await has(join(f.trashRoot, childId)), true, 'child must be recoverable from the trash')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('deleting a session drops its projection checkpoint', async () => {
  const f = await fixture()
  try {
    const checkpoint = join(f.projectionCacheRoot, `${archivedId}.json`)
    const other = join(f.projectionCacheRoot, `${otherId}.json`)
    await writeFile(checkpoint, '{"version":7}')
    await writeFile(other, '{"version":7}')
    await f.store.trash([archivedId])
    assert.equal(await has(checkpoint), false, 'trash must drop the checkpoint that keeps the deleted row alive')
    assert.equal(await has(other), true, 'an untouched session keeps its checkpoint')
    await f.store.purge([archivedId])
    assert.equal(await has(checkpoint), false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('trash and purge drop the workspace accounting row, not just the archive id', async () => {
  const f = await fixture()
  try {
    await f.store.trash([archivedId])
    const afterTrash = await f.store.listWorkspaces()
    assert.equal(afterTrash.find((ws) => ws.id === 'ws-1').sessionCount, 0, 'trash must detach the session from its workspace')
    // The workspace row is what the sidebar renders from: leaving it behind is
    // what made a deleted session reappear there.
    await f.store.purge([archivedId])
    const afterPurge = await f.store.listWorkspaces()
    assert.equal(afterPurge.find((ws) => ws.id === 'ws-1').sessionCount, 0)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('cleanup trashes orphaned subagent sessions and drops dead rows', async () => {
  const f = await fixture()
  try {
    const orphanId = '99999999-9999-4999-8999-999999999999'
    // Its ancestor no longer exists, so the parentSession chain dead-ends: the
    // session is stale even though its own log is still sitting on disk.
    f.headers.push({ id: orphanId, version: 0, createdAt: 9000, cwd: '/orphan', parentSession: '00000000-0000-4000-8000-000000000000' })
    await mkdir(join(f.sessionsRoot, orphanId), { recursive: true })
    await writeFile(join(f.sessionsRoot, orphanId, 'session.v3.jsonl.zstd'), 'orphan artifact')
    await writeFile(join(f.projectionCacheRoot, `${orphanId}.json`), '{"version":7}')

    const result = await f.store.cleanup()
    assert.deepEqual(result.moved, [orphanId])
    assert.equal(await has(join(f.sessionsRoot, orphanId)), false)
    assert.equal(await has(join(f.trashRoot, orphanId)), true, 'orphaned session must stay recoverable from the trash')
    assert.equal(await has(join(f.projectionCacheRoot, `${orphanId}.json`)), false, 'its checkpoint must go with it')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('cleanup clears archive ids whose session is gone', async () => {
  const f = await fixture()
  try {
    // An archived id with no session behind it can never resolve to a header
    // again, so no surface could ever clear it later.
    const ghostId = '10101010-1010-4010-8010-101010101010'
    f.workspaceState.archivedSessionIds = [...f.workspaceState.archivedSessionIds, ghostId]
    const result = await f.store.cleanup()
    assert.equal(result.unarchived, 1)
    assert.equal(f.workspaceState.archivedSessionIds.includes(ghostId), false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('purge accepts an explicit id list and refuses a target that is not in the trash', async () => {
  const f = await fixture()
  try {
    await f.store.trash([archivedId])
    const unknownId = '77777777-7777-4777-8777-777777777777'
    // Destroying one named session must not answer `ok` when nothing was found.
    await assert.rejects(f.store.purge([unknownId]), /invalid trash entry/)
    assert.deepEqual(await f.store.purge([archivedId]), { purged: [archivedId] })
    assert.equal(await has(join(f.trashRoot, archivedId)), false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('a batch naming a live session is refused before anything moves', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.store.trash([archivedId, liveId]), /live session/)
    // Validation runs over the whole batch before the first rename, so a refused
    // batch cannot leave half the entries trashed with a stale archive set.
    assert.equal(await has(f.source), true)
    assert.equal(await has(join(f.source, 'metadata.json')), true)
    assert.equal(await has(join(f.trashRoot, archivedId)), false)
    const entries = await f.store.listArchived()
    assert.equal(entries.some((entry) => entry.id === archivedId), true, 'unmoved entry must stay archived')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('trash clears the archive registration so a restore cannot resurrect the row', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(await f.store.trash([archivedId]), { moved: [archivedId, childId] })
    const afterTrash = await f.store.listArchived()
    assert.equal(afterTrash.some((entry) => entry.id === archivedId), false, 'trashed id must leave the archive set')
    // The registry is the only source of archive rows: a stale id here makes a
    // restored session reappear as archived instead of returning to the
    // sidebar, which reads as "the delete did nothing".
    assert.deepEqual(await f.store.restore([archivedId]), { restored: [archivedId] })
    const afterRestore = await f.store.listArchived()
    assert.equal(afterRestore.some((entry) => entry.id === archivedId), false, 'restored row must not come back as archived')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('restore leaves no trash bookkeeping inside the session directory', async () => {
  const f = await fixture()
  try {
    await f.store.trash([archivedId])
    await f.store.restore([archivedId])
    assert.equal(await has(join(f.source, 'manifest.json')), false, 'manifest.json must not move back with the directory')
    assert.equal(await readFile(join(f.source, 'metadata.json'), 'utf8'), 'keep me')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('purge removes trash directories whose manifest is missing or invalid', async () => {
  const f = await fixture()
  try {
    const orphanId = '66666666-6666-4666-8666-666666666666'
    await mkdir(join(f.trashRoot, orphanId), { recursive: true })
    await writeFile(join(f.trashRoot, orphanId, 'manifest.json'), '{"version":1,"broken":true}')
    // Such an entry is invisible to listTrash and impossible to restore, so
    // skipping it would leak a directory no surface could ever remove.
    assert.deepEqual(await f.store.purge(), { purged: [orphanId] })
    assert.equal(await has(join(f.trashRoot, orphanId)), false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('unarchive removes ids from the registry archived set', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(await f.store.unarchive([archivedId, prefixedId]), { unarchived: [archivedId, prefixedId] })
    const archived = f.store.listArchived
    const entries = await archived()
    assert.equal(entries.some((entry) => entry.id === archivedId), false)
    assert.equal(entries.some((entry) => entry.id === prefixedId), false)
    assert.equal(entries.some((entry) => entry.id === otherId), true)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
