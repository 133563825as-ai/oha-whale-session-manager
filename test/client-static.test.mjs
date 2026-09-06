import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const createdFiles = [
  'package.json',
  'cordis.patch.yml',
  'src/index.js',
  'client/client.js',
  'README.md',
  'test/client-static.test.mjs'
]
const emojiPattern = /[\u{1F000}-\u{1FAFF}]/u

async function read(relativePath) {
  return readFile(resolve(root, relativePath), 'utf8')
}

test('package.json declares the complete bundle contract', async () => {
  const packageJson = JSON.parse(await read('package.json'))

  assert.equal(packageJson.name, 'dsh-session-manager')
  assert.equal(packageJson.version, '0.1.0')
  assert.equal(packageJson.type, 'module')
  assert.equal(packageJson.main, 'src/index.js')
  assert.deepEqual(packageJson.exports, {
    '.': './src/index.js',
    './client': './client/client.js',
    './package.json': './package.json'
  })
  assert.deepEqual(packageJson.files, ['src', 'client', 'cordis.patch.yml', 'README.md'])
  assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(packageJson.dsh?.client?.platform, 'web')
  assert.deepEqual(packageJson.dsh?.client?.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-layout'
  ])
})

test('patch declares the session manager id and name', async () => {
  const patch = await read('cordis.patch.yml')

  assert.match(patch, /id:\s*dsh-session-manager/)
  assert.match(patch, /name:\s*dsh-session-manager/)
})

test('host entry exports the required plugin contract', async () => {
  const host = await import(resolve(root, 'src/index.js'))

  assert.equal(host.name, 'dsh-session-manager')
  assert.deepEqual(host.inject, ['webServer', 'sessionPersistence', 'workspaceRegistry', 'sessions'])
  assert.equal(typeof host.apply, 'function')
})

test('client loader returns real inject and apply exports', async () => {
  const client = await read('client/client.js')
  let loaded
  vm.runInNewContext(client, {
    window: {
      __ModuleLoader__: {
        load(module) {
          loaded = module.factory((name) => {
            if (name === 'react') return { createElement: () => ({}) }
            return {}
          })
        }
      }
    }
  })

  assert.deepEqual(Array.from(loaded.inject), ['slots', 'locale'])
  assert.equal(typeof loaded.apply, 'function')
})

test('client declares modal behavior and archive routes', async () => {
  const source = await read('client/client.js')
  const requires = (text) => assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  for (const text of [
    'sidebar.footer.action', 'shell.overlay', 'dsh-session-manager',
    '/session-manager/archives', '/session-manager/trash',
    'sm-backdrop'
  ]) requires(text)
  assert.match(source, /aria-modal(?:['"]\s*:\s*['"]true['"]|=["']true["'])/)
  assert.match(source, /80vh/)
  assert.match(source, /92vw/)
})

test('client contains archive and trash actions', async () => {
  const source = await read('client/client.js')
  for (const text of ['归档', '回收站', '选择', '全选', '删除所选', '恢复', '清空回收站']) {
    assert.match(source, new RegExp(text))
  }
  assert.match(source, /confirm|window\.confirm/)
  assert.match(source, /useSessions/)
})

test('client accepts DSH locale t as a translation function', async () => {
  const source = await read('client/client.js')
  assert.match(source, /function makeT/)
  assert.match(source, /typeof propsT === 'function'/)
  assert.match(source, /new Proxy\(tr/)
})

test('created Task 1 files contain no Unicode emoji', async () => {
  for (const relativePath of createdFiles) {
    assert.doesNotMatch(await read(relativePath), emojiPattern, relativePath)
  }
})
