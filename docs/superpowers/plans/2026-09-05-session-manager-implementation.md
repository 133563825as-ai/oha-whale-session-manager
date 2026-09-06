# 会话管理面板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建可安装的 `dsh-session-manager` 插件，为 DSH 提供归档会话查看、末尾消息预览、回收站删除、恢复和彻底清空能力。

**Architecture:** 这是一个可安装 bundle，包含主机侧和 Web 客户端。主机侧通过 `ctx.sessionPersistence` 和 `ctx.workspaceRegistry` 获取会话信息，通过 `webServer` 暴露本地 HTTP 接口；客户端通过 `sidebar.footer.action` 注册入口，通过 `shell.overlay` 注册居中模态弹窗。主机负责会话读取与文件移动，客户端只负责展示、交互和刷新数据。

**Tech Stack:** Node.js ESM、Cordis、DSH `dsh-session-persistence`、`dsh-session-persistence-jsonl`、`dsh-workspace`、React 18、`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、现有 DSH client bundle loader。

**Spec:** `docs/superpowers/specs/2026-09-05-session-manager-design.md`

## Global Constraints

- 使用 DSH `0.1.1-rc.2` 当前安装接口，不根据旧教程猜 API。
- 不使用 `/api` 作为插件自有 HTTP 路由前缀；使用 `/session-manager`。
- 不自行解析 zstd；预览使用 `ctx.sessionPersistence.inspect(sessionId)`。
- 不修改会话日志内容；删除只移动整个会话目录，清空回收站才永久删除。
- 当前打开的会话禁止删除。
- 所有 session id 必须经过 UUID 格式校验，拒绝路径穿越。
- UI 使用线性图标或文字，不使用 emoji；回复、文档、代码注释、界面文案均不使用 emoji。
- 弹窗使用居中模态布局：遮罩覆盖全屏、阻止背景操作、支持关闭按钮、遮罩点击和 Android 返回键；手机宽度 `min(92vw, 400px)`、高度 `min(58vh, 480px)`。
- 不发布 npm、不推送 GitHub、不重启用户当前 DSH 服务，除非用户另行明确要求。
- 每个测试脚本失败时必须设置非零退出码。

---

## 文件结构

**创建：**

- `package.json`：bundle 名称、版本、导出、client 注入依赖、构建与测试脚本。
- `cordis.patch.yml`：向 profile 插入 host bundle 行。
- `README.md`：安装、使用、回收站语义和本地开发说明。
- `src/index.js`：host 插件入口、HTTP 路由注册、接口编排。
- `src/archive-store.js`：归档列表读取、事件预览、当前会话保护、回收站元数据和移动操作。
- `src/http.js`：HTTP 请求体解析、JSON 响应、错误响应和方法分发辅助函数。
- `client/client.js`：DSH 浏览器 bundle loader 入口、侧边栏按钮、模态弹窗、归档/回收站列表和接口调用。
- `test/archive-store.test.mjs`：纯 Node 文件系统与模拟持久化对象测试。
- `test/http.test.mjs`：请求方法、JSON body、参数校验和响应状态测试。
- `test/client-static.test.mjs`：client bundle 静态契约检查，确保 loader、座位名、遮罩和无 emoji 约束没有回退。

**不创建：** TypeScript 源码、独立前端应用、替代 DSH 会话列表的页面、会话日志格式修改器。

---

### Task 1: 创建 bundle 骨架和最小 Loader

**Files:**
- Create: `package.json`
- Create: `cordis.patch.yml`
- Create: `src/index.js`
- Create: `client/client.js`
- Create: `README.md`
- Test: `test/client-static.test.mjs`

**Interfaces:**
- Produces host exports `{ name: 'dsh-session-manager', inject: ['webServer', 'sessionPersistence', 'workspaceRegistry', 'sessions'], apply(ctx) }`。
- Produces client loader module id `dsh-session-manager`，客户端 `apply(ctx)` 注册入口所需的 `slots`、`locale`、`sessions`、`workspaces`。

- [ ] **Step 1: Write the failing static contract test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

test('package declares host bundle and web client', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(pkg.name, 'dsh-session-manager')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.exports['./client'])
})

test('client contains loader and required seats', async () => {
  const source = await readFile(new URL('client/client.js', root), 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load/)
  assert.match(source, /sidebar\.footer\.action/)
  assert.match(source, /shell\.overlay/)
  assert.doesNotMatch(source, /[\u{1F000}-\u{1FAFF}]/u)
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/client-static.test.mjs`
Expected: FAIL because the package and client files do not exist.

