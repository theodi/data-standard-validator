/*
 * Minimal ambient declarations for the RDF toolchain.
 *
 * None of n3, jsonld, rdf-ext or rdf-validate-shacl ship TypeScript types, and
 * @types packages for them either do not exist or are not reusable. Rather than turn
 * strict mode off for the whole project, we declare exactly the surface this
 * validator touches. If a call site needs something new, add it here first -
 * that keeps the "what do we actually depend on" list short and visible.
 */

declare module 'n3' {
  export interface Quad {
    subject: Term
    predicate: Term
    object: Term
    graph: Term
  }
  export interface Term {
    termType: 'NamedNode' | 'BlankNode' | 'Literal' | 'DefaultGraph' | 'Variable' | 'Quad'
    value: string
    datatype?: Term
    language?: string
    equals(other: Term | null | undefined): boolean
  }
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
  import type { Quad, Term } from 'n3'
  export interface Dataset extends Iterable<Quad> {
    readonly size: number
    add(quad: Quad): Dataset
    addAll(quads: Iterable<Quad>): Dataset
    match(subject?: Term | null, predicate?: Term | null, object?: Term | null, graph?: Term | null): Dataset
  }
  export interface RdfEnvironment {
    dataset(quads?: Iterable<Quad>): Dataset
    namedNode(value: string): Term
    literal(value: string, languageOrDatatype?: string | Term): Term
    blankNode(value?: string): Term
  }
  const environment: RdfEnvironment
  export default environment
}

declare module 'rdf-validate-shacl' {
  import type { Dataset } from 'rdf-ext'
  import type { Term } from 'n3'
  export interface ValidationResult {
    message: Term[]
    path: Term | null
    focusNode: Term | null
    severity: Term | null
    sourceShape: Term | null
    sourceConstraintComponent: Term | null
    value: Term | null
  }
  export interface ValidationReport {
    conforms: boolean
    results: ValidationResult[]
  }
  export default class SHACLValidator {
    constructor (shapes: Dataset, options?: Record<string, unknown>)
    validate(data: Dataset): ValidationReport
  }
}
