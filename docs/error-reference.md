# Issue codes

Every issue carries a `code`. The `title` wording may improve between releases,
but the codes are stable, so match on those.

Most codes come from the shapes and mean the same in every input format. The
rest come from reading a document: a few apply to every format, and the others
belong to [JSON and JSON-LD](json.md) or [CSV](csv.md).

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
| [`parse-error`](#parse-error) | violation | reading any document |
| [`shape-unavailable`](#shape-unavailable) | warning | loading the shapes, in `setup.warnings` |
| [`no-context`](#no-context) | violation | reading JSON |
| [`assumed-context`](#assumed-context) | info | reading JSON |
| [`substituted-context`](#substituted-context) | info | reading JSON |
| [`no-csv-metadata`](#no-csv-metadata) | violation | reading CSV |
| [`csv-column-missing`](#csv-column-missing) | violation | reading CSV |
| [`csv-column-unexpected`](#csv-column-unexpected) | warning | reading CSV |
| [`csv-feature-unsupported`](#csv-feature-unsupported) | warning | loading the CSVW metadata, in `setup.warnings` |
| [`bad-format`](#bad-format) | violation | reading CSV, when a cell's `datatype` cannot read it |

The severity of a SHACL result comes from the shape's `sh:severity`. Without
one it is `violation`.

---

## From the shapes

These read the same whichever format the document is in. Only the location
differs: `address[0].postcode` in JSON, `row 3, postcode` in CSV.

### `required-field-missing`

The shape requires this field and the document does not have it: a missing
key in JSON, an empty cell in CSV.

```text
x Missing required field postcode
  at address[0].postcode
  Add `postcode`: Postcode in standard format (e.g. AB1 2CD).
```

The hint quotes the shape's `sh:description` when it has one.

### `too-few-values`

The field is present but needs more entries than were supplied. In JSON it is
an array; in CSV, a column with a `separator`. Add the missing entries.

### `too-many-values`

The field may appear a limited number of times and more were supplied. This is
usually an array where a single value belongs, or, in CSV, a list cell with
too many entries.

### `value-not-allowed`

The field is a controlled vocabulary and the value is not in it.

```text
x status must be one of the permitted values - you gave Retired
  Allowed values: Active, Inactive.
```

The allowed values are what to write, not the full IRIs: in JSON, the tokens
the context defines; in CSV, the labels the metadata's
[`valueMap`](csv.md#extensions) defines.

### `bad-format`

The value is the right kind of thing but the wrong shape: a lower-case
postcode, a date that is not `YYYY-MM-DD`, stray spaces.

```text
x postcode is not in the expected format - you gave nope
  It should be a short postcode, for example `AB1`.
```

The hint is the shape's own `sh:message` if it has one. Otherwise it comes
from a [pattern hint](api.md#pattern-hints) if you supplied one, and failing
that from the shape's `sh:description`. The regex itself stays in `technical`.

In CSV, `bad-format` is also raised before the shapes are checked, when a
cell's `datatype` in the metadata cannot read it, such as `yes` in a column
whose format is `"Yes|No"`. The hint then says what the cell should look like,
and the shapes do not report the same cell again.

### `wrong-type`

The value is a different type from the one expected. It could be text where a
number belongs, or a nested object where a plain value belongs. In JSON,
numbers exported as strings are a common cause: `"3"` and `3` are different to
a validator. In CSV, every cell is text until its column's `datatype` says
otherwise, so check the metadata gives the column the type the shape expects.

### `wrong-object-type`

A nested object is not the class expected at this position. Check its type (in
JSON its `@type`, in CSV the virtual column that types it), and that it has
the properties that class requires.

### `out-of-range`

A numeric or date value falls outside the permitted bounds.

### `rule-violation`

An `sh:not` rule was broken. These shapes usually carry their own
`sh:message`, which is used as the title verbatim.

### `other`

A constraint failed that the validator does not yet describe in plain terms.
The constraint component is in `technical.constraint`. Please
[open an issue](https://github.com/theodi/data-standard-validator/issues). This
is a gap in the validator, not a problem with your data.

---

## From reading any document

### `parse-error`

The document is not valid in its own syntax: not valid JSON, or not valid CSV
(for example, a quoted value that is never closed). The location is where the
parser gave up. Fix the syntax first, because nothing else could be checked.

### `shape-unavailable`

A setup problem, reported in `setup.warnings` rather than against a document.
It covers two cases:

- An optional shapes file was not found. Some checks did not run. Everything
  reported is still accurate, there is just less of it.
- A shape requires blank nodes (`sh:nodeKind sh:BlankNode`), so anonymous
  nodes cannot be traced back to where they are written. Issues about them
  name the nearest `@id`, or the row, instead.

---

## From reading JSON

See [JSON and JSON-LD](json.md#the-context).

### `no-context`

There was no JSON-LD context to read the document with. Either it has no
`@context` and none was supplied, or its `@context` could not be loaded. In
that case the reason is in `value`. Without a context the JSON produces no RDF,
so the document is failed rather than passed unchecked. Supply a context
(`--context`), or add or fix the document's `@context`.

### `assumed-context`

The document had no `@context`, so the supplied one was used. This is normal
for plain JSON. It is a note, not a problem.

### `substituted-context`

The document declared its own `@context`, and the supplied one was used
instead. If they differ, results reflect the supplied context.

---

## From reading CSV

See [CSV](csv.md#the-metadata).

### `no-csv-metadata`

The document is a CSV file, but no CSVW metadata was supplied to say how its
columns map to the shapes. Nothing in it could be checked, so it fails rather
than passing unchecked. Supply the metadata (`--csv-metadata`, or the
`csvMetadata` option). See [CSV](csv.md#the-metadata).

### `csv-column-missing`

The CSVW metadata describes a column that the file's header does not have.
Columns are matched by title, so the column may be misspelt rather than
absent. The issue is located at the header.

```text
x The column `placement_type` is missing
  at header  line 1
  Add a `placement_type` column. Its header must start with `placement_type`.
```

### `csv-column-unexpected`

The file has a column the metadata does not describe, so its values were not
checked. Often this is a misspelt column name, which then also shows up as
`csv-column-missing`.

### `csv-feature-unsupported`

A setup warning, in `setup.warnings`: the CSVW metadata uses something the
validator does not implement, such as `required` or a datatype's `minimum`.
That part of the metadata was ignored, and the warning names it. See
[supported CSVW](csv.md#supported-csvw).