- [ ] **Step 3: Write the minimal package and loader**

`package.json` must include:

```json
{
  "name": "dsh-session-manager",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js",
  "exports": {
    ".": "./src/index.js",
    "./client": "./client/client.js",
    "./package.json": "./package.json"
  },
  "files": ["src", "client", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-ui-layout"
      ]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-session-persistence": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-workspace": "^0.1.1-rc.2",
    "react": "^18.2.0"
  },
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "check": "node --check src/index.js && node --check src/archive-store.js && node --check src/http.js && node --check client/client.js"
  }
}
```

`cordis.patch.yml` must insert one stable host row:

```yaml
- insert:
    - id: dsh-session-manager
      name: dsh-session-manager
```

`src/index.js` exports the stable name, injection list, and an `apply` that currently installs no routes. `client/client.js` exports `apply` inside the established `window.__ModuleLoader__.load({ id, factory })` wrapper and currently registers no-op functions.

- [ ] **Step 4: Run the test and syntax checks**

Run: `node --test test/client-static.test.mjs && npm run check`
Expected: PASS; all JavaScript files parse.

- [ ] **Step 5: Commit the scaffold**

```bash
git add package.json cordis.patch.yml src/index.js client/client.js README.md test/client-static.test.mjs
git commit -m "feat: scaffold session manager bundle"
```

---

### Task 2: Implement and test safe archive storage operations

**Files:**
- Create: `src/archive-store.js`
- Modify: `src/index.js`
- Create: `test/archive-store.test.mjs`

**Interfaces:**
- Consumes: `sessionPersistence.inspect(id)`, `sessionPersistence.list()`, `sessionPersistence.locate(meta)`, `workspaceRegistry.archivedSessionIds`。
- Produces:
  - `createArchiveStore({ sessionPersistence, workspaceRegistry, currentSessionId, homeDir, now })`
  - `listArchived(): Promise<ArchiveEntry[]>`
  - `listTrash(): Promise<TrashEntry[]>`
  - `trash(ids: string[]): Promise<MutationResult>`
  - `restore(ids: string[]): Promise<MutationResult>`
  - `purge(ids?: string[]): Promise<MutationResult>`
  - `previewSession(id): Promise<Preview | { missing: true }>`

`ArchiveEntry` fields: `id`, `title`, `updatedAt`, `cwd`, `lastUser`, `lastAssistant`. `TrashEntry` adds `deletedAt` and `originalPath` internally; only the client-safe fields are returned by HTTP.

- [ ] **Step 1: Write failing storage tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArchiveStore } from '../src/archive-store.js'

function fixture(root, id, title = '测试会话') {
  const sessionPath = join(root, 'sessions', id)
  return mkdir(sessionPath, { recursive: true }).then(async () => {
    await writeFile(join(sessionPath, 'session.jsonl'), 'fixture')
    return {
      id, title, cwd: '/workspace/demo', createdAt: 1000, updatedAt: 3000,
      path: join(sessionPath, 'session.jsonl')
    }
  })
}

