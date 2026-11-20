# Postman Collection v2.1.0 schema

`collection-v2.1.0.json` is a **reconstruction** of the published Postman Collection Format
v2.1.0 JSON Schema (https://schema.getpostman.com/json/collection/v2.1.0/collection.json),
rewritten as JSON Schema draft-07 so `ajv` validates exports in tests (PIGN-029). It follows the
official definitions (info, item, item-group, request, url, header, body modes, auth types,
event/script, variable, response, cookie); unknown keys are allowed, as in the original.

Replace it with the official file (converted to draft-07) when vendoring it verbatim.
