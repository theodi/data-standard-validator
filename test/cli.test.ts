/*
 * The built command, run the way a user runs it.
 */

import { beforeAll, describe, expect, test } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, fixtureText } from './helpers.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'dist', 'cli.js')

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' })
})

function runCli (args: string[], input?: string): { status: number | null, stdout: string, stderr: string } {
  const result = spawnSync('node', [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    ...(input !== undefined ? { input } : {}),
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const shapes = ['-s', fixture('person-shape.ttl')]

describe('data-standard-validator', () => {
  test('exits 0 when everything conforms', () => {
    const run = runCli([...shapes, fixture('valid.jsonld')])
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('All good - 1 document(s) conform.')
  })

  test('exits 1 with a readable report when there are problems', () => {
    const run = runCli([...shapes, fixture('invalid.jsonld')])
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('Missing required field name')
  })

  test.each(['text', 'json', 'markdown'])('--format %s', (format) => {
    const run = runCli([...shapes, '-f', format, fixture('invalid.jsonld')])
    expect(run.status).toBe(1)
    if (format === 'json') expect(JSON.parse(run.stdout).conforms).toBe(false)
    if (format === 'markdown') expect(run.stdout).toMatch(/^# person-shape\.ttl/)
  })

  test('--context replaces the documents\' own', () => {
    const run = runCli([...shapes, '-c', fixture('context.jsonld'), fixture('no-context.json')])
    expect(run.status).toBe(0)
  })

  test('-s can be repeated, and does not swallow the document', () => {
    const run = runCli([...shapes, '-s', fixture('rules-shape.ttl'), fixture('nickname.jsonld')])
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('nickname')
  })

  test('reads stdin, resolving nothing relative to it', () => {
    const run = runCli([...shapes, '-c', fixture('context.jsonld')], fixtureText('no-context.json'))
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('(stdin) -> passes')
  })

  test('exits 2 on bad usage', () => {
    expect(runCli([fixture('valid.jsonld')]).status).toBe(2)
    expect(runCli([...shapes, '-f', 'yaml', fixture('valid.jsonld')]).status).toBe(2)
  })

  test('exits 3 when a source cannot be loaded', () => {
    const run = runCli(['-s', fixture('missing.ttl'), fixture('valid.jsonld')])
    expect(run.status).toBe(3)
    expect(run.stderr).toContain('not found')
    expect(runCli([...shapes, fixture('missing.json')]).status).toBe(3)
  })

  test('--help and --version exit 0', () => {
    expect(runCli(['--help']).stdout).toContain('Exit codes:')
    expect(runCli(['--version']).status).toBe(0)
  })
})