test('lists only archived materialized sessions in updated order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-manager-'))
  const one = await fixture(root, '11111111-1111-4111-8111-111111111111', '较旧')
  const two = await fixture(root, '22222222-2222-4222-8222-222222222222', '较新')
  const store = createArchiveStore({
    sessionPersistence: { list: async () => [one, two] },
    workspaceRegistry: { archivedSessionIds: [one.id, two.id] },
    sessionsRoot: join(root, 'sessions'),
    trashRoot: join(root, 'trash')
  })
  const rows = await store.listArchived()
  assert.deepEqual(rows.map(row => row.id), [two.id, one.id])
})

test('trashes and restores a session using a manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-manager-'))
  const id = '33333333-3333-4333-8333-333333333333'
  const sessionDir = join(root, 'sessions', id)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, 'session.jsonl'), 'fixture')
  const store = createArchiveStore({
    sessionPersistence: { list: async () => [{ id, title: '可恢复', updatedAt: 1, cwd: '/x', path: join(sessionDir, 'session.jsonl') }] },
    workspaceRegistry: { archivedSessionIds: [id] },
    sessionsRoot: join(root, 'sessions'),
    trashRoot: join(root, 'trash')
  })
  assert.deepEqual((await store.trash([id])).moved, [id])
  assert.equal((await store.listTrash()).length, 1)
  assert.deepEqual((await store.restore([id])).restored, [id])
  assert.equal((await store.listTrash()).length, 0)
})

test('rejects the current session and invalid ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-manager-'))
  const id = '44444444-4444-4444-8444-444444444444'
  const store = createArchiveStore({
    sessionPersistence: { list: async () => [] },
    workspaceRegistry: { archivedSessionIds: [] },
    currentSessionId: id,
    sessionsRoot: join(root, 'sessions'),
    trashRoot: join(root, 'trash')
  })
  await assert.rejects(() => store.trash([id]), /current session/)
  await assert.rejects(() => store.trash(['..']), /invalid session id/)
})
```

- [ ] **Step 2: Run the storage tests and verify failure**

Run: `node --test test/archive-store.test.mjs`
Expected: FAIL because `src/archive-store.js` is not implemented.

- [ ] **Step 3: Implement safe path and metadata helpers**

Implement these exact rules:

```js
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertSessionId(id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) throw new Error('invalid session id')
}
```

Resolve the configured DSH home from `process.env.DSH_HOME || join(homedir(), '.dsh')`. Use the persistence backend's `locate(meta).path` to identify the session artifact and `dirname(path)` as the source session directory. Do not reconstruct the cwd directory name from a session id.

`listArchived()` obtains `workspaceRegistry.archivedSessionIds`, obtains `sessionPersistence.list()`, intersects by id, maps title/cwd/updatedAt, calls `previewSession` for the last user and assistant text, sorts descending by `updatedAt`, and returns a fresh array. Missing archived ids return a row with `missing: true` only if the list endpoint needs diagnostics; they must not cause the whole request to fail.

`previewSession(id)` calls `sessionPersistence.inspect(id)`, scans events from the end, extracts the latest `user/message` and `assistant/message`, and normalizes content to plain text. Truncate user and assistant independently to 280 UTF-16 code units for the collapsed row; the client may render the returned values with CSS line clamping.

- [ ] **Step 4: Implement atomic trash, restore, and purge**

Use `mkdir(..., { recursive: true })`, `rename(sourceDir, trashDir)`, and a manifest written before or after the move according to this recovery rule: write a temporary manifest in the trash parent, perform the rename, then rename the temporary manifest into `manifest.json`. A failed move must leave no completed manifest for a source that is still present. Reject a destination collision rather than overwriting it.

Manifest shape:

```js
{
  version: 1,
  sessionId,
  originalDir,
  title,
  cwd,
  updatedAt,
  deletedAt
}
```

Before trashing, reject `currentSessionId` and any id not present in the current persistence list. `restore` reads and validates the manifest, checks the original parent and destination absence, then moves the directory back. `purge` recursively removes only trash directories whose names pass the UUID validator and whose manifest passes session-id validation; never accept arbitrary paths from request data.

- [ ] **Step 5: Run storage tests and syntax checks**

Run: `node --test test/archive-store.test.mjs && node --check src/archive-store.js`
Expected: PASS with nonzero exit on any failure.

- [ ] **Step 6: Commit storage behavior**

```bash
git add src/archive-store.js src/index.js test/archive-store.test.mjs
git commit -m "feat: add archive preview and recycle bin storage"
```

---

### Task 3: Add host HTTP routes with request validation

**Files:**
- Create: `src/http.js`
- Modify: `src/index.js`
- Create: `test/http.test.mjs`

**Interfaces:**
- Consumes: archive-store methods from Task 2 and DSH `WebServer.register({ kind, path, handler })`.
- Produces:
  - `registerRoutes({ webServer, store, getCurrentSessionId })`
  - `GET /session-manager/archives`
  - `GET /session-manager/trash`
  - `POST /session-manager/trash` with `{ ids: string[] }`
  - `POST /session-manager/restore` with `{ ids: string[] }`
  - `POST /session-manager/purge` with `{ ids?: string[] }`

Response envelope: success `{ ok: true, ... }`; client error `{ ok: false, error: { code, message } }`; unexpected error `{ ok: false, error: { code: 'internal-error', message: '操作失败' } }` without filesystem paths or stack traces.

- [ ] **Step 1: Write failing HTTP handler tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerRoutes } from '../src/http.js'

function response() {
  return {
    status: 0, headers: {}, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body = '') { this.body = body }
  }
}
function request(method, body) {
  return { method, headers: { 'content-length': body ? String(Buffer.byteLength(body)) : '0' }, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body) } }
}

test('rejects unsupported methods and malformed JSON', async () => {
  const routes = new Map()
  registerRoutes({ webServer: { register(route) { routes.set(`${route.kind}:${route.path}`, route.handler); return () => {} } }, store: {} })
  const res = response()
  await routes.get('prefix:/session-manager')(request('POST', '{'), res)
  assert.equal(res.status, 400)
  assert.match(res.body, /invalid-json/)
})

test('trashes ids through the store', async () => {
  const calls = []
  const routes = new Map()
  registerRoutes({ webServer: { register(route) { routes.set(`${route.kind}:${route.path}`, route.handler); return () => {} } }, store: { trash: async ids => { calls.push(ids); return { moved: ids } } } })
  const res = response()
  await routes.get('prefix:/session-manager')(request('POST', JSON.stringify({ ids: ['11111111-1111-4111-8111-111111111111'] })), res)
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [['11111111-1111-4111-8111-111111111111']])
})
```

