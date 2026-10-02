---
name: validation-messages
description: Change or add the plain-English wording the validator shows for a SHACL constraint. Use when a message reads badly, when an issue comes out with code "other", or when adding support for a constraint component the library does not describe yet.
---

# Validation messages

The point of this library is to say "postcode is not in the expected format,
for example AB1" instead of quoting `sh:PatternConstraintComponent` at
somebody. That happens in `src/report/messages.ts`.

## Where the words come from

**Not from the SHACL engine.** Strings like "Less than 1 values" are
`rdf-validate-shacl`'s defaults. Never parse them.

They come from the shape that raised the result. `src/report/shape-facts.ts`
reads back `sh:description`, `sh:minCount`, `sh:pattern`, `sh:in` and the rest,
and `describeConstraint` turns those into a sentence. Descriptions often hold an
example (`"Postcode (e.g. AB1 2CD)"`), which is where the hint's example comes
from. A shape's own `sh:message` is used verbatim.

Regexes for a particular standard belong to the caller, passed in through the
`patterns` option (`PatternHint`). Do not add domain patterns to the library.

## Adding a case

1. **`src/report/messages.ts`**: add a `case` to `describeConstraint`. Return an
   `IssueCode` from `src/report/types.ts` (add a new one only if none fits), a
   `title`, and a `hint` saying what would be right.
2. **`test/unit/messages.test.ts`**: add a test with a hand-built `facts`
   object.
3. **`docs/error-reference.md`**: add a section for the code. It is a
   documented interface.
4. If a fixture in `test/fixtures/` now produces the new code, update the
   assertions in `test/validator.test.ts`.

## Rules

- **No IRIs in `title` or `hint`.** A test enforces this. Show the context term,
  the enum token, or the compact form.
- **Say what would be right**, not only what is wrong.
- **Quote the value as the user wrote it.** `report/build.ts` reads it back out
  of their JSON.
- **Markup is `` `code` `` and `**bold**`**, and nothing else. Every formatter
  understands those two.

## Checking your wording

```bash
npm run build
node dist/cli.js -s test/fixtures/person-shape.ttl test/fixtures/invalid.jsonld
```

Read the output as somebody who has a spreadsheet export and no knowledge of
SHACL. If a sentence does not tell them which field and what to do, it is not
finished.
