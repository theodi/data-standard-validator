# Data Standard Validator

Check data against a standard, and say what is wrong in words people understand.

A data standard published as [SHACL](https://www.w3.org/TR/shacl/) shapes is
precise, but a SHACL engine reports problems in IRIs and blank nodes. This
validator checks JSON and JSON-LD against those shapes and reports each problem
in plain English. It names the field, the JSON path and the line, and says how
to fix it.

```bash
npx @theodi/data-standard-validator --help
```

## The same problem, reported two ways

A SHACL engine:

```text
Violation
focus: _:b3
path:  https://example.org/postcode
"Value does not match pattern
 ^[A-Z]{1,2}[0-9][0-9A-Z]? ?[0-9][A-Z]{2}$"
```

`dsv`:

```text
person.json -> fails
  in Address (address[0])
    x postcode is not in the expected format - you gave NOT A POSTCODE
      at address[0].postcode  line 10
         10 |   "postcode": "NOT A POSTCODE"
            |               ^^^^^^^^^^^^^^^^
      It should be a UK postcode, for example AB1 2CD.
```

## What it does

| Feature | |
| --- | --- |
| **Any SHACL standard** | Point it at one or more Turtle shapes files, by URL or path. Nothing is built in, so it checks against whatever the standard publishes. |
| **Answers that point somewhere** | Every issue has a JSON path, a line and column, the value you gave and, for vocabularies, the values that are allowed. |
| **Plain JSON welcome** | Supply a JSON-LD context and documents without one are read with it. A context that a document names by URL is loaded for you. |
| **Three report formats** | Text for the terminal, JSON for programs and web apps, and Markdown for GitHub job summaries and pull request comments. |
| **CLI and library** | One package. The `dsv` command for scripts and CI, and a TypeScript API that runs in Node and in the browser. |
| **Rules across files** | SHACL checks one record at a time. Cross-checks add rules over a whole batch, such as unique identifiers. |

## Quick start: command line

Requires Node.js 22 or later. There is nothing to configure.

Validate a document against a shapes file:

```bash
npx @theodi/data-standard-validator -s person-shape.ttl person.json
```

If your data is plain JSON, or names a context you want to replace, supply one:

```bash
npx @theodi/data-standard-validator \
  -s https://example.org/shapes/person-shape.ttl \
  -c https://example.org/shapes/context.jsonld \
  data/*.json
```

Use it in a script or CI. The exit code is 0 when everything conforms and 1
when it does not. For a GitHub summary:

```bash
dsv -s shape.ttl data/*.json -f markdown >> "$GITHUB_STEP_SUMMARY"
```

Install it in a project (`npm install -D @theodi/data-standard-validator`) and
the command is `dsv`. Every option is in the [CLI reference](cli.md).

## Quick start: library

```ts
import { validate, formatReport } from '@theodi/data-standard-validator'

const report = await validate({
  shapes: 'https://example.org/shapes/person-shape.ttl',
  context: 'https://example.org/shapes/context.jsonld',  // optional
  data: { name: 'upload.json', text: body },
})

if (!report.conforms) {
  for (const issue of report.documents[0].issues) {
    console.log(issue.location.jsonPath, issue.title)
  }
}

console.log(formatReport(report, 'markdown'))
```

In Node, sources can be file paths. In the browser, use URLs or inline
`{ text }` and `{ json }`, and the same code runs unchanged. To validate many
documents, call `createValidator()` once and reuse it. See the
[API reference](api.md) and the [report format](report-format.md).

## How it works

1. **Choose a context.** A context you supply always applies. Otherwise the
   document's own `@context` is loaded. A document with neither fails, rather
   than passing unchecked.
2. **Name every node.** Before converting to RDF, each anonymous object gets an
   internal identity and a record of where it came from. This adds no triples,
   so verdicts are unchanged.
3. **Run SHACL.** A standard engine, rdf-validate-shacl, validates the RDF
   against the shapes.
4. **Translate the results.** Focus nodes become JSON paths, IRIs become the
   field names your context defines, and constraints become sentences built
   from the shape's own descriptions.

The full explanation is in [How it works](how-it-works.md), and every issue
code is in the [issue codes](error-reference.md) reference.

## In use

The [Social Care data validator](https://github.com/SocialCareData/validator)
uses this library to check records against the Social Care MAIS standards, in
the browser.
