/**
 * Project entities (docs/data-model.md §3–4). Their file mapping lives in `@pigeon/formats`, which
 * may not depend on core, so the types are defined there and re-exported here. Core's `Request`
 * (the editor model) is structurally a `ProjectRequest` without auth/events/broken; see
 * `test/model.test.ts`.
 */
export type {
  Collection,
  Folder,
  Problem,
  ProjectItem,
  ProjectModel,
  ProjectEnvironment,
  ExampleBody,
  ExampleBodyFormat,
  OrphanExample,
  ProjectExample,
  RequestExample,
  ResponseExample,
  ProjectEnvVariable,
  ProjectReadResult,
  ProjectRequest,
} from '@pigeon/formats';
