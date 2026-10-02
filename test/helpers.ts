import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

export const fixture = (name: string): string => join(fixtures, name)

export const fixtureText = (name: string): string => readFileSync(fixture(name), 'utf8')

/** A fetch that serves fixtures from https://example.test/, and 404s otherwise. */
export function fixtureFetch (calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const prefix = 'https://example.test/'
    if (!url.startsWith(prefix)) return new Response('not found', { status: 404 })
    try {
      return new Response(fixtureText(url.slice(prefix.length)))
    } catch {
      return new Response('not found', { status: 404 })
    }
  }) as typeof fetch
}
