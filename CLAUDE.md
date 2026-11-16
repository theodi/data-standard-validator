# @theodi/data-standard-validator

A generic SHACL validator for JSON and JSON-LD documents, and for CSV files read
through CSVW metadata. It ships as an npm
package (library + the `data-standard-validator` CLI) with a documentation site built from `docs/`
by MkDocs (Read the Docs theme).

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
  cli.ts                the `data-standard-validator` command (commander); exit codes 0/1/2/3
  validator.ts          the pipeline: createValidator(), validate(); knows no format

  input/                one handler per document format, all doing the same stages
    types.ts            InputHandler.prepare(): parse, needs, name nodes, to RDF, issues
    index.ts            createInputs(): the registry of formats
    json.ts             JSON/JSON-LD: JSON.parse, choose @context, skolemize, toRDF
    csv.ts              CSV: parse, CSVW metadata, rows named, csv2rdf

  load/                 getting inputs in: a Source becomes text, shapes or a context
    sources.ts          the Source type, URL vs path, readSource(), FORMAT_EXTENSIONS, formatOf()
    fetch.ts            fetchText(), SourceError, NotFoundError
    shapes.ts           loadShapes(): merge Turtle, optional sources, skolemSafe check
    context.ts          ContextLoader: inline remote contexts, cache, jsonld documentLoader
    csvw.ts             loadCsvw(): CSVW metadata flattened into a CsvwTable, plus a naming index

  document/             the user's document on its way to RDF, and back again
    skolemize.ts        name anonymous nodes; map them to JSON paths and line/column; SKOLEM_BASE
    context-index.ts    a JSON-LD context inverted: IRI -> term, enum tokens
    jsonld.ts           apply a context and convert to an RDF dataset
    csv.ts              RFC 4180 parser; every cell knows its line and column
    csvw.ts             csv2rdf: rows to RDF, with the cell behind every triple

  rdf/                  the RDF layer: depends on nothing else in src/
    parse.ts            Turtle and N-Quads into an rdf-ext dataset
    shacl.ts            the SHACL engine, and requiresBlankNodes()
    cross-checks.ts     the CrossCheck interface and namedNode() helper (no checks ship)

  report/               SHACL results turned into plain English
    types.ts            the report contract (RunReport, Issue, IssueCode, PatternHint)
    shape-facts.ts      read sh:description, sh:minCount, sh:in... off the source shape
    messages.ts         a constraint as a sentence: describeConstraint()
    build.ts            results -> issues for any format: SourceLocator, combineIssues, sorting
    json.ts             jsonLocator(): where a result sits in a JSON document
    csv.ts              csvLocator(): where a result sits in a CSV file; conversion problems as issues
    group.ts            groupIssues(), shared by the formatters and web pages

  format/               a RunReport rendered for a reader
    index.ts            formatReport(report, 'text' | 'json' | 'markdown')
    text.ts             terminal output with code frames and colour
    markdown.ts         GitHub summaries and PR comments
    json.ts             the report verbatim
    options.ts          FormatOptions, shapesLabel()

  types/vendor.d.ts     ambient types for the untyped RDF stack (not shipped)

test/                   vitest; all offline
  fixtures/             a small shape, a rules shape, a context, valid and invalid docs; csv/ for CSVW
  helpers.ts            fixture paths and a stub fetch serving https://example.test/
  unit/                 context index, messages, skolemize in isolation
  inputs.test.ts        the contract every input format keeps, run over each registered one
  validator.test.ts     the pipeline end to end: contexts, sources, cross-checks, skolemization
  sources.test.ts       URL/path handling and load errors
  format.test.ts        text, json and markdown output
  cli.test.ts           builds dist/, then runs `node dist/cli.js` as a user would
  architecture.test.ts  layering, no cycles, the node: rule

docs/                   the documentation site source (MkDocs); docs.yml copies README.md in as index.md
  json.md, csv.md      one guide per input format, with the same outline
  example.md, cli.md, api.md, report-format.md, error-reference.md, how-it-works.md
mkdocs.yml              site config and nav; `mkdocs build` writes site/ (gitignored)
.github/workflows/      ci.yml (test + packed-tarball smoke test), cd.yml (npm), docs.yml
```

`validator.ts` is the only module that reaches into every folder. When adding a
file, put it in the lowest layer that can hold it. A new output format goes in
`format/`, a new way of loading input goes in `load/`, and a new constraint's
wording goes in `report/messages.ts`. A new input format is a handler in
`input/` (registered in `input/index.ts`), its extensions in
`FORMAT_EXTENSIONS`, its locator in `report/`, and a case in
`test/inputs.test.ts`; `validator.ts` does not change.

## Things you cannot infer from the code

**The core must run in a browser.** Only `src/cli.ts` and `src/node.ts` may
import `node:` builtins. File paths reach the core through an injected
`readFile`, which `node.ts` supplies. `package.json` `exports` give Node
`dist/node.js` and everyone else `dist/index.js`, and both have the same API.

**Folders are layered `rdf/ <- document/ <- report/ <- format/`, with `load/`
beside `format/` and `input/` above them all.** `validator.ts`, `index.ts`,
`node.ts` and `cli.ts` sit above that. `test/architecture.test.ts` enforces the layering, the absence of
cycles and the `node:` rule.

**The published `.d.ts` must not mention rdf-ext, n3, jsonld or
rdf-validate-shacl.** The first three have no types, and `src/types/vendor.d.ts`
is ambient, so it does not ship; rdf-validate-shacl's own types pull in
clownface, which consumers lack. Public types use `@rdfjs/types`. This is why
`Validator` is an interface and the class behind it is not exported.

**Skolemization is load-bearing.** `src/document/skolemize.ts` gives every
anonymous node a `urn:dsv:node:N` identity before `jsonld.toRDF`, which is the
only reason a result can be reported as `address[0].postcode` instead of `_:b3`.
CSV's counterpart names a row with no `aboutUrl` `#row-{_row}` (CSVW would
leave it blank), against `SKOLEM_BASE` when the file has no URL.
It is safe *because it adds no triples*, so never make it add any. Guards:
`loadShapes` turns it off if a shape wants `sh:nodeKind sh:BlankNode`, and
tests assert that verdicts are identical with and without it, in both formats,
and that no synthetic identity (`isSynthetic()`) reaches any output format.

**Do not parse engine messages.** The strings rdf-validate-shacl emits ("Less
than 1 values") are its own defaults. Read the source shape's
`sh:description` and constraint parameters via `src/report/shape-facts.ts`.

**Nothing domain-specific lives here.** Wording for a particular standard's
regexes arrives in the shapes as `sh:message`, or through the `patterns` option
when the shapes have none, and multi-document rules through
`crossChecks`. The Social Care validator (SocialCareData/validator) is the
reference consumer.

**CSV never goes through JSON-LD.** `document/csvw.ts` turns rows straight into
RDF, recording the cell behind each triple; `report/csv.ts` locates results by
that index. The CSVW subset and the departures from the spec (columns
matched by title; `dsv:headerMatch`; rows named when skolemizing) are documented in `docs/csv.md` - keep the
two in step, and warn (`csv-feature-unsupported`) about metadata that is not
honoured rather than ignoring it.

**A supplied context always replaces the document's own.** A document with
no context at all fails with `no-context` rather than passing unchecked.

## Conventions

An issue's `title` and `hint` are the human layer and must never contain a raw
IRI; a test enforces this. IRIs belong in `issue.technical`, or in `value` when
the IRI is what went wrong. `report/types.ts` and issue codes are a published
contract (`--format json`). Comments explain why, not what.
