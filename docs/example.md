# Example

One shape, checked against a JSON document and a CSV file that make the same
two mistakes. The issues read the same, and each is reported where it is in its
own format. The last sections show the report as JSON and as Markdown.

## The shape

`person-shape.ttl` says a person needs a name, and an age of zero or more:

```turtle
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <https://example.org/> .

ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:name ;
    sh:minCount 1 ;
    sh:datatype xsd:string ;
    sh:description "The person's full name." ;
  ] , [
    sh:path ex:age ;
    sh:datatype xsd:integer ;
    sh:minInclusive 0 ;
  ] .
```

## A JSON document

`person.json` has no name and a negative age. Its `@context` says which IRI
each key stands for (see [JSON and JSON-LD](json.md)):

```json
{
  "@context": {
    "ex": "https://example.org/",
    "Person": "ex:Person",
    "name": "ex:name",
    "age": { "@id": "ex:age", "@type": "http://www.w3.org/2001/XMLSchema#integer" }
  },
  "@type": "Person",
  "age": -1
}
```

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

The command exits with 1.

## A CSV file

`people.csv` has one good row, and a second row with the same two mistakes:

```text
name,age
Ada Lovelace,36
,-1
```

`csv-metadata.json` says which IRI each column stands for, and that each row is
a `Person` (see [CSV](csv.md)):

```json
{
  "@context": "http://www.w3.org/ns/csvw",
  "tableSchema": {
    "aboutUrl": "#row-{_row}",
    "columns": [
      { "name": "name", "titles": "name", "propertyUrl": "https://example.org/name" },
      { "name": "age", "titles": "age", "propertyUrl": "https://example.org/age", "datatype": "integer" },
      { "name": "type", "virtual": true, "propertyUrl": "rdf:type", "valueUrl": "https://example.org/Person" }
    ]
  }
}
```

```bash
npx --yes @theodi/data-standard-validator -s person-shape.ttl --csv-metadata csv-metadata.json people.csv
```

```text
person-shape.ttl · 1 document(s)

people.csv -> fails
  in row 2
    x Missing required field name
      at row 2, name  line 3
      Add `name`: The person's full name.
    x age must be at least 0 - you gave -1
      at row 2, age  line 3
          3 | ,-1
            |  ^^

2 problems
  1 required field missing, 1 out of range
```

## Both at once

Give the metadata, and pass both documents. Each is read by its extension, and
one report covers them:

```bash
npx --yes @theodi/data-standard-validator -s person-shape.ttl --csv-metadata csv-metadata.json person.json people.csv
```

```text
person-shape.ttl · 2 document(s)

person.json -> fails
  in Person
    x Missing required field name
      at name  line 1
      Add `name`: The person's full name.
    x age must be at least 0 - you gave -1
      at age  line 9
          9 |   "age": -1
            |          ^^

people.csv -> fails
  in row 2
    x Missing required field name
      at row 2, name  line 3
      Add `name`: The person's full name.
    x age must be at least 0 - you gave -1
      at row 2, age  line 3
          3 | ,-1
            |  ^^

4 problems
  2 required field missing, 2 out of range
```

## As JSON

Add `--format json` to get the report as data, for programs and web pages. The
fields are described in [Report format](report-format.md), which also shows
the same issue from the CSV file.

```bash
npx --yes @theodi/data-standard-validator -s person-shape.ttl person.json --format json
```

```json
{
  "setup": {
    "shapes": [
      "person-shape.ttl"
    ],
    "warnings": []
  },
  "documents": [
    {
      "document": "person.json",
      "conforms": false,
      "counts": {
        "violation": 2,
        "warning": 0,
        "info": 0
      },
      "issues": [
        {
          "severity": "violation",
          "code": "required-field-missing",
          "title": "Missing required field `name`",
          "hint": "Add `name`: The person's full name.",
          "location": {
            "jsonPath": "name",
            "pointer": "/name",
            "line": 1,
            "column": 1,
            "endLine": 10,
            "endColumn": 2,
            "nodeType": "Person",
            "document": "person.json"
          },
          "field": {
            "term": "name",
            "iri": "https://example.org/name"
          },
          "technical": {
            "focusNode": "(anonymous node at $)",
            "resultPath": "https://example.org/name",
            "sourceShape": "n3-0",
            "constraint": "MinCountConstraintComponent"
          }
        },
        {
          "severity": "violation",
          "code": "out-of-range",
          "title": "`age` must be at least 0 - you gave `-1`",
          "location": {
            "jsonPath": "age",
            "pointer": "/age",
            "line": 9,
            "column": 10,
            "endLine": 9,
            "endColumn": 12,
            "nodeType": "Person",
            "document": "person.json"
          },
          "field": {
            "term": "age",
            "iri": "https://example.org/age"
          },
          "value": "-1",
          "technical": {
            "focusNode": "(anonymous node at $)",
            "resultPath": "https://example.org/age",
            "sourceShape": "n3-1",
            "constraint": "MinInclusiveConstraintComponent"
          }
        }
      ]
    }
  ],
  "crossChecks": [],
  "conforms": false,
  "counts": {
    "violation": 2,
    "warning": 0,
    "info": 0
  }
}
```

## As Markdown

Add `--format markdown` for GitHub job summaries and pull request comments.
Here it is for both documents at once:

```bash
npx --yes @theodi/data-standard-validator -s person-shape.ttl --csv-metadata csv-metadata.json person.json people.csv --format markdown
```

````markdown
# person-shape.ttl

❌ **Failed** - 4 problems

| Document | Result | Problems | Warnings |
| --- | --- | ---: | ---: |
| person.json | ❌ fails | 2 | 0 |
| people.csv | ❌ fails | 2 | 0 |

## person.json

### Person

- ❌ Missing required field `name`
  - at `name`, line 1:1
  - Add `name`: The person's full name.
- ❌ `age` must be at least 0 - you gave `-1`
  - at `age`, line 9:10

## people.csv

### row 2

- ❌ Missing required field `name`
  - at `row 2, name`, line 3:1
  - Add `name`: The person's full name.
- ❌ `age` must be at least 0 - you gave `-1`
  - at `row 2, age`, line 3:2
````
