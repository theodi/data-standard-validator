/*
 * Minimal ambient declarations for the RDF toolchain.
 *
 * n3, jsonld and rdf-ext ship no TypeScript types, and their @types packages
 * either trail the versions we use or describe an older API. Rather than turn
 * strict mode off for the whole project, we declare exactly the surface this
 * validator touches, in terms of @rdfjs/types so it meets rdf-validate-shacl's
 * own (bundled) types. If a call site needs something new, add it here first -
 * that keeps the "what do we actually depend on" list short and visible.
 */

declare module 'n3' {
  import type { Quad } from '@rdfjs/types'
  export class Parser {
    constructor (options?: { format?: string, baseIRI?: string })
    parse(input: string): Quad[]
  }
}

declare module 'jsonld' {
  const jsonld: {
    toRDF(doc: unknown, options?: Record<string, unknown>): Promise<string>
    expand(doc: unknown, options?: Record<string, unknown>): Promise<unknown[]>
  }
  export default jsonld
}

declare module 'rdf-ext' {
  import type { DatasetCore, NamedNode, Quad, Term } from '@rdfjs/types'
  export interface Dataset extends DatasetCore {
    addAll(quads: Iterable<Quad>): Dataset
    match(subject?: Term | null, predicate?: Term | null, object?: Term | null, graph?: Term | null): Dataset
  }
  export interface RdfEnvironment {
    dataset(quads?: Iterable<Quad>): Dataset
    namedNode(value: string): NamedNode
  }
  const environment: RdfEnvironment
  export default environment
}
