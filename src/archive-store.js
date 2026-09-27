import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const SESSION_ID = /^(session-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Machine-readable reasons, keyed by the fixed message prefix this store
 * raises. The HTTP layer turns a reason into an operator-facing sentence; the
 * English message stays as-is for logs and for callers that match on it.
 */
const REASONS = [
  ['live session cannot be trashed', 'live-session'],
  ['archived session not found', 'not-archived'],
  ['archived session not materialized', 'unmaterialized'],
  ['destination collision', 'collision'],
  ['invalid trash entry', 'invalid-entry'],
  ['outside sessions root', 'outside-root'],
  ['invalid session id', 'invalid-id']
]

export function reasonOf (message) {
  const hit = REASONS.find(([prefix]) => message.startsWith(prefix))
  return hit ? hit[1] : 'archive-rejected'
}

/**
 * Base class for every failure this store raises itself. Each message is a
 * fixed sentence plus a session id, so the HTTP layer may surface it verbatim.
 * A filesystem or host error is deliberately NOT one of these: its message
 * carries absolute paths and must stay hidden behind the generic 500 body.
 */
export class ArchiveError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ArchiveError'
    this.reason = reasonOf(message)
  }
}

class OutsideSessionsRootError extends ArchiveError {}

/**
 * Thrown when the target session still has an entry in the host's live store.
 * The message keeps the historical `live session cannot be trashed: <id>`
 * shape; `sessionId` lets the HTTP layer answer with a machine-readable code
 * instead of collapsing into a generic 500.
 */
export class LiveSessionError extends ArchiveError {
  constructor (id) {
    super(`live session cannot be trashed: ${id}`)
    this.name = 'LiveSessionError'
    this.sessionId = id
  }
}

function requireSessionId (id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) throw new ArchiveError(`invalid session id: ${id}`)
}

async function exists (path) {
  try { await access(path); return true } catch { return false }
}

function headerId (header) { return header.id ?? header.sessionId }

function deriveTitle (header) {
  if (header.title) return header.title
  if (header.cwd) {
    const parts = header.cwd.replace(/\/+$/, '').split('/')
    const last = parts[parts.length - 1]
    if (last && last !== '' && last !== '.') return last
  }
  return headerId(header).slice(0, 8)
}

function deriveUpdatedAt (header, events) {
  if (header.updatedAt) return header.updatedAt
  if (events && events.length > 0) {
    const last = events[events.length - 1]
    if (last?.time) return last.time
  }
  if (header.createdAt) return header.createdAt
  return 0
}

function comparableTime (value) {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Number.NEGATIVE_INFINITY
}

function textOf (value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (!value || typeof value !== 'object') return ''
  return textOf(value.text ?? value.content ?? value.parts ?? value.data)
}

function eventRole (event) {
  if (event?.type === 'user/message') return 'user'
  if (event?.type === 'assistant/message') return 'assistant'
  return event?.role ?? event?.data?.role ?? event?.message?.role ?? event?.data?.message?.role ?? (event?.type === 'user' || event?.type === 'assistant' ? event.type : undefined)
}

function isMessage (event) {
  return event?.type === 'user/message' || event?.type === 'assistant/message' ||
    event?.type === 'message' || event?.subtype === 'message' || event?.kind === 'message' ||
    event?.message?.type === 'message' || event?.data?.type === 'message'
}

function eventText (event) {
  return textOf(event?.content ?? event?.data?.content ?? event?.message?.content ?? event?.data?.message?.content)
}

