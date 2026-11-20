import type { VariableScopes } from '@pigeon/core';
import { EMPTY_SCOPES } from '@pigeon/core';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

const VariablesContext = createContext<VariableScopes>(EMPTY_SCOPES);

/** The variables editors highlight against: the active project's selected environment, etc. */
export function VariablesProvider({
  scopes,
  children,
}: {
  scopes: VariableScopes;
  children: ReactNode;
}) {
  return <VariablesContext.Provider value={scopes}>{children}</VariablesContext.Provider>;
}

export function useVariableScopes(): VariableScopes {
  return useContext(VariablesContext);
}
