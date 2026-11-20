export const PACKAGE_NAME = '@pigeon/formats';

export { stringifyCanonical } from './canonical-json';
export type { CanonicalJsonOptions, KeyOrderPath, KeyOrderSpec } from './canonical-json';
export { sha256Hex } from './hash';
export { PROJECT_KEY_ORDERS, createProjectKeyOrder } from './project/key-order';
export type { ProjectFileKind } from './project/key-order';
export {
  collectionVariableFromPostman,
  collectionVariableToPostman,
  environmentFromPostman,
  environmentToPostman,
  globalsFromPostman,
  globalsToPostman,
  variableFromPostman,
  variableToPostman,
  VOLATILE_ENVIRONMENT_KEYS,
} from './postman/environment';
export { authFromPostman, authToPostman, authTypeLabel } from './postman/auth';
export {
  bodyFromPostman,
  bodyToPostman,
  keyValueFromPostman,
  keyValueToPostman,
  requestFromPostmanItem,
  requestToPostmanItem,
  urlFromPostman,
  urlToPostman,
} from './postman/item';
export { createEmptyProject } from './project/create';
export { isManagedPath, isProjectFile } from './project/managed';
export { CURRENT_FORMAT_VERSION, GLOBALS_PATH, readProject } from './project/reader';
export { COLLECTION_SCHEMA } from './project/schemas';
export { encodeFile, serializeProject } from './project/writer';
export type {
  AuthType,
  Collection,
  Description,
  EmptyProject,
  ExtraFields,
  Folder,
  Problem,
  ProjectAuth,
  ProjectBody,
  ProjectEnvironment,
  ProjectEnvVariable,
  ProjectEvent,
  ProjectGlobals,
  ProjectFormDataParam,
  ProjectItem,
  ProjectKeyValue,
  ProjectModel,
  ProjectReadResult,
  ProjectRequest,
  ProjectRequestSettings,
  ProjectUrl,
  ProjectVariable,
  RawLanguage,
} from './project/types';
export { allocateSlug, slugify } from './slug';
export type { SlugOptions } from './slug';
