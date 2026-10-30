# data-standard-validator

Validate JSON and JSON-LD documents against [SHACL](https://www.w3.org/TR/shacl/)
shapes. Problems are explained in plain English and point at the JSON path and
line where they occur. Reports can be output as text, JSON, or Markdown.

SHACL engines such as [rdf-validate-shacl](https://github.com/zazuko/rdf-validate-shacl)
and [shacl-engine](https://www.npmjs.com/package/shacl-engine) take an RDF
dataset and return a SHACL validation report made of IRIs and blank node IDs.
This library sits on top of one: it uses rdf-validate-shacl under the hood, and
adds the parts around it. It turns JSON into RDF via a JSON-LD context, maps
each result back to a JSON path and line (`address[0].postcode`, not `_:b3`),
words it from the shape's own descriptions, and ships a CLI and report formats.

**[Documentation site](https://theodi.github.io/data-standard-validator/)** ·
[npm package](https://www.npmjs.com/package/@theodi/data-standard-validator) ·
[CLI reference](docs/cli.md) · [Library API](docs/api.md) ·
[How it works](docs/how-it-works.md) ·
[Web component](https://github.com/theodi/data-standard-validator-component) ·
[Web demo](https://theodi.github.io/data-standard-validator-demo/)

## Install

Requires Node.js 22 or later.

```bash
npm install --save-dev @theodi/data-standard-validator
npx data-standard-validator --help
```

For one-off use without adding it to a project, run
`npx --yes @theodi/data-standard-validator --help`.

## Example

```bash
npx --yes @theodi/data-standard-validator -s person-shape.ttl person.json
```

```text
person-shape.ttl · 1 document(s)

person.json -> fails
  in Person
    x Missing required field name
      at name  line 1
      Add `name`: The person's full name.
    x age must be at least 0 - you gave -1
      at age  line 9
          9 |   "age": -1
            |          ^^

2 problems
  1 required field missing, 1 out of range
```

The [full example](docs/example.md) shows the shape, the document, and the same
report as JSON and Markdown.

## Command line

```bash
npx data-standard-validator -s shapes.ttl data.json
```

The command is available through `npx` after installation. The exit code is 0
when every document conforms and 1 when one does not. See
the [CLI reference](docs/cli.md) for every option, output format and exit code.

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

## Web component

[data-standard-validator-component](https://github.com/theodi/data-standard-validator-component)
is a web component that provides a validation user interface on top of this
library. See the [demo](https://theodi.github.io/data-standard-validator-demo/)
for it in action and an example of how to use it.

## Development

```bash
npm install
npm test            # unit, pipeline, format and CLI tests - offline
npm run typecheck
npm run build       # dist/, which is what gets published
```

## License

Licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.