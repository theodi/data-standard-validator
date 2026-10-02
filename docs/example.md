# Example

One shape, one document with two problems, and the report in each of the
three output formats.

## The inputs

A shape, `person-shape.ttl`, that says a person needs a name and an age of
zero or more:

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

And a document, `person.json`, that breaks both rules:

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

## Text

The default, for terminals:

```bash
npx @theodi/data-standard-validator -s person-shape.ttl person.json
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

## JSON

Add `--format json` to get the same report as data, for programs and web
pages. The fields are described in [Report format](report-format.md).

```bash
npx @theodi/data-standard-validator -s person-shape.ttl person.json --format json
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

## Markdown

Add `--format markdown` for GitHub job summaries and pull request comments:

```bash
npx @theodi/data-standard-validator -s person-shape.ttl person.json --format markdown
```

````markdown
# person-shape.ttl

❌ **Failed** - 2 problems

| Document | Result | Problems | Warnings |
| --- | --- | ---: | ---: |
| person.json | ❌ fails | 2 | 0 |

## person.json

### Person

- ❌ Missing required field `name`
  - at `name`, line 1:1
  - Add `name`: The person's full name.
- ❌ `age` must be at least 0 - you gave `-1`
  - at `age`, line 9:10
````
