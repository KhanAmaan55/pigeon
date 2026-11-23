/**
 * Runs registered commands (PIGN-042): components provide handlers with `useCommand`; one
 * `keydown` listener matches the bindings of `COMMANDS` and runs the most recently registered
 * handler. A handler returning `false` didn't handle the key (it is then left to the page).
 */

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';

import type { CommandId } from './commands';
import { bindingsOf, commandForEvent, COMMANDS_BY_ID, matchesBinding } from './commands';

type Handler = () => void | boolean;

export interface CommandRegistry {
  /** Runs `id`; false when no handler is registered or it didn't handle it. */
  run(id: CommandId): boolean;
  /** Whether a handler is registered for `id` now. */
  has(id: CommandId): boolean;
  register(id: CommandId, handler: { current: Handler }): () => void;
}

function createRegistry(): CommandRegistry {
  const handlers = new Map<CommandId, Array<{ current: Handler }>>();
  return {
    run(id) {
      const handler = handlers.get(id)?.at(-1);
      if (!handler) return false;
      return handler.current() !== false;
    },
    has(id) {
      return (handlers.get(id)?.length ?? 0) > 0;
    },
    register(id, handler) {
      const list = handlers.get(id) ?? [];
      handlers.set(id, [...list, handler]);
      return () => {
        const current = handlers.get(id) ?? [];
        handlers.set(
          id,
          current.filter((h) => h !== handler),
        );
      };
    },
  };
}

const RegistryContext = createContext<CommandRegistry | null>(null);

export function CommandsProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => createRegistry(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = commandForEvent(event);
      if (!command || !registry.has(command.id)) return;
      if (registry.run(command.id)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registry]);

  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

/** The registry (`null` outside a provider, e.g. in component tests). */
export function useCommandRegistry(): CommandRegistry | null {
  return useContext(RegistryContext);
}

/**
 * Provides the handler of `id` while the component is mounted (`undefined`: none, e.g. while
 * the action isn't available). The latest handler is used without re-registering.
 */
export function useCommand(id: CommandId, handler: Handler | undefined): void {
  const registry = useContext(RegistryContext);
  const ref = useRef<Handler>(() => false);
  useEffect(() => {
    ref.current = handler ?? (() => false);
  });
  const active = handler !== undefined;
  useEffect(() => {
    if (!active) return;
    if (registry) return registry.register(id, ref);
    // Outside a provider (a component rendered on its own): bind the keys directly.
    const command = COMMANDS_BY_ID.get(id);
    if (!command || command.local) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!bindingsOf(command).some((binding) => matchesBinding(event, binding))) return;
      if (ref.current() !== false) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registry, id, active]);
}
