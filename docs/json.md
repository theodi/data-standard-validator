# JSON and JSON-LD

The validator checks JSON documents through
[JSON-LD](https://www.w3.org/TR/json-ld11/). A JSON-LD context says which IRI
each key stands for, which turns the document into RDF that SHACL can check.
Every problem is reported at its **JSON path and line**.

```bash
data-standard-validator -s person-shape.ttl person.jsonld
data-standard-validator -s person-shape.ttl --context context.jsonld person.json
```

```ts
const validator = await createValidator({ shapes, context: 'context.jsonld' })
const report = await validator.validate({ text, name: 'upload.json' })
```

## How a document is read as JSON

On the command line, a document is read as JSON when its path or URL ends in
`.json` or `.jsonld`. Anything piped in on stdin is read as JSON too.

From the API, a source whose name does not end in `.csv` is read as JSON, and
so is already-parsed `{ json }`. To be explicit, add `format: 'json'` to the
[source](api.md#sources). Pass `{ text }` rather than `{ json }` when you have
the text: only the text gives issues their line and column.

Text that is not valid JSON fails with
[`parse-error`](error-reference.md#parse-error), located where the syntax
broke.

## What a report looks like

```text
person.json -> fails
  in Person
    x Missing required field name
      at name  line 1
      Add `name`: The person's full name.
    x age must be at least 0 - you gave -1
      at age  line 9
          9 |   "age": -1
            |          ^^
```

Issues are grouped by the object they are about. That object is named by its
`@type` and, when it is nested, its path, such as `Address (address[0])`. Each
issue's `location` has:

| Field | Example | Meaning |
| --- | --- | --- |
| `jsonPath` | `address[0].postcode` | The path as a person reads it; `$` is the whole document. |
| `pointer` | `/address/0/postcode` | The same place as an [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) JSON Pointer. |
| `line`, `column` | `5`, `13` | Where the key or value is in the text, with `endLine` and `endColumn`. |
| `nodeType` | `Address` | The object's `@type`, as written. |
| `nodeId` | `person-1` | The nearest `@id` you wrote, on this object or one around it. |

A missing field is reported under its own path, with the line pointing at the
object that should hold it. A wrong value is reported at the value itself. See [Report format](report-format.md) for the
whole issue.

## The context

A JSON-LD context maps each key to an IRI, such as `"postcode"` to
`https://example.org/postcode`. Without one, JSON produces no RDF and there is
nothing to check. For each document:

1. **A supplied context is always used.** Pass it with `--context` or the
   `context` option. It replaces the document's own `@context`, and a note in
   the report says whether it was added
   ([`assumed-context`](error-reference.md#assumed-context)) or replaced one
   ([`substituted-context`](error-reference.md#substituted-context)).
2. **Otherwise the document's own `@context` is used.** A URL or a relative path
   (`"@context": "./context.jsonld"`) is loaded, resolved against the
   document's location. Contexts that refer to other contexts are loaded too,
   once per run.
3. **With no context at all, the document fails** with
   [`no-context`](error-reference.md#no-context). Calling it valid would mean
   nothing had been checked.

So **plain JSON** needs `--context`, and **JSON-LD** works as it is, unless the
context it names is not the one that matches the shapes.

The context is also how the report speaks your language. Field names are the
keys the context defines, and the values of a controlled vocabulary are shown
as the tokens it defines (`official`, not `https://example.org/use/Official`).
A context file may be written as `{ "@context": { ... } }` or as the bare
context.

## Where this differs from plain JSON-LD

- **Anonymous objects are traced back.** JSON-LD turns an object without an
  `@id` into a blank node with a made-up label, which a report cannot point
  at. The validator gives each one an internal identifier first, so a problem
  is reported at `address[0]` instead of `_:b3`. This adds no data and never
  changes a verdict. [How it works](how-it-works.md#skolemization-putting-results-back-where-they-came-from)
  explains it.
- **A supplied context replaces the document's own,** rather than being
  combined with it.

## Troubleshooting

**"This document has no @context, so nothing in it could be checked."** Pass
`--context`, or add an `@context` to the document.

**Everything passes, but you expected failures.** Check that the shapes target
what your documents contain. A shape with `sh:targetClass ex:Person` only
checks objects with `"@type": "Person"`, and only if the context maps `Person`
to `ex:Person`. Keys the context does not define are silently dropped by
JSON-LD, so a misspelt key is not checked at all.

**Field names are shown as IRIs or compact IRIs.** The context in use does not
define a term for that property. Add one to the context.

**"This document's @context could not be loaded."** The reason is in the
issue's `value`. A relative `@context` cannot be resolved for a document read
from stdin, because it has no location. Pass `--context` instead.
