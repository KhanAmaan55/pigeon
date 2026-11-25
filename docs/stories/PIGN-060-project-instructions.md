# PIGN-060 — INSTRUCTIONS.md in new projects

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-060 | 9 — Later | Later | Done | PIGN-014, PIGN-015 |

## Goal
Every new Pigeon project gets an `INSTRUCTIONS.md` that explains the file format, so developers and AI assistants can create or edit project files by hand correctly.

## User story
As a developer (or an AI assistant working in my repository), I want a guide inside the project folder, so I can add or change requests, environments and examples without opening the app or reading Pigeon's source.

## Scope
**In scope**
- `INSTRUCTIONS.md` written at project creation (Create project, new browser workspace, initialize a folder) with the project name as title; only when absent; user-owned afterwards.
- Content: rules first (valid JSON, UUID ids that never change, slugs, `order` optional, no secrets, how to validate), layout, the files Pigeon reads, how to add each kind of file with complete examples, bodies, auth, scripts, variables and precedence, examples and comparison, what is not in files, editing while Pigeon is open.
- Travels with zip export/import; not listed as a body file.

**Out of scope**
- Updating existing projects' guides automatically, or writing one into projects created before this story.

## Acceptance criteria
- [x] Creating or initializing a project writes `INSTRUCTIONS.md`, titled with the project name.
- [x] An existing `INSTRUCTIONS.md` (and `.gitattributes`) is kept when a folder is initialized.
- [x] Every example file in the guide is valid and loads into a project with no problems (test).
- [x] The file is part of zip export/import and not offered in the body file picker.
- [x] file-format.md describes it (§1, §1.1, §11); the init dialog mentions it.

## Implementation notes
- `formats/src/project/instructions.ts`: `INSTRUCTIONS_FILE`, `projectInstructions(name)`; added in `createEmptyProject`. `initializeProject` writes each non-managed creation file (`.gitattributes`, `INSTRUCTIONS.md`) only if absent.
- `isProjectFile` includes it (zip export/import); `listReferenceableFiles` now excludes every project file.
- Tests: `formats/test/instructions.test.ts` (title, LF, the guide's example files read back with no problems), `core/test/initialize.test.ts` (written; existing files kept), and the UI initialization test's file list.
