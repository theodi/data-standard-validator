# How it works

```text
read -> parse JSON -> choose @context -> skolemize -> JSON-LD to RDF -> SHACL -> humanise
```

The middle of that pipeline is standard JSON-LD processing and a standard SHACL
engine ([rdf-validate-shacl](https://github.com/zazuko/rdf-validate-shacl)).
The work of this library is at the two ends.

## The problem

SHACL validates RDF. RDF has no notion of "line 10" or of `address[0].postcode`.
It has triples and nodes, and most nodes in a converted JSON-LD document are
*blank nodes* with machine-generated labels. A conformant engine will
faithfully report:

```text
Violation  path=https://example.org/postcode  focus=_:b3
           "Value does not match pattern ^[A-Z]{2}[0-9]$"
```

Everything about that is correct, and nobody can act on it.

## Skolemization: putting results back where they came from

`jsonld.toRDF` mints its own blank-node labels, and those correspond to nothing
the user wrote. So nothing is allowed to stay anonymous. Before conversion, the
document is walked and every node object without an `@id` is given one, such
as `urn:dsv:node:7`. The walk records where each node was found: the JSON
pointer, the dotted path, the enclosing `@type`, the nearest ancestor `@id`,
and the line and column. Afterwards, every focus node in the SHACL report is
either an `@id` the user wrote or an identifier that decodes straight back to
`address[0]`.

**This is safe because it adds no triples.** `@id` is a node's identity, not a
property. Cardinality constraints, `sh:closed` and `sh:ignoredProperties` are
all unaffected. The one thing it would break is a shape requiring
`sh:nodeKind sh:BlankNode`. The loader checks for that every time and turns the
mechanism off when one appears. The tests also validate documents both ways and
assert that the verdicts are identical.

The synthetic identifiers are internal. The tests also assert that
`urn:dsv:node:` never appears in any output format.

## Reading the context backwards

Field names come from inverting the JSON-LD context. Two features of real
contexts make this worth doing carefully:

- **Type-scoped contexts.** `Name` and `Address` can each declare their own
  `use` term, so the same IRI has different names depending on the object it
  is in. The index keeps the scopes apart and prefers the one matching the
  enclosing `@type`.
- **`"@type": "@vocab"` term maps.** Enumerations written as token-to-IRI pairs
  are inverted. An `sh:in` list of five opaque IRIs then becomes "must be one
  of: usual, official, temp", which are the tokens a user would actually type.

For a missing field there is no key in the document to read. That is exactly
when the inverted context earns its place.

## Saying what is wrong

SHACL engines produce generic default messages ("Less than 1 values"). Parsing
those would be fragile and would still say nothing useful. Instead, the
reporter goes back to the shape that raised each result. It reads
`sh:description`, `sh:minCount`, `sh:pattern`, `sh:in` and the other
parameters, and builds a sentence from them. If a shape's description says
*"Postcode in standard format (e.g. AB1 2CD)"*, the hint's example is lifted
straight out of it. A shape with its own `sh:message` was written for people,
so that message is used verbatim.

One mistake often trips several constraints at once. For example, a value
outside a vocabulary fails both `sh:in` and `sh:class`. Only the more specific
complaint is kept.

## Choosing a context

A context supplied to the validator always wins. This is what lets one set of
shapes check documents whose own `@context` points somewhere else, or nowhere.
Without one, the document's own context is loaded. URLs and relative paths are
inlined up front, so the naming index sees the whole context. They are cached,
so a batch naming the same context downloads it once.

## One build per platform, one API

The core never touches the filesystem. Paths are read through an injected
`readFile`, and URLs through an injected `fetch`. The package's `exports` give
Node a build that supplies `readFile`, and give bundlers and browsers a build
without it. Only `src/node.ts` and `src/cli.ts` may import `node:` modules. A
test enforces this, along with the folder layering:

```text
rdf  <-  document  <-  report  <-  format
                           ^
                           +-----  load
```
