import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const SESSION_ID = /^(session-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class OutsideSessionsRootError extends Error {}

function requireSessionId (id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) throw new Error(`invalid session id: ${id}`)
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

export function createArchiveStore ({ sessionPersistence, workspaceRegistry, sessions, sessionsRoot, trashRoot, now = () => new Date().toISOString(), writeManifest = writeFile }) {
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
    if (!isAbsolute(sourceDir) || !isInside(sessionsRoot, sourceDir)) throw new Error('source outside sessions root')
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

  async function unarchive (ids) {
    const headers = await getHeaders()
    const archived = archiveIds()
    const valid = []
    for (const id of ids) {
      requireSessionId(id)
      if (!archived.has(id)) throw new Error(`archived session not found: ${id}`)
      const header = await headerFor(id, headers)
      if (!header) throw new Error(`archived session not found: ${id}`)
      valid.push(id)
    }
    if (valid.length === 0) return { unarchived: [] }
    const remove = new Set(valid)
    const enqueue = workspaceRegistry.enqueueOperation?.bind(workspaceRegistry)
    const mutate = enqueue
      ? enqueue(async () => {
          const state = workspaceRegistry.requireState()
          const next = state.archivedSessionIds.filter((id) => !remove.has(id))
          if (next.length === state.archivedSessionIds.length) return
          await workspaceRegistry.setState({ ...state, archivedSessionIds: next })
        })
      : (async () => {
          const state = workspaceRegistry.requireState()
          const next = state.archivedSessionIds.filter((id) => !remove.has(id))
          if (next.length !== state.archivedSessionIds.length) await workspaceRegistry.setState({ ...state, archivedSessionIds: next })
        })()
    await mutate
    return { unarchived: valid }
  }

  async function trash (ids) {
    const liveIds = new Set((await sessions.list()).map(headerId))
    const headers = await getHeaders()
    const archived = archiveIds()
    const moved = []
    for (const id of ids) {
      requireSessionId(id)
      if (liveIds.has(id)) throw new Error(`live session cannot be trashed: ${id}`)
      if (!archived.has(id)) throw new Error(`archived session not found: ${id}`)
      const header = await headerFor(id, headers)
      if (!header) throw new Error(`archived session not found: ${id}`)
      const sourceDir = sourceDirFor(header)
      validateSourceDir(sourceDir)
      const destination = join(trashRoot, id)
      // Same as listArchived: probe with `stat()`, not with the current-generation path.
      if (await sessionPersistence.stat(id) === undefined) throw new Error(`archived session not materialized: ${id}`)
      if (await exists(destination)) throw new Error(`destination collision: ${id}`)
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
    return { moved }
  }

  async function restore (ids) {
    const restored = []
    for (const id of ids) {
      requireSessionId(id)
      const item = await readManifest(id, { strict: true })
      if (!item) throw new Error(`invalid trash entry: ${id}`)
      if (await exists(item.manifest.originalDir)) throw new Error(`destination collision: ${id}`)
      await mkdir(dirname(item.manifest.originalDir), { recursive: true })
      await rename(item.dir, item.manifest.originalDir)
      restored.push(id)
    }
    return { restored }
  }

  async function purge (ids) {
    let candidates = ids
    if (candidates === undefined) {
      try { candidates = (await readdir(trashRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && SESSION_ID.test(entry.name)).map((entry) => entry.name) } catch { candidates = [] }
    }
    const purged = []
    for (const id of candidates) {
      requireSessionId(id)
      const item = await readManifest(id)
      if (!item) continue
      await rm(item.dir, { recursive: true, force: false })
      purged.push(id)
    }
    return { purged }
  }

  return { listArchived, listWorkspaces, listTrash, unarchive, trash, restore, purge, previewSession }
}
