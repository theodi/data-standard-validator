# Library API

```ts
import {
  validate, createValidator, formatReport, groupIssues,
} from '@theodi/data-standard-validator'
```

The package is ESM-only and needs Node.js 22+ or a modern bundler. Node loads
a build that can read file paths. Browsers and bundlers load a build without
any filesystem code. Both have the same API.

## `validate(options)`: one call

```ts
const report = await validate({
  shapes: 'shapes/person.ttl',
  data: ['a.json', 'b.json'],
})
```

This loads the shapes, checks every document, runs any cross-checks across the
batch, and resolves to a [`RunReport`](report-format.md).

## `createValidator(options)`: load once, validate many

Parsing large shapes files is the slow part. Hold on to a validator to pay for
it once:

```ts
const validator = await createValidator({ shapes: 'shapes/person.ttl', context: 'context.jsonld' })

const one = await validator.validate({ name: 'upload.json', text })   // DocumentReport
const all = await validator.validateAll(['a.json', 'b.json'])         // RunReport

validator.setup       // { shapes, context?, warnings } - what it checks against
validator.skolemSafe  // false if a shape needs real blank nodes (see how-it-works.md)
```

`createValidator` rejects with a `SourceError` if a shapes file or the context
cannot be loaded or parsed. Problems with a *document* do not reject. Invalid
JSON or an unloadable `@context` becomes an issue in the report.

## Options

| Option | Type | Description |
| --- | --- | --- |
| `shapes` | `Source \| Source[]` | **Required.** SHACL shapes in Turtle. Several are merged, in order. |
| `context` | `Source` | A JSON-LD context that replaces each document's `@context`. The file may be written as `{"@context": {...}}` or as the bare context. |
| `data` | `Source \| Source[]` | `validate()` only: the documents to check. |
| `crossChecks` | `CrossCheck[]` | Rules across the whole batch (see below). |
| `patterns` | `PatternHint[]` | Plain-English names for the `sh:pattern` regexes your shapes use. |
| `skolemize` | `boolean` | Default `true`. Set to `false` to stop tracing results back to JSON paths. It is turned off automatically when a shape requires blank nodes. |
| `fetch` | `typeof fetch` | Used for URL sources. Defaults to the global `fetch`. Inject one for tests, auth headers or caching. |
| `readFile` | `(path) => Promise<string>` | Used for file paths. The Node build supplies one. In a browser, path sources fail unless you pass one. |

## Sources

Every input (shapes, context, documents) is a `Source`:

```ts
type Source =
  | string                                              // URL if it has a scheme, else a file path
  | { url: string, optional?: boolean, label?: string }
  | { path: string, optional?: boolean, label?: string }
  | { text: string, name?: string, base?: string }      // content you already have
  | { json: unknown, name?: string, base?: string }     // already-parsed JSON
```

- **`name`** is what the report calls the document. A URL or path names itself.
- **`base`** is where relative references inside inline content resolve from,
  such as `"@context": "./context.jsonld"`.
- **`optional`** applies to shapes. If an optional shapes file is not found, a
  warning is added to `report.setup.warnings` and validation continues without
  it. **`label`** completes that warning ("*the conditional rules* could not be
  loaded").
- Prefer `{ text }` over `{ json }` for documents when you have the text.
  Only the text gives issues line and column numbers.

## Formatting a report

```ts
formatReport(report, 'text', { color: false, sources })  // the CLI's output
formatReport(report, 'json')                              // JSON.stringify, pretty-printed
formatReport(report, 'markdown', { title: 'People data' })
```

| Option | Applies to | Description |
| --- | --- | --- |
| `color` | text | ANSI colours. Default `true`. |
| `sources` | text | `Map<documentName, text>`, used to print the offending line under each issue. |
| `title` | text, markdown | Heading. Defaults to the shapes' file names. |

`renderText`, `renderJson` and `renderMarkdown` are exported too.

To render issues yourself, for example in a web page,
`groupIssues(document.issues)` groups them by the object they belong to, the way
the built-in formats do. Each group has a `label` such as `Address (address[0])`.
Issue `title`s and `hint`s use two bits of inline markup: `` `code` `` and
`**bold**`.

## Pattern hints

A regex is hard to describe in words, so the library does not try. When an
`sh:pattern` fails, the hint is built from the shape's `sh:description`, using
any `(e.g. ...)` in it as the example. To say it better, name your patterns:

```ts
const validator = await createValidator({
  shapes,
  patterns: [
    { pattern: '^[0-9]{10}$', description: 'a 10-digit NHS number', example: '9434765919' },
    { pattern: /^\^\[A-Z\]\{1,2\}/, description: 'a UK postcode in upper case', example: 'AB1 2CD' },
  ],
})
```

A string matches the shape's regex source exactly. A `RegExp` is tested
against that source.

## Cross-checks

SHACL validates one node at a time, so it cannot express a rule like "no two
documents share an identifier". A cross-check runs after SHACL, over the RDF of
every document in a `validateAll` batch:

```ts
import { namedNode, type CrossCheck } from '@theodi/data-standard-validator'

const uniqueId: CrossCheck = {
  id: 'unique-id',
  title: 'the same identifier appears in several documents',
  run (documents) {
    const seen = new Map<string, string[]>()
    for (const { name, dataset } of documents) {
      for (const quad of dataset.match(null, namedNode('https://example.org/identifier'), null)) {
        seen.set(quad.object.value, [...(seen.get(quad.object.value) ?? []), name])
      }
    }
    const findings = [...seen].filter(([, docs]) => docs.length > 1)
      .map(([id, docs]) => ({ message: `${id} appears in ${docs.join(', ')}`, documents: docs }))
    return { ok: findings.length === 0, findings }
  },
}

await validate({ shapes, data: files, crossChecks: [uniqueId] })
```

`dataset` is an RDF/JS [`DatasetCore`](https://rdf.js.org/dataset-spec/). A
failed check makes `report.conforms` false and appears in `report.crossChecks`.

## Errors

| Class | When |
| --- | --- |
| `SourceError` | A source could not be loaded or parsed. `error.source` names it, and `error.status` holds the HTTP status if there was one. |
| `NotFoundError` | A subclass of `SourceError`: HTTP 404, or a missing file. |

## In the browser

```ts
import { createValidator } from '@theodi/data-standard-validator'

const validator = await createValidator({ shapes: 'https://example.org/shape.ttl' })
const report = await validator.validateAll([{ name: 'pasted', text: textarea.value }])
```

- Shapes and contexts must be served with CORS headers. Files on
  `raw.githubusercontent.com` are.
- Parsing large shapes can take a noticeable moment, so run validation in a
  Web Worker to keep the page responsive.
- `rdf-ext`, one of the RDF libraries underneath, expects a global `window`.
  Inside a worker, define it before the library loads. Put this in a module
  imported first:

  ```ts
  // worker-globals.ts
  ;(globalThis as { window?: unknown }).window ??= globalThis
  ```

## TypeScript

Types ship with the package. The exported types are `Source`,
`ValidatorOptions`, `ValidateOptions`, `Validator`, `RunReport`,
`DocumentReport`, `Issue`, `IssueCode`, `Location`, `Severity`,
`CrossCheck`, `CrossCheckDocument`, `CrossCheckReport`, `PatternHint`,
`Format`, `FormatOptions` and `IssueGroup`.