- [ ] **Step 2: Run HTTP tests and verify failure**

Run: `node --test test/http.test.mjs`
Expected: FAIL because `src/http.js` is not implemented.

- [ ] **Step 3: Implement bounded request and JSON helpers**

`parseJsonBody(req, maxBytes = 256 * 1024)` must reject unsupported content length, over-limit bodies, malformed JSON, and non-object JSON. `sendJson(res, status, data)` sets `content-type: application/json; charset=utf-8`, `cache-control: no-store`, and an accurate `content-length`.

The prefix handler parses `new URL(req.url ?? '/', 'http://127.0.0.1').pathname`, dispatches only the five documented paths, allows `GET` only for archives/trash, and allows `POST` only for trash/restore/purge. Unknown paths return 404; invalid methods return 405 with an `allow` header.

Validate `ids` as a non-empty array of UUID strings, deduplicate while preserving order, and cap one mutation request at 100 ids. `purge` accepts omitted ids to mean all trash entries; if present it uses the same validation.

- [ ] **Step 4: Wire routes in host `apply` with Cordis cleanup**

In `src/index.js`, inject `webServer`, `sessionPersistence`, `workspaceRegistry`, and `sessions`. Resolve the active session ids from `ctx.sessions.list()` on every mutation request, and pass that set to the store; all live sessions, not only the selected one, are protected. Register the prefix route inside `ctx.effect`, return the web-server disposer, and label it `dsh-session-manager: routes`.

