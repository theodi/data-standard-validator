/*
 * Where an input comes from - a URL, a file, or the caller's own memory -
 * reduced to its text.
 *
 * The core never touches the filesystem: a path is read through the
 * `readFile` the caller supplies, which the Node entry point fills in. That is
 * what lets one build serve Node and the browser.
 */

import { fetchText, NotFoundError, SourceError, type Fetch } from './fetch.js'

/** The syntax a document is written in. */
export type InputFormat = 'json' | 'csv'

/**
 * Anything the validator can read: shapes, a context or a document.
 *
 * A plain string is a URL when it has a scheme (`https://...`), and a file
 * path otherwise. A document's `format` is worked out from its name when it
 * is not given: `.csv` is CSV, anything else JSON.
 */
export type Source =
  | string
  | { url: string, optional?: boolean, label?: string, format?: InputFormat }
  | { path: string, optional?: boolean, label?: string, format?: InputFormat }
  | { text: string, name?: string, base?: string, format?: InputFormat }
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
  /** The format the caller said the source is in, if they did. */
  format?: InputFormat
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

/** The file extensions each format is recognised by, lower case. */
export const FORMAT_EXTENSIONS: Readonly<Record<InputFormat, readonly string[]>> = {
  json: ['json', 'jsonld'],
  csv: ['csv'],
}

/** The format a name, path or URL announces by its extension, if any. */
export function formatFromName (name: string): InputFormat | undefined {
  const path = isUrl(name) ? new URL(name).pathname : name.replace(/[?#].*$/, '')
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase()
  if (extension === undefined) return undefined
  for (const [format, extensions] of Object.entries(FORMAT_EXTENSIONS) as [InputFormat, readonly string[]][]) {
    if (extensions.includes(extension)) return format
  }
  return undefined
}

/**
 * The format a document is in: as stated, or else by its file extension.
 * Already-parsed `{ json }` is JSON whatever it is called, and anything
 * unrecognised is read as JSON, which is how inline `{ text }` without a name
 * has always been read.
 */
export function formatOf (read: ReadResult): InputFormat {
  if (read.json !== undefined) return 'json'
  return read.format ?? formatFromName(read.location ?? read.name) ?? 'json'
}

export async function readSource (source: Source, env: Environment, fallbackName?: string): Promise<ReadResult> {
  const s = normalise(source)
  const format = 'format' in s && s.format !== undefined ? { format: s.format } : {}

  if ('url' in s) {
    return { name: s.url, location: s.url, text: await fetchText(s.url, env.fetch), ...format }
  }

  if ('path' in s) {
    if (env.readFile === undefined) {
      throw new SourceError(
        `cannot read ${s.path}: file paths need Node, or a readFile option - pass a URL or { text } instead`,
        s.path,
      )
    }
    try {
      return { name: s.path, location: s.path, text: await env.readFile(s.path), ...format }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') throw new NotFoundError(s.path)
      throw new SourceError(`cannot read ${s.path}: ${(error as Error).message}`, s.path)
    }
  }

  // `base` lets inline content keep relative references working, e.g. a file
  // read by the caller that names `./context.jsonld`.
  const name = s.name ?? fallbackName ?? 'document'
  const location = s.base !== undefined ? { location: s.base } : {}
  return 'text' in s ? { name, ...location, text: s.text, ...format } : { name, ...location, json: s.json }
}
