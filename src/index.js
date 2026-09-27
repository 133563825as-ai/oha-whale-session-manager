import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createArchiveStore } from './archive-store.js'
import { registerRoutes } from './http.js'

export const name = 'dsh-session-manager'
export const inject = ['webServer', 'sessionPersistence', 'workspaceRegistry', 'sessions']

function resolveDshHome (ctx) {
  if (typeof ctx.dshHomePath === 'function') return ctx.dshHomePath()
  const fromEnv = process.env.DSH_HOME
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return resolve(fromEnv)
  return join(homedir(), '.dsh')
}

export function apply (ctx) {
  const home = resolveDshHome(ctx)
  const store = createArchiveStore({
    sessionPersistence: ctx.sessionPersistence,
    workspaceRegistry: ctx.workspaceRegistry,
    sessions: ctx.sessions,
    sessionsRoot: join(home, 'sessions'),
    trashRoot: join(home, 'storages', 'dsh-session-manager', 'trash'),
    // History lists and sidebar rows read these checkpoints, so a deleted
    // session must take its checkpoint with it or it keeps showing up.
    projectionCacheRoot: join(home, 'storages', 'session_projcache', 'sessions')
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => registerRoutes({
      webServer: webCtx.webServer,
      store
    }), 'dsh-session-manager: routes')
  })
}