The host bundle must not create its own HTTP server or listen on a new port.

- [ ] **Step 5: Run route tests and syntax checks**

Run: `node --test test/http.test.mjs test/archive-store.test.mjs && node --check src/http.js && node --check src/index.js`
Expected: PASS.

- [ ] **Step 6: Commit host API**

```bash
git add src/http.js src/index.js test/http.test.mjs
git commit -m "feat: expose session manager archive routes"
```

---

### Task 4: Implement client entry, sidebar action, and modal shell

**Files:**
- Modify: `client/client.js`
- Modify: `test/client-static.test.mjs`

**Interfaces:**
- Consumes: DSH client standard global props `useSessions`, `useWorkspaces`, `slots`, `locale`; host routes from Task 3.
- Produces: sidebar action id `dsh-session-manager`, overlay entry id `dsh-session-manager`, local modal state and refresh callback.

- [ ] **Step 1: Extend the static test with UI contracts**

```js
test('client declares modal behavior and archive routes', async () => {
  const source = await readFile(new URL('client/client.js', root), 'utf8')
  const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const text of [
    'sidebar.footer.action', 'shell.overlay', 'dsh-session-manager',
    '/session-manager/archives', '/session-manager/trash',
    'aria-modal="true"', 'session-manager-backdrop'
  ]) assert.match(source, new RegExp(escapeRegExp(text)))
  assert.match(source, /58vh/)
  assert.match(source, /92vw/)
})
```

- [ ] **Step 2: Run the static test and verify it fails**

Run: `node --test test/client-static.test.mjs`
Expected: FAIL for the missing UI strings.

- [ ] **Step 3: Implement loader imports and locale dictionaries**

Use the existing browser bundle style: `window.__ModuleLoader__.load({ id: 'dsh-session-manager', factory: (require) => { ... } })`. Load React through `require('react')`, and use the primitive icon/tooltip components only if their current exported names are verified from installed declarations. If an icon export is uncertain, use a text label button with an accessible `aria-label`; never invent a package export.

Register locale namespace `dsh-session-manager` with Chinese and English keys for titles, tabs, empty states, confirmations, errors, and actions. All visible Chinese copy must avoid emoji.

- [ ] **Step 4: Implement sidebar action registration**

Register into `sidebar.footer.action` through `ctx.slots.inject`. The entry receives `{ wide }`; render icon plus `会话管理` when wide and icon or short text with tooltip when narrow. The button sets `open = true` and does not navigate away from the current session.

Register into `shell.overlay` through a root-scoped slot entry. Render nothing when `open` is false. When open, render a fixed inset backdrop with `pointer-events: auto`, a centered dialog with `role="dialog"`, `aria-modal="true"`, and `tabIndex={-1}`. Stop propagation for dialog pointer and click events. Clicking the backdrop calls close. The close button calls close. Add a document-level `keydown` listener for Escape and a browser history marker for Android back: push a history state on open, pop it on back, and remove the listener/state on close or unload. Never call `history.back()` blindly on close; track whether this plugin created the marker.

Use CSS dimensions exactly as specified:

```css
.session-manager-dialog {
  width: min(92vw, 400px);
  height: min(58vh, 480px);
  max-height: min(58vh, 480px);
  display: flex;
  flex-direction: column;
}
.session-manager-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, .48);
  pointer-events: auto;
  touch-action: none;
}
```

The dialog itself must restore `touch-action: auto`, keep the list scrollable, and never allow the background page to scroll while open.

- [ ] **Step 5: Run static test and syntax check**

Run: `node --test test/client-static.test.mjs && node --check client/client.js`
Expected: PASS.

- [ ] **Step 6: Commit modal shell**

```bash
git add client/client.js test/client-static.test.mjs
git commit -m "feat: add centered session manager modal"
```

---

### Task 5: Implement archive and trash views with safe confirmation flows

**Files:**
- Modify: `client/client.js`
- Modify: `README.md`
- Modify: `test/client-static.test.mjs`

