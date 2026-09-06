import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

test('package.json declares the session manager bundle contract', async () => {
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

  assert.equal(packageJson.name, 'dsh-session-manager')
  assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(packageJson.dsh?.client?.platform, 'web')
  assert.ok(packageJson.exports?.['./client'])
})

test('client loader uses required DSH wrapper and seat names without emoji', async () => {
  const client = await readFile(resolve(root, 'client/client.js'), 'utf8')

  assert.match(client, /window\.__ModuleLoader__\.load/)
  assert.match(client, /sidebar\.footer\.action/)
  assert.match(client, /shell\.overlay/)
  assert.doesNotMatch(client, /[\u{1F000}-\u{1FAFF}]/u)
})
