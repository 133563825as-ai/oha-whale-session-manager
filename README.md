# dsh-session-manager

`dsh-session-manager` is an installable DeepSeek Harness bundle for viewing archived sessions, previewing their last messages, and managing a recoverable recycle bin.

## Features

- Sidebar footer action opens a centered modal panel.
- Archive tab lists archived sessions with title, last activity time, and a truncated last user/assistant preview.
- Single and batch delete moves sessions into a filesystem recycle bin.
- Trash tab lists deleted sessions, supports single restore, and supports permanently emptying the trash.
- The currently live session is protected from deletion.
- Host sends no filesystem paths or stack traces to the browser.

## Host routes

- `GET /session-manager/archives`
- `GET /session-manager/trash`
- `POST /session-manager/trash` with `{ ids: string[] }`
- `POST /session-manager/restore` with `{ ids: string[] }`
- `POST /session-manager/purge` with `{ ids?: string[] }`

## Local commands

- `node --test test/*.test.mjs` runs all tests.
- `node --check src/index.js && node --check src/archive-store.js && node --check src/http.js && node --check client/client.js` runs syntax checks.

Source, tests, and documentation use no emoji.
