/** Test-only entry point (`@pigeon/platform/conformance`); imports Vitest, so never import it from app code. */
export type { FsConformanceOptions } from './fs';
export { fsConformance } from './fs';
export type { TransportConformanceOptions } from './transport';
export { transportConformance } from './transport';
export type { TransportConformanceCase, TransportConformanceContext } from './transport-cases';
export { transportConformanceCases } from './transport-cases';
