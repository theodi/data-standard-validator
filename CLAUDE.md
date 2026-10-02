# @theodi/data-standard-validator

A generic SHACL validator for JSON and JSON-LD documents. It ships as an npm
package (library + the `dsv` CLI) with a static documentation site in `site/`.

```bash
npm test             # offline: unit, pipeline, format, CLI (builds dist first)
npm run typecheck
npm run build
```

## Folder structure

```
src/                    the published package (compiled to dist/)
  index.ts              browser-safe public API: the only exports consumers see
  node.ts               the same API for Node, plus file paths via node:fs
  cli.ts                the `dsv` command (commander); exit codes 0/1/2/3
  validator.ts          the pipeline: createValidator(), validate(), chooseContext()

  load/                 getting inputs in: a Source becomes text, shapes or a context
    sources.ts          the Source type, URL vs path, relative resolution, readSource()
    fetch.ts            fetchText(), SourceError, NotFoundError
    shapes.ts           loadShapes(): merge Turtle, optional sources, skolemSafe check
    context.ts          ContextLoader: inline remote contexts, cache, jsonld documentLoader

  document/             the user's JSON on its way to RDF, and back again
    skolemize.ts        name anonymous nodes; map them to JSON paths and line/column
    context-index.ts    a JSON-LD context inverted: IRI -> term, enum tokens
    jsonld.ts           apply a context and convert to an RDF dataset

  rdf/                  the RDF layer: depends on nothing else in src/
    parse.ts            Turtle and N-Quads into an rdf-ext dataset
    shacl.ts            the SHACL engine, and requiresBlankNodes()
    cross-checks.ts     the CrossCheck interface and namedNode() helper (no checks ship)

  report/               SHACL results turned into plain English
    types.ts            the report contract (RunReport, Issue, IssueCode, PatternHint)
    shape-facts.ts      read sh:description, sh:minCount, sh:in... off the source shape
    messages.ts         a constraint as a sentence: describeConstraint()
    build.ts            results -> issues: paths, terms, values, dedupe, sorting
    group.ts            groupIssues(), shared by the formatters and web pages

  format/               a RunReport rendered for a reader
    index.ts            formatReport(report, 'text' | 'json' | 'markdown')
    text.ts             terminal output with code frames and colour
    markdown.ts         GitHub summaries and PR comments
    json.ts             the report verbatim
    options.ts          FormatOptions, shapesLabel()

  types/vendor.d.ts     ambient types for the untyped RDF stack (not shipped)

test/                   vitest; all offline
  fixtures/             a small shape, a rules shape, a context, valid and invalid docs
  helpers.ts            fixture paths and a stub fetch serving https://example.test/
  unit/                 context index, messages, skolemize in isolation
  validator.test.ts     the pipeline end to end: contexts, sources, cross-checks, skolemization
  sources.test.ts       URL/path handling and load errors
  format.test.ts        text, json and markdown output
  cli.test.ts           builds dist/, then runs `node dist/cli.js` as a user would
  architecture.test.ts  layering, no cycles, the node: rule

docs/                   reference docs, linked from README and the site
  cli.md, api.md, report-format.md, error-reference.md, how-it-works.md
site/                   the GitHub Pages site: hand-written HTML and CSS, no build
.github/workflows/      ci.yml (test + packed-tarball smoke test), release.yml (npm), pages.yml
```

`validator.ts` is the only module that reaches into every folder. When adding a
file, put it in the lowest layer that can hold it. A new output format goes in
`format/`, a new way of loading input goes in `load/`, and a new constraint's
wording goes in `report/messages.ts`.

## Things you cannot infer from the code

**The core must run in a browser.** Only `src/cli.ts` and `src/node.ts` may
import `node:` builtins. File paths reach the core through an injected
`readFile`, which `node.ts` supplies. `package.json` `exports` give Node
`dist/node.js` and everyone else `dist/index.js`, and both have the same API.

**Folders are layered `rdf/ <- document/ <- report/ <- format/`, with `load/`
beside `format/`.** `validator.ts`, `index.ts`, `node.ts` and `cli.ts` sit
above them. `test/architecture.test.ts` enforces the layering, the absence of
cycles and the `node:` rule.

**The published `.d.ts` must not mention rdf-ext, n3, jsonld or
rdf-validate-shacl.** They have no types, and `src/types/vendor.d.ts` is
ambient, so it does not ship. Public types use `@rdfjs/types`. This is why
`Validator` is an interface and the class behind it is not exported.

**Skolemization is load-bearing.** `src/document/skolemize.ts` gives every
anonymous node a `urn:dsv:node:N` identity before `jsonld.toRDF`, which is the
only reason a result can be reported as `address[0].postcode` instead of `_:b3`.
It is safe *because it adds no triples*, so never make it add any. Guards:
`loadShapes` turns it off if a shape wants `sh:nodeKind sh:BlankNode`, and
tests assert that verdicts are identical with and without it, and that no
`urn:dsv:node:` reaches any output format.

**Do not parse engine messages.** The strings rdf-validate-shacl emits ("Less
than 1 values") are its own defaults. Read the source shape's
`sh:description` and constraint parameters via `src/report/shape-facts.ts`.

**Nothing domain-specific lives here.** Wording for a particular standard's
regexes arrives through the `patterns` option, and multi-document rules through
`crossChecks`. The Social Care validator (SocialCareData/validator) is the
reference consumer.

**A supplied context always replaces the document's own.** A document with
no context at all fails with `no-context` rather than passing unchecked.

## Conventions

An issue's `title` and `hint` are the human layer and must never contain a raw
IRI; a test enforces this. IRIs belong in `issue.technical`, or in `value` when
the IRI is what went wrong. `report/types.ts` and issue codes are a published
contract (`--format json`). Comments explain why, not what.
