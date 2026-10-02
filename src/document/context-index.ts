/*
 * Reading a JSON-LD context backwards.
 *
 * The validator's whole reason for existing is to say "address[0].postcode is
 * not in the expected format" instead of quoting https://example.org/postcode
 * at somebody. SHACL reports talk in IRIs; the context is the only artifact
 * that knows what the modellers call those IRIs in JSON. So we load it and
 * invert it.
 *
 * Two features of real-world contexts make this worth doing properly:
 *
 *   - **type-scoped contexts** - `Name` and `Address` each declare their own
 *     `use` term, so the same IRI can legitimately have different names
 *     depending on which object it appears in.
 *   - **`"@type": "@vocab"` term maps** - an enum's permitted values are
 *     written out as token -> IRI pairs (`official` -> `nuc:Official`).
 *     Inverting those turns an `sh:in` list of five opaque IRIs into
 *     "must be one of: usual, official, temp, nickname, anonymous".
 */

export type RawContext = Record<string, unknown> | unknown[]

export interface TermDef {
  /** Expanded IRI this term maps to. */
  id: string
  /** `@type` of the term, expanded where it is an IRI (`@vocab` / `@id` kept as-is). */
  type?: string
  /** `@container` values, normalised to an array. */
  container: string[]
  /** For `"@type": "@vocab"` terms: value IRI -> the token a user would write. */
  vocab?: Map<string, string>
}

const KEYWORDS = new Set([
  '@context', '@id', '@type', '@value', '@language', '@container', '@list', '@set',
  '@reverse', '@index', '@base', '@vocab', '@graph', '@nest', '@prefix', '@protected',
  '@propagate', '@direction', '@included', '@json', '@none', '@version',
])

