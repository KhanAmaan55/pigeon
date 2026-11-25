/**
 * `INSTRUCTIONS.md` (PIGN-060): written once when a project is created, then the user's. It tells
 * people and AI assistants how to read, create and edit the project files by hand. The JSON
 * examples are real files: `test/instructions.test.ts` writes them into a project and reads it
 * back, so the guide can't drift from what Pigeon accepts.
 */

export const INSTRUCTIONS_FILE = 'INSTRUCTIONS.md';

const fence = '```';

/** The guide for a new project named `name`. */
export function projectInstructions(name: string): string {
  const title = name.trim() || 'Untitled project';
  return `# ${title} — Pigeon project

This folder is a Pigeon project: API requests, environments and saved responses kept as plain JSON files, so they can be reviewed and versioned with Git like code.

This file explains the format for developers and AI assistants who want to read, create or edit the files directly. Pigeon wrote it once when the project was created and never touches it again: edit it, extend it with your own conventions, or delete it. Pigeon ignores it.

## Rules (read these first)

1. **Only the files in [Files Pigeon reads](#files-pigeon-reads) matter.** Everything else in this folder (this file, READMEs, scripts) is ignored, never modified, never deleted.
2. **Valid JSON, UTF-8, LF line endings.** Use 2-space indentation and a final newline. Formatting doesn't have to be perfect: Pigeon rewrites a file in its canonical layout the next time it saves that item.
3. **Every collection, folder and request has a unique \`id\`** (collections: \`info._postman_id\`). Use a new random UUID v4 for anything you create. Never change or reuse an existing id: drafts, history and saved examples are linked to items by id.
4. **File and directory names are slugs** made from the item's name: lowercase \`a-z\`, \`0-9\` and \`-\`, at most 48 characters, unique within their directory ("List users" → \`list-users\`). Requests and folders share one namespace per directory.
5. **New files need no registration.** Items missing from an \`order\` list (and collections missing from \`pigeon.json\`) are still loaded, appended alphabetically. Add them to the list only to choose their position.
6. **No secrets in files.** Write \`{{token}}\` instead of a token, and mark the environment variable \`"type": "secret"\` with an empty value. Each person enters secret values in Pigeon; they are stored on their machine, never in this folder.
7. **Check your work** with the Pigeon CLI (\`pigeon validate .\`, exit code 0 when every file is valid) or by opening the project in Pigeon. A file that doesn't parse is shown with its error and is never overwritten.

## Layout

${fence}text
pigeon.json                                 project manifest: id, name, collection order
.gitattributes                              line endings for Git (written once)
collections/
  <collection>/
    collection.json                         collection: name, auth, scripts, variables, child order
    <request>.request.json                  one request
    <folder>/
      folder.json                           folder: name, auth, scripts, child order
      <request>.request.json
environments/
  <environment>.postman_environment.json    variables per stage (local, staging, …)
  globals.postman_globals.json              project-wide variables (optional)
examples/
  <collection>/<folder>/…/<request>/        mirrors collections/, one directory per request
    <example>.example.json                  a saved response (baseline for comparison)
    <example>.body.json                     its body (.json, .xml, .html, .txt, .js or .bin)
    compare.json                            comparison settings for this request (optional)
${fence}

## Files Pigeon reads

| Path | Contents |
|---|---|
| \`pigeon.json\` | \`id\`, \`name\`, \`pigeon.formatVersion\` (1), \`collections\` (order of collection directories), comparison defaults |
| \`collections/*/collection.json\` | Postman v2.1 collection \`info\`, \`auth\`, \`event\` (scripts), \`variable\`, \`_pigeon.order\` |
| \`collections/**/folder.json\` | \`id\`, \`name\`, \`description\`, \`auth\`, \`event\`, \`variable\`, \`_pigeon.order\` |
| \`collections/**/*.request.json\` | One Postman v2.1 item without \`response\`: \`id\`, \`name\`, \`request\`, \`event\` |
| \`environments/*.postman_environment.json\` | Postman environment: \`id\`, \`name\`, \`values\` |
| \`environments/globals.postman_globals.json\` | Postman globals, same shape |
| \`examples/**/*.example.json\` + \`*.body.*\` | Postman response with its body in a sidecar file |
| \`examples/**/compare.json\` | Comparison rules for one request |

Files use Postman v2.1 field names, so Postman's documentation applies. Pigeon-only data sits under a \`_pigeon\` key.

## Add a request

File \`collections/example-api/list-users.request.json\`:

${fence}json
{
  "id": "6b0f7c3e-8d1a-4b2c-9e5f-1a2b3c4d5e6f",
  "name": "List users",
  "request": {
    "method": "GET",
    "header": [{ "key": "Accept", "value": "application/json" }],
    "url": {
      "raw": "{{baseUrl}}/users?limit=20",
      "query": [{ "key": "limit", "value": "20" }]
    },
    "description": "Returns a page of users."
  },
  "event": [
    {
      "listen": "test",
      "script": {
        "type": "text/javascript",
        "exec": ["pm.test('status is 200', () => pm.response.to.have.status(200));"]
      }
    }
  ]
}
${fence}

- \`url.raw\` is the source of truth. Keep \`url.query\` in step with the query string; path variables (\`/users/:id\`) go in \`url.variable\` as \`[{ "key": "id", "value": "42" }]\`. Leave out \`host\`, \`path\`, \`protocol\` and \`port\`.
- Optional: \`request.body\`, \`request.auth\`, \`protocolProfileBehavior\` (e.g. \`{ "followRedirects": false }\`), \`_pigeon.timeoutMs\`.
- Disable a header or query parameter with \`"disabled": true\` instead of deleting it.

### Bodies

${fence}text
JSON / text:  "body": { "mode": "raw", "raw": "{\\n  \\"name\\": \\"Ada\\"\\n}", "options": { "raw": { "language": "json" } } }
Form:         "body": { "mode": "urlencoded", "urlencoded": [{ "key": "name", "value": "Ada" }] }
Multipart:    "body": { "mode": "formdata", "formdata": [{ "key": "file", "type": "file", "src": "fixtures/avatar.png" }] }
GraphQL:      "body": { "mode": "graphql", "graphql": { "query": "{ me { id } }", "variables": "{}" } }
File:         "body": { "mode": "file", "file": { "src": "fixtures/payload.bin" } }
${fence}

File paths in bodies are relative to this folder. \`language\` can be \`json\`, \`text\`, \`xml\`, \`html\` or \`javascript\`.

### Auth

Requests and folders without \`auth\` inherit it from their folder, then their collection. \`{ "type": "noauth" }\` stops inheritance.

${fence}text
Bearer:   "auth": { "type": "bearer", "bearer": [{ "key": "token", "value": "{{token}}", "type": "string" }] }
Basic:    "auth": { "type": "basic", "basic": [{ "key": "username", "value": "{{user}}" }, { "key": "password", "value": "{{password}}" }] }
API key:  "auth": { "type": "apikey", "apikey": [{ "key": "key", "value": "X-Api-Key" }, { "key": "value", "value": "{{apiKey}}" }, { "key": "in", "value": "header" }] }
${fence}

Pigeon also sends \`digest\`, \`oauth2\` and \`awsv4\` (AWS Signature v4) in Postman's shape. Other types are kept but sent without auth.

### Scripts

\`event\` holds \`prerequest\` and \`test\` scripts, one line of JavaScript per \`exec\` element. They run in a sandbox with Postman's \`pm\` API (\`pm.environment\`, \`pm.variables\`, \`pm.request\`, \`pm.response\`, \`pm.test\`, \`pm.expect\`). Not available: \`pm.sendRequest\`, \`pm.cookies\`, \`pm.vault\`, \`pm.execution\`, \`postman.setNextRequest\`, \`pm.visualizer\` and \`require()\`.

## Add a folder

Create a directory inside the collection with \`folder.json\`, then put requests (or more folders) in it. File \`collections/example-api/admin/folder.json\`:

${fence}json
{
  "id": "0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a",
  "name": "Admin",
  "description": "Admin-only endpoints",
  "_pigeon": { "order": [] }
}
${fence}

\`_pigeon.order\` lists child slugs (requests without \`.request.json\`, folders by directory name). An empty or partial list is fine.

## Add a collection

Create \`collections/<slug>/collection.json\`, and add the slug to \`collections\` in \`pigeon.json\` to place it (optional). File \`collections/example-api/collection.json\`:

${fence}json
{
  "info": {
    "_postman_id": "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f",
    "name": "Example API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "auth": { "type": "bearer", "bearer": [{ "key": "token", "value": "{{token}}", "type": "string" }] },
  "variable": [{ "key": "apiVersion", "value": "v1" }],
  "_pigeon": { "order": ["list-users", "admin"] }
}
${fence}

## Environments and variables

Use \`{{name}}\` in URLs, headers, params, bodies and auth fields. When a name is defined in several places, the first match wins: environment → collection (a folder's variables override its collection's for the items inside) → globals. Scripts can also set variables while a request runs.

File \`environments/local.postman_environment.json\`:

${fence}json
{
  "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "name": "Local",
  "values": [
    { "key": "baseUrl", "value": "http://localhost:3000", "type": "default", "enabled": true },
    { "key": "token", "value": "", "type": "secret", "enabled": true }
  ],
  "_postman_variable_scope": "environment"
}
${fence}

The \`value\` here is the **shared value** everyone gets from Git. Each person's own **current value** (and every secret) stays in Pigeon on their machine. Globals use the same shape in \`environments/globals.postman_globals.json\` with \`"_postman_variable_scope": "globals"\`.

## Examples and comparison

An example is a saved response for a request. Pigeon compares new responses with the request's baseline example (status, headers, body shape) and reports differences. The directory under \`examples/\` mirrors the request's path under \`collections/\`, with the request's slug as the last directory.

File \`examples/example-api/list-users/200-ok.example.json\`:

${fence}json
{
  "id": "5f4e3d2c-1b0a-4f9e-8d7c-6b5a4f3e2d1c",
  "name": "200 OK",
  "originalRequest": {
    "method": "GET",
    "header": [{ "key": "Accept", "value": "application/json" }],
    "url": { "raw": "{{baseUrl}}/users?limit=20", "query": [{ "key": "limit", "value": "20" }] }
  },
  "status": "OK",
  "code": 200,
  "_postman_previewlanguage": "json",
  "header": [{ "key": "Content-Type", "value": "application/json; charset=utf-8" }],
  "cookie": [],
  "_pigeon": { "requestId": "6b0f7c3e-8d1a-4b2c-9e5f-1a2b3c4d5e6f", "bodyFile": "200-ok.body.json" }
}
${fence}

\`_pigeon.requestId\` is the \`id\` of the request; \`bodyFile\` names the body file next to it (\`examples/example-api/list-users/200-ok.body.json\`, pretty-printed JSON). Leave out \`bodyFile\` for a response without a body. Optional \`compare.json\` in the same directory tunes the comparison, for example \`{ "pigeonCompare": 1, "requestId": "6b0f7c3e-8d1a-4b2c-9e5f-1a2b3c4d5e6f", "rules": [{ "path": "$.meta.generatedAt", "ignore": true }] }\`.

## Not in these files

Unsaved edits and local drafts, current variable values, secrets, open tabs, the selected environment, request history and last responses live in Pigeon's app data on each machine, never in this folder.

## Editing while Pigeon is open

The desktop app picks up file changes right away; the web app does on window focus or **Refresh**. If you change an item that has unsaved or saved-but-uncommitted edits in Pigeon, Pigeon shows a conflict for it with **Keep mine**, **Take theirs** and **Compare**.
`;
}