**Interfaces:**
- Consumes: modal shell and host JSON routes from Tasks 3-4.
- Produces: archive tab, trash tab, expandable preview rows, selection mode, restore and purge operations.

- [ ] **Step 1: Extend static tests for view behavior**

```js
test('client contains archive and trash actions', async () => {
  const source = await readFile(new URL('client/client.js', root), 'utf8')
  for (const text of ['归档', '回收站', '选择', '全选', '删除所选', '恢复', '清空回收站', '最后一条用户消息']) {
    assert.match(source, new RegExp(text))
  }
  assert.match(source, /confirm|window\.confirm/)
  assert.match(source, /currentSession|useSessions/)
})
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --test test/client-static.test.mjs`
Expected: FAIL until archive/trash controls are implemented.

- [ ] **Step 3: Implement client API and state model**

Use a single `fetchJson(path, init)` helper that checks `response.ok`, parses JSON, and throws the server's safe error message. The modal state includes `tab`, `archives`, `trash`, `selectedIds`, `expandedId`, `selectionMode`, `loading`, `busyIds`, `error`, and `confirmAction`.

On open and tab switch, fetch the relevant endpoint. Refresh after every successful trash, restore, or purge. The archive response is host-authoritative; do not derive the archive list from `useWorkspaces`, because archived sessions are hidden from the normal session list.

Read `current` via `useSessions(state => state.current)` and disable the delete control for that id. The host must still re-check this condition.

- [ ] **Step 4: Implement archive rows and batch actions**

Render the archive list sorted by host order. Each row contains title, relative or formatted time, `你：` preview, `AI：` preview, a text delete action, and an expandable details area. Collapsed previews use at most two CSS lines; expanded previews use at most four lines. Use stable row height constraints so expanding one row does not resize neighboring controls unexpectedly.

Selection mode renders native checkboxes. The header provides `全选`, `取消全选`, and `删除所选（N）`. Single deletion sends `{ ids: [id] }`; batch deletion sends all selected ids. Both require a confirmation dialog whose text includes the affected count. Remove successfully moved rows from local state and refresh the trash tab data lazily.

Rows with `missing: true` are shown as `记录已丢失` and offer a cleanup action only when the host explicitly reports them; never guess a filesystem path in the browser.

- [ ] **Step 5: Implement trash rows and destructive confirmation**

Render deleted rows with title, deletion time, and the same previews. Single restore sends `{ ids: [id] }` and removes the row after success. `清空回收站` sends `POST /session-manager/purge` without ids and requires a confirmation containing `彻底删除，无法恢复`. If the trash is empty, render `回收站是空的`.

All pending network actions disable their own controls and show a non-emoji text error on failure. Closing the modal clears transient selection and confirmation state but must not cancel a request without handling its result.

- [ ] **Step 6: Run static tests and syntax checks**

Run: `node --test test/client-static.test.mjs && node --check client/client.js`
Expected: PASS.

- [ ] **Step 7: Commit archive and trash UI**

```bash
git add client/client.js README.md test/client-static.test.mjs
git commit -m "feat: add archive and recycle bin views"
```

---

### Task 6: Add package documentation and run the artifact preflight

**Files:**
- Modify: `README.md`
- Modify: `package.json` only if required by preflight
- Test: package artifact contents

**Interfaces:**
- Consumes: completed host/client bundle from Tasks 1-5.
- Produces: documented installable artifact with no local-only files.

- [ ] **Step 1: Write the README usage and safety sections**

Document:

```md
# dsh-session-manager

## 功能

- 查看归档会话
- 查看最后一问一答预览
- 单个或批量移动到回收站
- 恢复会话
- 清空回收站并永久删除

## 安装

dsh plugin --profile web add ./dsh-session-manager

## 语义

删除会话先移动到回收站；清空回收站后无法恢复。正在打开的会话不能删除。插件不修改会话日志内容。

## 开发

npm test
npm run check
```

