# Issue codes

Every issue carries a `code`. The `title` wording may improve between releases,
but the codes are stable, so match on those.

| Code | Severity | Raised by |
| --- | --- | --- |
| [`required-field-missing`](#required-field-missing) | from the shape | `sh:minCount 1` |
| [`too-few-values`](#too-few-values) | from the shape | `sh:minCount` above 1 |
| [`too-many-values`](#too-many-values) | from the shape | `sh:maxCount` |
| [`value-not-allowed`](#value-not-allowed) | from the shape | `sh:in` |
| [`bad-format`](#bad-format) | from the shape | `sh:pattern` |
| [`wrong-type`](#wrong-type) | from the shape | `sh:datatype`, `sh:nodeKind` |
| [`wrong-object-type`](#wrong-object-type) | from the shape | `sh:class`, `sh:node` |
| [`out-of-range`](#out-of-range) | from the shape | `sh:minInclusive` and friends |
| [`rule-violation`](#rule-violation) | from the shape | `sh:not` |
| [`other`](#other) | from the shape | anything else |
| [`parse-error`](#parse-error) | violation | the validator |
| [`no-context`](#no-context) | violation | the validator |
| [`assumed-context`](#assumed-context) | info | the validator |
| [`substituted-context`](#substituted-context) | info | the validator |
| [`shape-unavailable`](#shape-unavailable) | warning | the validator, in `setup.warnings` |

The severity of a SHACL result comes from the shape's `sh:severity`. Without
one it is `violation`.

---

## `required-field-missing`

The shape requires this field and the document does not have it.

```text
x Missing required field postcode
  at address[0].postcode
  Add `postcode`: Postcode in standard format (e.g. AB1 2CD).
```

The hint quotes the shape's `sh:description` when it has one.

## `too-few-values`

The field is present but needs more entries than were supplied. It is an
array, so add the missing ones.

## `too-many-values`

The field may appear a limited number of times and more were supplied. This is
usually a repeated key, or an array where a single value belongs.

## `value-not-allowed`

The field is a controlled vocabulary and the value is not in it.

```text
x status must be one of the permitted values - you gave Retired
  Allowed values: Active, Inactive.
```

The allowed values are the tokens to write in JSON, read back from the
context, not the full IRIs.

## `bad-format`

The value is the right kind of thing but the wrong shape: a lower-case
postcode, a date that is not `YYYY-MM-DD`, stray spaces.

```text
x postcode is not in the expected format - you gave nope
  It should be a short postcode, for example `AB1`.
```

The hint is built from the shape's `sh:description`, or from a
[pattern hint](api.md#pattern-hints) if you supplied one. The regex itself
stays in `technical`.

## `wrong-type`

The value is a different type from the one expected. It could be text where a
number belongs, or a nested object where a plain value belongs. Numbers
exported as strings are a common cause: `"3"` and `3` are different to a
validator.

## `wrong-object-type`

A nested object is not the class expected at this position. Check its `@type`,
and that it has the properties that class requires.

## `out-of-range`

A numeric or date value falls outside the permitted bounds.

## `rule-violation`

An `sh:not` rule was broken. These shapes usually carry their own
`sh:message`, which is used as the title verbatim.

## `other`

A constraint failed that the validator does not yet describe in plain terms.
The constraint component is in `technical.constraint`. Please
[open an issue](https://github.com/theodi/data-standard-validator/issues). This
is a gap in the validator, not a problem with your data.

---

## `parse-error`

The document is not valid JSON. Fix the syntax first, because nothing else
could be checked.

## `no-context`

There was no JSON-LD context to read the document with. Either it has no
`@context` and none was supplied, or its `@context` could not be loaded. In
that case the reason is in `value`. Without a context the JSON produces no RDF,
so the document is failed rather than passed unchecked. Supply a context
(`--context`), or add or fix the document's `@context`.

## `assumed-context`

The document had no `@context`, so the supplied one was used. This is normal
for plain JSON. It is a note, not a problem.

## `substituted-context`

The document declared its own `@context`, and the supplied one was used
instead. If they differ, results reflect the supplied context.

## `shape-unavailable`

A setup problem, reported in `setup.warnings` rather than against a document.
It covers two cases:

- An optional shapes file was not found. Some checks did not run. Everything
  reported is still accurate, there is just less of it.
- A shape requires blank nodes (`sh:nodeKind sh:BlankNode`), so issues cannot
  be traced back to JSON paths. They name the nearest `@id` instead.
