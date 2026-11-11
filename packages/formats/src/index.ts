export const PACKAGE_NAME = '@pigeon/formats';

export { stringifyCanonical } from './canonical-json';
export type { CanonicalJsonOptions, KeyOrderPath, KeyOrderSpec } from './canonical-json';
export { sha256Hex } from './hash';
export { PROJECT_KEY_ORDERS, createProjectKeyOrder } from './project/key-order';
export type { ProjectFileKind } from './project/key-order';
export { allocateSlug, slugify } from './slug';
export type { SlugOptions } from './slug';