Do not place emoji in the README.

- [ ] **Step 2: Run all local tests**

Run: `npm test`
Expected: all tests pass with exit code 0.

- [ ] **Step 3: Run the DSH bundle static preflight**

Run: `node /root/dsha-plugin-development/skills/dsh-plugin-development/scripts/check-artifact.mjs bundle /root/dsha-session-manager`
Expected: the checker accepts the package-to-patch relationship. If it reports an actual package or patch contract problem, fix the manifest or patch and rerun; do not suppress the checker.

- [ ] **Step 4: Inspect the package file list**

Run: `npm pack --dry-run`
Expected: only `package.json`, `src/`, `client/`, `cordis.patch.yml`, and `README.md` are included; no `.dsh`, session data, temporary files, API keys, or test fixture data are included.

- [ ] **Step 5: Commit documentation and preflight fixes**

```bash
git add README.md package.json cordis.patch.yml src client test
git commit -m "docs: document session manager installation and safety"
```

---

### Task 7: Verify the packaged bundle in an isolated profile

**Files:**
- No source changes unless verification finds a defect.
- Create only temporary files outside the repository.

**Interfaces:**
- Consumes: exact npm packed artifact and DSH profile loader.
- Produces: evidence that the package loads through the real bundle path and registers both host and client surfaces.

- [ ] **Step 1: Pack the exact artifact**

Run: `npm pack --pack-destination /tmp/dsh-session-manager-artifact`
Expected: one tarball containing the files checked in Task 6.

- [ ] **Step 2: Install into a disposable profile**

Create a temporary DSH home/profile under `/tmp` or another disposable directory. Link or install the exact tarball according to the local `dsh-plugin-install` procedure, without modifying `/root/.dsh/profiles/web/package.json`.

- [ ] **Step 3: Verify loader configuration**

Run the available profile dump command with the temporary profile and inspect that the bundle row id is `dsh-session-manager`, the module name is `dsh-session-manager`, and the client injection declaration is present.

- [ ] **Step 4: Exercise host routes with a temporary fixture**

Use the host test fixture to verify archive listing, preview extraction, trash, restore, and purge. Do not point the test at private user sessions and do not print conversation content.

- [ ] **Step 5: Exercise the real GUI only after the package passes static and isolated checks**

If the existing DSH web watcher is already running, use the existing `http://127.0.0.1:3080` only after rebuilding the affected Web artifact and refreshing the page. Verify the sidebar entry, centered modal, dark non-interactive backdrop, internal list scrolling, close button, backdrop close, Android back close, single delete, batch delete, restore, and purge. Do not start a replacement server.

- [ ] **Step 6: Record verification evidence and final commit if needed**

Run:

```bash
npm test
npm run check
node /root/dsha-plugin-development/skills/dsh-plugin-development/scripts/check-artifact.mjs bundle /root/dsha-session-manager
npm pack --dry-run
```

Record exact pass/fail results in the final response. Do not claim GUI completion if the real client bundle was not rebuilt and checked.

---

## Self-Review Checklist

- [x] The plan covers the approved centered modal instead of the earlier oversized modal.
- [x] The plan keeps archive and trash management separate from compression, rewind, and token display.
- [x] The plan uses host-authoritative archived-session listing.
- [x] The plan uses `sessionPersistence.inspect()` rather than custom zstd parsing.
- [x] The plan uses `sessionPersistence.locate(meta)` rather than guessing a session path from a UUID.
- [x] The plan validates UUIDs and blocks current-session deletion on both client and host.
- [x] The plan includes tests before implementation for storage, HTTP, and client contracts.
- [x] The plan includes nonzero test exit behavior through Node's test runner and explicit package scripts.
- [x] The plan includes bundle preflight, packed artifact inspection, and isolated profile verification.
- [x] The plan contains no emoji in user-facing artifact text.
- [x] No unresolved `TODO`, `TBD`, or placeholder implementation steps remain.
