import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireSessionId (id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) {
    throw new Error(`invalid session id: ${id}`)
  }
}

async function exists (path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function headerId (header) {
  return header.id ?? header.sessionId
}

function contentOf (event) {
  return event?.content ?? event?.message?.content ?? event?.data?.content
}

function isMessage (event, role) {
  return (event?.role === role || event?.type === role) &&
    (event?.type === 'message' || event?.subtype === 'message' || event?.kind === 'message' || event?.message?.type === 'message')
}

function isManifest (manifest, id) {
  return manifest?.version === 1 &&
    manifest.sessionId === id &&
    SESSION_ID.test(manifest.sessionId) &&
    typeof manifest.originalDir === 'string' && isAbsolute(manifest.originalDir) &&
    typeof manifest.title === 'string' &&
    typeof manifest.cwd === 'string' &&
    typeof manifest.updatedAt === 'string' &&
    typeof manifest.deletedAt === 'string'
}

export function createArchiveStore ({ sessionPersistence, workspaceRegistry, sessions, sessionsRoot: _sessionsRoot, trashRoot, now = () => new Date().toISOString() }) {
  const getHeaders = () => sessionPersistence.list()
  const archiveIds = () => new Set(workspaceRegistry.archivedSessionIds ?? [])

  async function headerFor (id, headers) {
    const availableHeaders = headers ?? await getHeaders()
    return availableHeaders.find((header) => headerId(header) === id)
  }

  function sourceDirFor (header) {
    return dirname(sessionPersistence.locate(header).path)
  }

  async function readManifest (id) {
    requireSessionId(id)
    const dir = join(trashRoot, id)
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
      return isManifest(manifest, id) ? { dir, manifest } : null
    } catch {
      return null
    }
  }

  async function previewSession (id) {
    requireSessionId(id)
    const header = await headerFor(id)
    if (!header) return { missing: true }

    const events = await sessionPersistence.inspect(id)
    let lastUser
    let lastAssistant
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (lastUser === undefined && isMessage(event, 'user')) lastUser = String(contentOf(event) ?? '').slice(0, 280)
      if (lastAssistant === undefined && isMessage(event, 'assistant')) lastAssistant = String(contentOf(event) ?? '').slice(0, 280)
      if (lastUser !== undefined && lastAssistant !== undefined) break
    }

    return { id, title: header.title, updatedAt: header.updatedAt, cwd: header.cwd, lastUser, lastAssistant }
  }

  async function listArchived () {
    const headers = await getHeaders()
    const entries = []
    for (const id of archiveIds()) {
      const header = await headerFor(id, headers)
      if (!header) continue
      if (!(await exists(sessionPersistence.locate(header).path))) {
        entries.push({ id, title: header.title, updatedAt: header.updatedAt, cwd: header.cwd, missing: true })
        continue
      }
      entries.push(await previewSession(id))
    }
    return entries.sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
  }

  async function listTrash () {
    let entries
    try {
      entries = await readdir(trashRoot, { withFileTypes: true })
    } catch {
      return []
    }

    const trash = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue
      const item = await readManifest(entry.name)
      if (!item) continue
      const { manifest } = item
      trash.push({
        id: manifest.sessionId,
        title: manifest.title,
        cwd: manifest.cwd,
        updatedAt: manifest.updatedAt,
        deletedAt: manifest.deletedAt,
      })
    }
    return trash.sort((left, right) => String(right.deletedAt).localeCompare(String(left.deletedAt)))
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
      const artifactPath = sessionPersistence.locate(header).path
      const destination = join(trashRoot, id)
      if (!(await exists(artifactPath))) throw new Error(`archived session not materialized: ${id}`)
      if (await exists(destination)) throw new Error(`destination collision: ${id}`)

      await mkdir(trashRoot, { recursive: true })
      await rename(sourceDir, destination)
      const manifest = {
        version: 1,
        sessionId: id,
        originalDir: sourceDir,
        title: header.title,
        cwd: header.cwd,
        updatedAt: header.updatedAt,
        deletedAt: now(),
      }
      const temporaryPath = join(destination, `.manifest-${process.pid}-${Date.now()}.tmp`)
      await writeFile(temporaryPath, JSON.stringify(manifest), 'utf8')
      await rename(temporaryPath, join(destination, 'manifest.json'))
      moved.push(id)
    }

    return { moved }
  }

  async function restore (ids) {
    const restored = []
    for (const id of ids) {
      requireSessionId(id)
      const item = await readManifest(id)
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
      try {
        candidates = (await readdir(trashRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && SESSION_ID.test(entry.name))
          .map((entry) => entry.name)
      } catch {
        candidates = []
      }
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

  return { listArchived, listTrash, trash, restore, purge, previewSession }
}
