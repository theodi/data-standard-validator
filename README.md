# data-standard-validator

Validate JSON and JSON-LD documents against [SHACL](https://www.w3.org/TR/shacl/)
shapes. Problems are explained in plain English and point at the JSON path and
line where they occur.

**[Documentation site](https://theodi.github.io/data-standard-validator/)** ·
[CLI reference](docs/cli.md) · [Library API](docs/api.md) ·
[Report format](docs/report-format.md) · [Issue codes](docs/error-reference.md) ·
[How it works](docs/how-it-works.md)

## Install

Requires Node.js 22 or later.

```bash
npm install --save-dev @theodi/data-standard-validator   # in a project
npx @theodi/data-standard-validator --help                # or run it without installing
```

## Command line

| Input | Required | Accepted as |
| --- | --- | --- |
| SHACL shapes (Turtle) | yes, one or more | URL or file path; several are merged |
| JSON / JSON-LD documents | yes, one or more | URL, file path or stdin |
| JSON-LD context | no | URL or file path; replaces each document's own `@context` |

It produces a report as **text** for terminals, **JSON** for programs and web
pages, or **Markdown** for GitHub job summaries and PR comments.

```bash
dsv -s shapes.ttl data.json                                # validate one file
dsv -s https://example.org/shape.ttl -c context.jsonld data/*.json
dsv -s shape.ttl -s rules.ttl data.jsonld --format json    # merge shapes, machine output
dsv -s shape.ttl data.jsonld -f markdown >> "$GITHUB_STEP_SUMMARY"
```

| Exit code | Meaning |
| --- | --- |
| 0 | every document conforms |
| 1 | problems were found |
| 2 | bad usage |
| 3 | shapes, a context or a document could not be loaded |

See the [CLI reference](docs/cli.md) for every option.

## Library

```ts
import { validate, formatReport } from '@theodi/data-standard-validator'

const report = await validate({
  shapes: 'https://example.org/shapes/person.ttl',
  context: 'https://example.org/context.jsonld',   // optional
  data: ['person-1.json', 'person-2.json'],
})

report.conforms                           // boolean
report.documents[0].issues                // what is wrong, and where
formatReport(report, 'markdown')          // or 'text' / 'json'
```

To validate many documents, load the shapes once:

```ts
import { createValidator } from '@theodi/data-standard-validator'

const validator = await createValidator({ shapes: 'shape.ttl' })
const result = await validator.validate({ name: 'upload.json', text: body })
```

The same API works in the browser. There, sources are URLs or inline
`{ text }` / `{ json }` objects. See the [API reference](docs/api.md).

## Development

```bash
npm install
npm test            # unit, pipeline, format and CLI tests - offline
npm run typecheck
npm run build       # dist/, which is what gets published
```
