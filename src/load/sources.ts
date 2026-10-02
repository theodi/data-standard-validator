/*
 * Where an input comes from - a URL, a file, or the caller's own memory -
 * reduced to its text.
 *
 * The core never touches the filesystem: a path is read through the
 * `readFile` the caller supplies, which the Node entry point fills in. That is
 * what lets one build serve Node and the browser.
 */

import { fetchText, NotFoundError, SourceError, type Fetch } from './fetch.js'

/**
 * Anything the validator can read: shapes, a context or a document.
 *
 * A plain string is a URL when it has a scheme (`https://...`), and a file
 * path otherwise.
 */
export type Source =
  | string
  | { url: string, optional?: boolean, label?: string }
  | { path: string, optional?: boolean, label?: string }
  | { text: string, name?: string, base?: string }
  | { json: unknown, name?: string, base?: string }

export type ReadFile = (path: string) => Promise<string>

/** How sources are reached. Both are optional; a missing one fails loudly. */
export interface Environment {
  fetch?: Fetch
  readFile?: ReadFile
}

export interface ReadResult {
  /** What to call the source in a report: the URL, the path, or a given name. */
  name: string
  /** URL or path that relative references inside the source resolve against. */
  location?: string
  text?: string
  json?: unknown
}

export function isUrl (value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}

/** Resolve a reference such as `./context.jsonld` against where it was found. */
export function resolveRelative (ref: string, base: string | undefined): string {
  if (isUrl(ref) || base === undefined) return ref
  if (isUrl(base)) return new URL(ref, base).href
  if (ref.startsWith('/')) return ref
  return `${base.slice(0, base.lastIndexOf('/') + 1)}${ref}`
}

type Normalised = Exclude<Source, string>

function normalise (source: Source): Normalised {
  if (typeof source !== 'string') return source
  return isUrl(source) ? { url: source } : { path: source }
}

/** True for sources whose absence is a warning rather than an error. */
export function isOptional (source: Source): boolean {
  const s = normalise(source)
  return ('url' in s || 'path' in s) && s.optional === true
}

/** The caller's description of an optional source, for warnings. */
export function labelOf (source: Source): string | undefined {
  const s = normalise(source)
  return 'url' in s || 'path' in s ? s.label : undefined
}

export function nameOf (source: Source, fallback = 'document'): string {
  const s = normalise(source)
  if ('url' in s) return s.url
  if ('path' in s) return s.path
  return s.name ?? fallback
}

export async function readSource (source: Source, env: Environment, fallbackName?: string): Promise<ReadResult> {
  const s = normalise(source)

  if ('url' in s) {
    return { name: s.url, location: s.url, text: await fetchText(s.url, env.fetch) }
  }

  if ('path' in s) {
    if (env.readFile === undefined) {
      throw new SourceError(
        `cannot read ${s.path}: file paths need Node, or a readFile option - pass a URL or { text } instead`,
        s.path,
      )
    }
    try {
      return { name: s.path, location: s.path, text: await env.readFile(s.path) }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') throw new NotFoundError(s.path)
      throw new SourceError(`cannot read ${s.path}: ${(error as Error).message}`, s.path)
    }
  }

  // `base` lets inline content keep relative references working, e.g. a file
  // read by the caller that names `./context.jsonld`.
  const name = s.name ?? fallbackName ?? 'document'
  const location = s.base !== undefined ? { location: s.base } : {}
  return 'text' in s ? { name, ...location, text: s.text } : { name, ...location, json: s.json }
}
