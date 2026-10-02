/*
 * Loading JSON-LD contexts, and the inverted index that names things.
 *
 * A context can arrive as a URL, a file or an object, and can itself point at
 * further contexts by URL. Everything is inlined up front - so the index that
 * turns IRIs back into field names sees the whole thing - and cached, so a
 * batch of documents naming the same context downloads it once.
 */

import { ContextIndex } from '../document/context-index.js'
import { unwrapContext, type DocumentLoader, type JsonLdContext } from '../document/jsonld.js'
import { SourceError } from './fetch.js'
import { readSource, resolveRelative, type Environment, type Source } from './sources.js'

/** Deep enough for any real chain of imports, shallow enough to stop a loop. */
const MAX_DEPTH = 10

export interface LoadedContext {
  context: JsonLdContext
  index: ContextIndex
  /** Where it came from, for the report. */
  source: string
}

export class ContextLoader {
  private readonly cache = new Map<string, Promise<unknown>>()
  private readonly indexes = new WeakMap<object, ContextIndex>()

  constructor (private readonly env: Environment) {}

  /** Load a context source - URL, path, `{ text }` or `{ json }` - completely inlined. */
  async load (source: Source): Promise<LoadedContext> {
    const read = await readSource(source, this.env, 'context')
    const raw = read.json !== undefined ? read.json : parseJson(read.text ?? '', read.name)
    const context = await this.inline(unwrapContext(raw), read.location)
    return { context, index: this.indexFor(context), source: read.name }
  }

  /** Replace every URL reference in `context` with what it points at. */
  async inline (context: unknown, base: string | undefined, depth = 0): Promise<JsonLdContext> {
    if (depth > MAX_DEPTH) throw new SourceError('contexts nest too deeply - is there a loop?', base ?? '')

    if (typeof context === 'string') {
      const url = resolveRelative(context, base)
      return this.inline(await this.fetchContext(url), url, depth + 1)
    }
    if (Array.isArray(context)) {
      const parts = await Promise.all(context.map((part) => this.inline(part, base, depth + 1)))
      return parts.flatMap((part) => (Array.isArray(part) ? part : [part]))
    }
    if (context !== null && typeof context === 'object') return context as JsonLdContext
    throw new SourceError('a JSON-LD context must be an object, an array or a URL', base ?? '')
  }

  indexFor (context: JsonLdContext): ContextIndex {
    let index = this.indexes.get(context)
    if (!index) {
      index = new ContextIndex(context)
      this.indexes.set(context, index)
    }
    return index
  }

  /** For jsonld.js: scoped contexts can still name a URL after inlining. */
  readonly documentLoader: DocumentLoader = async (url) => ({
    contextUrl: null,
    documentUrl: url,
    document: { '@context': await this.fetchContext(url) },
  })

  private fetchContext (location: string): Promise<unknown> {
    let pending = this.cache.get(location)
    if (!pending) {
      pending = readSource(location, this.env)
        .then((read) => unwrapContext(read.json !== undefined ? read.json : parseJson(read.text ?? '', read.name)))
      this.cache.set(location, pending)
    }
    return pending
  }
}

function parseJson (text: string, name: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new SourceError(`${name} is not valid JSON: ${(error as Error).message}`, name)
  }
}
