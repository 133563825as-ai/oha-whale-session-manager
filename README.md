# dsh-session-manager

`dsh-session-manager` is an installable DeepSeek Harness bundle scaffold for session management.

The current scope is limited to the bundle manifest, Cordis patch, host entry, and Web client loader. Archive operations, HTTP routes, and UI registration are planned for later tasks and are not implemented here.

## Local commands

- `node --test test/client-static.test.mjs` runs the static contract tests.
- `npm test` runs all tests.
- `npm run check` runs host and client syntax checks. Future production files referenced by this check are created in later tasks.

Source, tests, and documentation use no emoji.
