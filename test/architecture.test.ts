/*
 * The folder structure, enforced.
 *
 * A layout only stays useful if it stays true, and nothing rots faster than a
 * diagram in a README. These are the two properties the structure claims:
 * imports form a DAG, and they run in one direction through the folders.
 */

import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** Lower may not import higher; `format` and `load` are siblings. Root modules sit above them all. */
const LAYERS = ['rdf', 'document', 'report', 'format', 'load']

const files = globSync('**/*.ts', { cwd: src })
  .filter((f) => !f.endsWith('.d.ts'))
  .map((f) => f.split('\\').join('/'))

function importsOf (file: string): string[] {
  const text = readFileSync(join(src, file), 'utf8')
  const dir = dirname(file)
  return [...text.matchAll(/from '(\.[^']*)\.js'/g)].map((m) =>
    `${normalize(join(dir, m[1]!)).split('\\').join('/')}.ts`)
}

const graph = new Map(files.map((f) => [f, importsOf(f)]))
const layerOf = (file: string): number => LAYERS.indexOf(file.split('/')[0] ?? '')

describe('module structure', () => {
  test('every relative import resolves to a file that exists', () => {
    for (const [file, targets] of graph) {
      for (const target of targets) {
        expect(files, `${file} imports ${target}`).toContain(target)
      }
    }
  })

  test('folders are layered: rdf <- document <- report <- format, load', () => {
    const upward: string[] = []
    for (const [file, targets] of graph) {
      const from = layerOf(file)
      if (from === -1) continue // a root module may reach anywhere
      for (const target of targets) {
        const to = layerOf(target)
        if (to === -1) continue
        if (to > from) upward.push(`${file} -> ${target}`)
      }
    }
    expect(upward).toEqual([])
  })

  test('there are no import cycles', () => {
    const state = new Map<string, 'visiting' | 'done'>()
    const cycles: string[] = []

    const walk = (file: string, stack: string[]): void => {
      if (state.get(file) === 'done') return
      if (state.get(file) === 'visiting') {
        cycles.push([...stack.slice(stack.indexOf(file)), file].join(' -> '))
        return
      }
      state.set(file, 'visiting')
      for (const target of graph.get(file) ?? []) walk(target, [...stack, file])
      state.set(file, 'done')
    }

    for (const file of files) walk(file, [])
    expect(cycles).toEqual([])
  })

  test('only the Node entry points reach for Node built-ins', () => {
    const nodeOnly = new Set(['cli.ts', 'node.ts'])
    const offenders = files.filter((f) =>
      !nodeOnly.has(f) && /from 'node:/.test(readFileSync(join(src, f), 'utf8')))
    expect(offenders, 'everything else has to run in a browser').toEqual([])
  })
})
