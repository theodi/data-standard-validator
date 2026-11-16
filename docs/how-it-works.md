# How it works

Every document, whatever its format, goes through the same stages. Only the
means differ:

| Stage | JSON / JSON-LD | CSV |
| --- | --- | --- |
| parse | `JSON.parse` | an RFC 4180 parser that keeps each cell's line and column |
| needs | a `@context` (the supplied one, else the document's own) | CSVW metadata |
| name nodes | skolemize: `urn:dsv:node:N` on every anonymous node | a row with no `aboutUrl` is `#row-{_row}` |
| to RDF | JSON-LD to RDF | CSVW to RDF, recording the cell behind each triple |
| issues found on the way | which context was used | columns missing or unexpected, unreadable cells |

```text
read -> parse -> needs -> name nodes -> to RDF -> SHACL -> humanise
        '------ one handler per format ------'    '---- shared ----'
```

A document that fails a stage before conversion is not checked at all. It
fails with an issue saying why (`parse-error` at the place the syntax broke,
`no-context`, `no-csv-metadata`) rather than passing unchecked.

The format-specific part of the pipeline uses standard JSON-LD processing for
JSON. Everything from the RDF dataset on is a standard SHACL engine
([rdf-validate-shacl](https://github.com/zazuko/rdf-validate-shacl)) plus one
reporter for every format. The work of this library is at the two ends.

## The problem

SHACL validates RDF. RDF has no notion of "line 10", of `address[0].postcode`
or of "row 3, column `postcode`". It has triples and nodes, and most nodes in
a converted document are *blank nodes* with machine-generated labels: every
JSON object without an `@id`, and, in CSVW, every row without an `aboutUrl`. A
conformant engine will faithfully report:

```text
Violation  path=https://example.org/postcode  focus=_:b3
           "Value does not match pattern ^[A-Z]{2}[0-9]$"
```

Everything about that is correct, and nobody can act on it.

## Skolemization: putting results back where they came from

Nothing is allowed to stay anonymous, in any format.

**JSON.** `jsonld.toRDF` mints its own blank-node labels, and those correspond to nothing
the user wrote. So before conversion, the document is walked and every node object without an `@id` is given one, such
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

**CSV.** CSVW leaves a row with no `aboutUrl` as a blank node. The validator
names it `#row-{_row}` of the file instead, against a placeholder base that is
never shown when the file has no URL. When skolemization is off, the row stays
a blank node, as CSVW specifies, and is still located, because the conversion
created it.

## What each format needs

Each format needs one thing to turn a document into RDF, and the same thing
tells the report what the document calls each IRI.

**JSON needs a JSON-LD context.** A context supplied to the validator always
wins. This is what lets one set of shapes check documents whose own `@context`
points somewhere else, or nowhere. Without one, the document's own context is
loaded. URLs and relative paths are inlined up front, so the naming index sees
the whole context. They are cached, so a batch naming the same context
downloads it once. The context is then read backwards: IRI to key, and, for a
controlled vocabulary, IRI to token.

**CSV needs CSVW metadata.** It is loaded once per validator and read the same
way backwards: a property's term is the title of its column, and a concept's
token is its `skos:prefLabel`.

A document without what its format needs fails, rather than passing with
nothing checked.

## Locating results

Each format records, while converting, where everything it produced came from.

**JSON** uses the skolemization index: a focus node is found by its identity,
and a property one level below it by the key the context names it with, which
the parse tree places at a line and column.

**CSV** does not pass through JSON-LD. The CSVW metadata turns each row
straight into RDF, and the conversion records which cell each triple came
from. A result about a node and a property is located at that cell: row,
column title, and line and column in the text.

From here on, everything is shared by every format.

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