function isInside (root, target) {
  const relativePath = relative(resolve(root), resolve(target))
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

export function createArchiveStore ({ sessionPersistence, workspaceRegistry, sessions, sessionsRoot, trashRoot, projectionCacheRoot, now = () => new Date().toISOString(), writeManifest = writeFile }) {
  // `sessionPersistence.list()` resolves to `{ header, revision, ... }` snapshots
  // (SessionPersistenceSnapshot), never bare headers.
  const getHeaders = async () => (await sessionPersistence.list()).map((snapshot) => snapshot.header)
  const archiveIds = () => new Set(workspaceRegistry.archivedSessionIds ?? [])

  async function headerFor (id, headers) {
    const available = headers ?? await getHeaders()
    return available.find((header) => headerId(header) === id)
  }

  function sourceDirFor (header) { return dirname(sessionPersistence.locate(header).path) }

  function validateSourceDir (sourceDir) {
    if (!isAbsolute(sourceDir) || !isInside(sessionsRoot, sourceDir)) throw new ArchiveError('source outside sessions root')
  }

  function validateOriginalDir (manifest) {
    if (!isAbsolute(manifest.originalDir) || !isInside(sessionsRoot, manifest.originalDir)) throw new OutsideSessionsRootError('outside sessions root')
  }

  function validManifest (manifest, id) {
    return manifest?.version === 1 && manifest.sessionId === id && SESSION_ID.test(manifest.sessionId) &&
      typeof manifest.originalDir === 'string' && isAbsolute(manifest.originalDir) &&
      typeof manifest.title === 'string' && typeof manifest.cwd === 'string' &&
      (typeof manifest.updatedAt === 'number' || typeof manifest.updatedAt === 'string') &&
      (typeof manifest.deletedAt === 'number' || typeof manifest.deletedAt === 'string')
  }

  async function readManifest (id, { strict = false } = {}) {
    requireSessionId(id)
    const dir = join(trashRoot, id)
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
      if (!validManifest(manifest, id)) return null
      validateOriginalDir(manifest)
      return { dir, manifest }
    } catch (error) {
      if (strict && error instanceof OutsideSessionsRootError) throw error
      return null
    }
  }

  /**
   * Read one stored session's event log. The persistence service exposes no
   * `inspect`; the supported cold read is a read handle over the log, exactly
   * as the session-query cold reader does it.
   */
  async function readStoredEvents (id) {
    const handle = await sessionPersistence.open(id, 'read')
    let read
    try {
      read = await handle.read(0)
    } catch (error) {
      await handle.close().catch(() => {})
      throw error
    }
    await handle.close().catch(() => {})
    return Array.isArray(read?.events) ? read.events : []
  }

  async function previewSession (id, headers) {
    requireSessionId(id)
    const header = await headerFor(id, headers)
    if (!header) return { missing: true }
    const events = await readStoredEvents(id)
    let firstUser
    let lastUser
    let lastAssistant
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]
      const role = eventRole(event)
      if (!isMessage(event)) continue
      if (role === 'user' && firstUser === undefined) firstUser = eventText(event).slice(0, 280)
      if (firstUser !== undefined) break
    }
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      const role = eventRole(event)
      if (!isMessage(event)) continue
      if (role === 'user' && lastUser === undefined) lastUser = eventText(event).slice(0, 280)
      if (role === 'assistant' && lastAssistant === undefined) lastAssistant = eventText(event).slice(0, 280)
      if (lastUser !== undefined && lastAssistant !== undefined) break
    }
    const cwdBase = header.cwd ? header.cwd.replace(/\/+$/, '').split('/').pop() || header.cwd : ''
    return { id, title: deriveTitle(header), cwd: header.cwd, cwdBase, updatedAt: deriveUpdatedAt(header, events), firstUser, lastUser, lastAssistant }
  }

  async function listArchived () {
    const headers = await getHeaders()
    const ids = [...archiveIds()]
    const entries = await Promise.all(ids.map(async (id) => {
      const header = await headerFor(id, headers)
      if (!header) return null
      try {
        // `locate()` names the CURRENT generation, so an unmigrated older log
        // (for example a restored v0 session) has no file there even though it
        // reads fine. `stat()` is the documented existence probe.
        if (await sessionPersistence.stat(id) === undefined) {
          return { id, title: deriveTitle(header), updatedAt: deriveUpdatedAt(header), cwd: header.cwd, missing: true }
        }
        return await previewSession(id, headers)
      } catch {
        return { id, title: deriveTitle(header), updatedAt: deriveUpdatedAt(header), cwd: header.cwd, missing: true }
      }
    }))
    return entries.filter(Boolean).sort((left, right) => comparableTime(right.updatedAt) - comparableTime(left.updatedAt))
  }

  async function listWorkspaces () {
    const headers = await getHeaders()
    const archived = archiveIds()
    return workspaceRegistry.list().map((workspace) => {
      const sessionIds = workspace.sessionIds
      return {
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
        sessionCount: sessionIds.length,
        archivedCount: sessionIds.filter((id) => archived.has(id)).length,
        updatedAt: workspace.updatedAt
      }
    })
  }

  async function listTrash () {
    let entries
    try { entries = await readdir(trashRoot, { withFileTypes: true }) } catch { return [] }
    const trash = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue
      const item = await readManifest(entry.name)
      if (!item) continue
      const { manifest } = item
      trash.push({ id: manifest.sessionId, title: manifest.title, cwd: manifest.cwd, updatedAt: manifest.updatedAt, deletedAt: manifest.deletedAt })
    }
    return trash.sort((left, right) => comparableTime(right.deletedAt) - comparableTime(left.deletedAt))
  }

  /**
   * Drop ids from the registry-global archive set in one durable write. Runs
   * through the registry mutation queue when the host exposes it so it cannot
   * interleave with a concurrent archive/unarchive. Ids that are not archived
   * are a silent no-op.
   *
   * `trash` needs this as much as `unarchive` does: once a session's directory
   * has been moved away, no header can be resolved for it, so the
   * header-checking path in `unarchive` cannot be reused there.
   */
  async function removeFromArchiveSet (ids) {
    const remove = new Set(ids)
    if (remove.size === 0) return
    const mutate = async () => {
      const state = workspaceRegistry.requireState()
      const next = state.archivedSessionIds.filter((id) => !remove.has(id))
      if (next.length === state.archivedSessionIds.length) return
      await workspaceRegistry.setState({ ...state, archivedSessionIds: next })
    }
    const enqueue = workspaceRegistry.enqueueOperation?.bind(workspaceRegistry)
    await (enqueue ? enqueue(mutate) : mutate())
  }

  /**
   * Drop ids from every workspace account. A deleted session must not survive
   * as an accounting row: the grouping surfaces render from workspace records
   * and from the registry archive set, so a stale id keeps producing a session
   * row whose log no longer exists — which reads as "the session I deleted
   * reappeared in the sidebar". The host's own delete path detaches the same
   * way; clearing `archivedSessionIds` alone is only half the bookkeeping.
   *
   * Best effort by design: a host generation without `detachSession` skips it,
   * and a failed detach must never fail an already-finished deletion.
   */
  async function detachFromWorkspaces (ids) {
    if (ids.length === 0) return
    let workspaces
    try { workspaces = workspaceRegistry.list() } catch { return }
    for (const workspace of workspaces) {
      if (typeof workspace?.detachSession !== 'function') continue
      for (const id of ids) {
        try { await workspace.detachSession(id) } catch { /* stale accounting is reconciled by the host */ }
      }
    }
  }

  /**
   * Drop the persisted projection checkpoint of deleted sessions.
   *
   * The cache serves history lists, and a session log that no longer exists
   * leaves nothing to invalidate the checkpoint against — so the stale record
   * keeps the deleted session alive on the sidebar. Checkpoints are derived
   * data (the session log is authoritative), so removing one is always safe:
   * a live session simply rebuilds it on the next read.
   *
   * Best effort: a missing or unwritable cache directory must not fail a
   * deletion that already succeeded.
   */
  async function dropProjectionCache (ids) {
    if (projectionCacheRoot === undefined || ids.length === 0) return
    for (const id of ids) {
      await rm(join(projectionCacheRoot, `${id}.json`), { force: true }).catch(() => {})
    }
  }

  /**
   * `ids` plus every session descended from them through `parentSession`
   * (subagent lineage), transitively.
   *
   * A subagent session is never archived on its own, so it carries no archive
   * registration to check. Deleting a parent without it is what orphans the
   * child log on disk: the directory survives, it has no cwd-based title, and
   * it resurfaces on the sidebar as a title-less "root" row.
   */
  function withDescendants (headers, ids) {
    const byParent = new Map()
    for (const header of headers) {
      const parent = header.parentSession
      if (typeof parent !== 'string') continue
      const children = byParent.get(parent)
      if (children === undefined) byParent.set(parent, [headerId(header)])
      else children.push(headerId(header))
    }
    const seen = new Set(ids)
    const queue = [...ids]
    while (queue.length > 0) {
      for (const child of byParent.get(queue.pop()) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        queue.push(child)
      }
    }
    return [...seen]
  }

  async function unarchive (ids) {
    const headers = await getHeaders()
    const archived = archiveIds()
    const valid = []
    for (const id of ids) {
      requireSessionId(id)
      if (!archived.has(id)) throw new ArchiveError(`archived session not found: ${id}`)
      const header = await headerFor(id, headers)
      if (!header) throw new ArchiveError(`archived session not found: ${id}`)
      valid.push(id)
    }
    if (valid.length === 0) return { unarchived: [] }
    await removeFromArchiveSet(valid)
    return { unarchived: valid }
  }

  /**
   * The bookkeeping side of a deletion, once the directories have moved: clear
   * the archive registration, the per-workspace accounting row, and the
   * projection checkpoint. Each step is best effort, because a completed delete
   * must not turn into an error over a stale row.
   */
  async function reconcileDeleted (ids) {
    if (ids.length === 0) return
    await removeFromArchiveSet(ids)
    await detachFromWorkspaces(ids)
    await dropProjectionCache(ids)
  }

  /**
   * Move validated plans into the trash, reconciling the bookkeeping for every
   * directory that did move even when a later one fails part-way.
   */
  async function movePlansToTrash (plans) {
    const moved = []
    try {
      for (const plan of plans) {
        const { id, header, sourceDir, destination } = plan
        const manifest = { version: 1, sessionId: id, originalDir: sourceDir, title: deriveTitle(header), cwd: header.cwd, updatedAt: deriveUpdatedAt(header), deletedAt: now() }
        await mkdir(trashRoot, { recursive: true })
        const pending = join(trashRoot, `.pending-${id}-${process.pid}-${Date.now()}.json`)
        try {
          await writeManifest(pending, JSON.stringify(manifest), 'utf8')
          await rename(sourceDir, destination)
          try {
            await rename(pending, join(destination, 'manifest.json'))
          } catch (error) {
            await rename(destination, sourceDir).catch(() => {})
            throw error
          }
        } finally {
          await rm(pending, { force: true }).catch(() => {})
        }
        moved.push(id)
      }
    } finally {
      await reconcileDeleted(moved)
    }
    return moved
  }

  async function trash (ids) {
    const liveIds = new Set((await sessions.list()).map(headerId))
    const headers = await getHeaders()
    const archived = archiveIds()

    // Phase 1 — validate every target before touching the filesystem. Checking
    // while moving (the older shape) left a batch half-trashed as soon as one
    // entry was refused, and the archive set then never got reconciled because
    // the throw skipped it. Validating up front makes a batch all-or-nothing
    // for every checkable condition.
    //
    // Descendants ride along: they are never archived individually, so the
    // archive-set check applies to the requested roots only.
    const roots = new Set(ids)
    const targets = withDescendants(headers, ids)
    const plans = []
    for (const id of targets) {
      requireSessionId(id)
      if (liveIds.has(id)) throw new LiveSessionError(id)
      if (roots.has(id) && !archived.has(id)) throw new ArchiveError(`archived session not found: ${id}`)
      const header = await headerFor(id, headers)
      if (header === undefined) {
        if (roots.has(id)) throw new ArchiveError(`archived session not found: ${id}`)
        continue
      }
      const sourceDir = sourceDirFor(header)
      validateSourceDir(sourceDir)
      // Same as listArchived: probe with `stat()`, not with the current-generation path.
      if (await sessionPersistence.stat(id) === undefined) throw new ArchiveError(`archived session not materialized: ${id}`)
      const destination = join(trashRoot, id)
      if (await exists(destination)) throw new ArchiveError(`destination collision: ${id}`)
      plans.push({ id, header, sourceDir, destination })
    }

    // Phase 2 — move. `moved` is reconciled inside `movePlansToTrash` because a
    // failure part-way through a batch must still drop the ids that did move;
    // leaving them in the registries is what let a restore resurrect a row.
    return { moved: await movePlansToTrash(plans) }
  }

  async function restore (ids) {
    const restored = []
    for (const id of ids) {
      requireSessionId(id)
      const item = await readManifest(id, { strict: true })
      if (!item) throw new ArchiveError(`invalid trash entry: ${id}`)
      if (await exists(item.manifest.originalDir)) throw new ArchiveError(`destination collision: ${id}`)
      await mkdir(dirname(item.manifest.originalDir), { recursive: true })
      // `manifest.json` is the trash's own bookkeeping file. The whole directory
      // is renamed back, so it would otherwise land inside a live session
      // directory as an artifact the persistence scan does not own.
      await rm(join(item.dir, 'manifest.json'), { force: true })
      await rename(item.dir, item.manifest.originalDir)
      restored.push(id)
    }
    if (restored.length === 0) return { restored }
    // Restoring puts the session back on the grouping surfaces, so it must not
    // stay in the archive set. Idempotent for ids `trash` already cleared.
    await removeFromArchiveSet(restored)
    return { restored }
  }

  /**
   * Scan for every stale record a delete can leave behind and clear it:
   *
   *  1. sessions orphaned by a deleted ancestor (their `parentSession` chain
   *     dead-ends at a session that no longer exists),
   *  2. archive ids whose session no longer exists,
   *  3. workspace accounting rows whose session no longer exists,
   *  4. projection checkpoints whose session no longer exists.
   *
   * (1) is moved to the TRASH, never destroyed, so a cleanup stays reversible.
   * The rest are rows with nothing behind them: (2) and (3) can never resolve to
   * a header again, and (4) is the one that kept a deleted session visible on
   * the sidebar.
   *
   * @returns what was moved and what was dropped, for reporting.
   */
  async function cleanup () {
    const headers = await getHeaders()
    const byId = new Map(headers.map((header) => [headerId(header), header]))

    // A session is stale when walking up its `parentSession` chain dead-ends at
    // a session that no longer exists, or when the chain cycles.
    const reachesRoot = (id) => {
      const seen = new Set()
      let current = byId.get(id)
      while (current !== undefined) {
        if (seen.has(current.id)) return false
        seen.add(current.id)
        if (typeof current.parentSession !== 'string') return true
        current = byId.get(current.parentSession)
      }
      return false
    }

    const plans = []
    for (const header of headers) {
      if (typeof header.parentSession !== 'string') continue
      const id = headerId(header)
      if (reachesRoot(id)) continue
      const sourceDir = sourceDirFor(header)
      try { validateSourceDir(sourceDir) } catch { continue }
      if (await sessionPersistence.stat(id) === undefined) continue
      const destination = join(trashRoot, id)
      if (await exists(destination)) continue
      plans.push({ id, header, sourceDir, destination })
    }
    const moved = await movePlansToTrash(plans)

    const liveIds = new Set(byId.keys())
    const deadArchive = [...archiveIds()].filter((id) => !liveIds.has(id))
    await removeFromArchiveSet(deadArchive)

    let detached = 0
    try {
      for (const workspace of workspaceRegistry.list()) {
        if (typeof workspace?.detachSession !== 'function') continue
        for (const id of (workspace.sessionIds ?? []).filter((entry) => !liveIds.has(entry))) {
          try { await workspace.detachSession(id); detached += 1 } catch { /* host reconciles later */ }
        }
      }
    } catch { /* registry unavailable: the rows stay until the host reconciles */ }

    let dropped = 0
    if (projectionCacheRoot !== undefined) {
      let entries = []
      try { entries = await readdir(projectionCacheRoot) } catch { entries = [] }
      for (const entry of entries) {
        if (!entry.endsWith('.json') || liveIds.has(entry.slice(0, -5))) continue
        try { await rm(join(projectionCacheRoot, entry), { force: true }); dropped += 1 } catch { /* best effort */ }
      }
    }

    return { moved, unarchived: deadArchive.length, detached, dropped }
  }

  async function purge (ids) {
    const explicit = ids !== undefined
    let candidates = ids
    if (candidates === undefined) {
      try { candidates = (await readdir(trashRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && SESSION_ID.test(entry.name)).map((entry) => entry.name) } catch { candidates = [] }
    }
    const purged = []
    for (const id of candidates) {
      requireSessionId(id)
      const item = await readManifest(id)
      if (item) {
        await rm(item.dir, { recursive: true, force: false })
        purged.push(id)
        continue
      }
      // A directory whose manifest is missing or invalid is still trash: it is
      // invisible to `listTrash` and impossible to restore or remove from any
      // surface, so skipping it forever leaves "empty the trash" reporting
      // success while the directory keeps occupying disk.
      const orphan = join(trashRoot, id)
      if (await exists(orphan)) {
        await rm(orphan, { recursive: true, force: false })
        purged.push(id)
        continue
      }
      // An explicitly named target that is not in the trash is an error, not a
      // silent success: the caller asked to destroy one specific session, so
      // answering `ok` would hide that nothing was destroyed.
      if (explicit) throw new ArchiveError(`invalid trash entry: ${id}`)
    }
    if (purged.length === 0) return { purged }
    // A purged id must never survive in the archive set; a dead id there can
    // never be resolved to a header, so no surface could clear it later.
    await removeFromArchiveSet(purged)
    // The workspace account has to drop it as well, or the grouping surface
    // keeps rendering a row for a log that is now gone for good.
    await detachFromWorkspaces(purged)
    await dropProjectionCache(purged)
    return { purged }
  }

  return { listArchived, listWorkspaces, listTrash, unarchive, trash, restore, purge, cleanup, previewSession }
}
