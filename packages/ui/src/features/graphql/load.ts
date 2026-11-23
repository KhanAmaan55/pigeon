/**
 * Loads the GraphQL runtime (graphql, graphql-language-service, cm6-graphql) on first use, as
 * its own chunk (PIGN-055): the app's initial bundle never contains the graphql package.
 */

import type * as Runtime from './runtime';

export type GraphqlRuntime = typeof Runtime;

let loading: Promise<GraphqlRuntime> | undefined;

export function loadGraphqlRuntime(): Promise<GraphqlRuntime> {
  loading ??= import('./runtime');
  return loading;
}