function isPlainObject (v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Merge `@context` entries; later definitions win, as JSON-LD specifies. */
function flatten (ctx: RawContext): Record<string, unknown> {
  if (Array.isArray(ctx)) {
    return ctx.reduce<Record<string, unknown>>((acc, part) => {
      if (isPlainObject(part)) Object.assign(acc, flatten(part))
      return acc
    }, {})
  }
  return isPlainObject(ctx) ? { ...ctx } : {}
}

export class ContextIndex {
  /** Prefix -> namespace, for expanding compact IRIs like `p:Name`. */
  private readonly prefixes = new Map<string, string>()
  /** Top-level term name -> definition. */
  private readonly terms = new Map<string, TermDef>()
  /** Class IRI -> (term name -> definition) declared inside that type's scope. */
  private readonly scoped = new Map<string, Map<string, TermDef>>()
  /** Property IRI -> term name, outside any type scope. */
  private readonly inverse = new Map<string, string>()
  /** Class IRI -> (property IRI -> term name). */
  private readonly scopedInverse = new Map<string, Map<string, string>>()
  /** Default `@vocab`, if the context sets one. */
  private readonly vocab: string | undefined

  constructor (raw: RawContext) {
    const flat = flatten(raw)
    const vocab = flat['@vocab']
    this.vocab = typeof vocab === 'string' ? vocab : undefined

    // Pass 1: string-valued entries are both terms and candidate prefixes.
    // `p: "https://example.org/"` is what makes `p:Name`
    // expandable, and the namespaces have to be known before anything that
    // uses them is expanded.
    for (const [key, value] of Object.entries(flat)) {
      if (KEYWORDS.has(key)) continue
      if (typeof value === 'string') this.prefixes.set(key, value)
    }

    // Pass 2: real definitions.
    for (const [key, value] of Object.entries(flat)) {
      if (KEYWORDS.has(key)) continue
      const def = this.readTerm(key, value)
      if (!def) continue
      this.terms.set(key, def)
      if (!this.inverse.has(def.id)) this.inverse.set(def.id, key)

      // A term carrying its own `@context` is a type scope: `Name`, `Address`.
      const scopedCtx = isPlainObject(value) ? value['@context'] : undefined
      if (scopedCtx !== undefined) {
        const inner = new Map<string, TermDef>()
        const innerInverse = new Map<string, string>()
        for (const [k, v] of Object.entries(flatten(scopedCtx as RawContext))) {
          if (KEYWORDS.has(k)) continue
          const d = this.readTerm(k, v)
          if (!d) continue
          inner.set(k, d)
          if (!innerInverse.has(d.id)) innerInverse.set(d.id, k)
        }
        this.scoped.set(def.id, inner)
        this.scopedInverse.set(def.id, innerInverse)
      }
    }
  }

  private readTerm (name: string, value: unknown): TermDef | null {
    if (typeof value === 'string') return { id: this.expand(value), container: [] }
    if (!isPlainObject(value)) return null

    const rawId = value['@id']
    const id = typeof rawId === 'string' ? this.expand(rawId) : this.expand(name)

    const rawType = value['@type']
    const type = typeof rawType === 'string'
      ? (rawType.startsWith('@') ? rawType : this.expand(rawType))
      : undefined

    const rawContainer = value['@container']
    const container = Array.isArray(rawContainer)
      ? rawContainer.filter((c): c is string => typeof c === 'string')
      : typeof rawContainer === 'string' ? [rawContainer] : []

    const def: TermDef = { id, container }
    if (type !== undefined) def.type = type

    // `"@type": "@vocab"` plus a nested `@context` is how these files spell out
    // an enumeration. Invert it so a value IRI can be shown as its token.
    if (type === '@vocab') {
      const nested = value['@context']
      if (nested !== undefined) {
        const vocabMap = new Map<string, string>()
        const flatNested = flatten(nested as RawContext)
        const localVocab = typeof flatNested['@vocab'] === 'string'
          ? flatNested['@vocab'] as string
          : undefined
        for (const [token, target] of Object.entries(flatNested)) {
          if (KEYWORDS.has(token)) continue
          const targetIri = typeof target === 'string'
            ? this.expand(target, localVocab)
            : isPlainObject(target) && typeof target['@id'] === 'string'
              ? this.expand(target['@id'] as string, localVocab)
              : undefined
          if (targetIri && !vocabMap.has(targetIri)) vocabMap.set(targetIri, token)
        }
        if (vocabMap.size > 0) def.vocab = vocabMap
      }
    }
    return def
  }

  /** Expand a term or compact IRI against the known prefixes. */
  expand (value: string, localVocab?: string): string {
    if (value.startsWith('@')) return value
    const colon = value.indexOf(':')
    if (colon > 0) {
      const prefix = value.slice(0, colon)
      const suffix = value.slice(colon + 1)
      if (suffix.startsWith('//')) return value // already absolute
      const ns = this.prefixes.get(prefix)
      if (ns !== undefined) return ns + suffix
      return value
    }
    const term = this.terms.get(value)
    if (term) return term.id
    const base = localVocab ?? this.vocab
    return base !== undefined ? base + value : value
  }

  /** Definition for a term, preferring the scope of the enclosing `@type`. */
  termDef (name: string, typeIri?: string): TermDef | undefined {
    if (typeIri !== undefined) {
      const inner = this.scoped.get(typeIri)?.get(name)
      if (inner) return inner
    }
    return this.terms.get(name)
  }

  /**
   * Property IRI -> the name a user would write for it. Checks the enclosing
   * type's scope first, because `use` inside `Name` and `use` inside `Address`
   * are separate declarations even when they resolve to the same IRI.
   */
  termFor (iri: string, typeIri?: string): string | undefined {
    if (typeIri !== undefined) {
      const inner = this.scopedInverse.get(typeIri)?.get(iri)
      if (inner !== undefined) return inner
    }
    return this.inverse.get(iri)
  }

  /** Value IRI -> token, for a `"@type": "@vocab"` property. */
  tokenFor (valueIri: string, propertyIri: string, typeIri?: string): string | undefined {
    for (const scope of [typeIri !== undefined ? this.scoped.get(typeIri) : undefined, this.terms]) {
      if (!scope) continue
      for (const def of scope.values()) {
        if (def.id === propertyIri && def.vocab?.has(valueIri)) return def.vocab.get(valueIri)
      }
    }
    // Fall back to any term map that knows this value - enum IRIs are unique
    // across a module, so a scope miss should not cost us the friendly name.
    for (const scope of [...this.scoped.values(), this.terms]) {
      for (const def of scope.values()) {
        const token = def.vocab?.get(valueIri)
        if (token !== undefined) return token
      }
    }
    return undefined
  }

  /** Every token permitted for a property, in declaration order. */
  tokensFor (propertyIri: string, typeIri?: string): Map<string, string> | undefined {
    if (typeIri !== undefined) {
      for (const def of this.scoped.get(typeIri)?.values() ?? []) {
        if (def.id === propertyIri && def.vocab) return def.vocab
      }
    }
    for (const def of this.terms.values()) {
      if (def.id === propertyIri && def.vocab) return def.vocab
    }
    for (const scope of this.scoped.values()) {
      for (const def of scope.values()) {
        if (def.id === propertyIri && def.vocab) return def.vocab
      }
    }
    return undefined
  }

  /** Shorten an IRI to `prefix:local` when a prefix covers it. */
  compact (iri: string): string {
    let best: [string, string] | undefined
    for (const [prefix, ns] of this.prefixes) {
      if (ns.length > 0 && iri.startsWith(ns) && iri.length > ns.length) {
        if (!best || ns.length > best[1].length) best = [prefix, ns]
      }
    }
    return best ? `${best[0]}:${iri.slice(best[1].length)}` : iri
  }
}
