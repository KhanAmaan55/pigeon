import { useId } from 'react';

import { useCapabilities, usePlatform } from '../../app/PlatformProvider';
import { bindingLabel, COMMANDS } from '../command-palette/commands';

/**
 * Settings → Keyboard (PIGN-042): every command's shortcuts for this platform (read-only for
 * now), with the alternatives browsers need where they keep a key for themselves.
 */
export function KeyboardSettings() {
  const mac = usePlatform().os === 'macos';
  const web = useCapabilities().transport === 'fetch';
  const id = useId();
  const bound = COMMANDS.filter((c) => c.bindings.length > 0 || c.webBindings?.length);
  return (
    <section
      id="settings-keyboard"
      aria-labelledby={`${id}-title`}
      data-testid="keyboard-settings"
      className="border-b border-border/60 p-4 text-sm"
    >
      <h2 id={`${id}-title`} className="mb-3 text-xs font-medium text-fg-muted">
        Keyboard
      </h2>
      <table className="w-full text-xs" aria-label="Keyboard shortcuts">
        <thead className="sr-only">
          <tr>
            <th>Command</th>
            <th>Shortcut</th>
          </tr>
        </thead>
        <tbody>
          {bound.map((command) => {
            const primary = command.bindings.map((b) => bindingLabel(b, mac));
            const alternatives = (command.webBindings ?? []).map((b) => bindingLabel(b, mac));
            return (
              <tr key={command.id} data-testid="keyboard-binding" data-command={command.id}>
                <td className="py-1 pr-3">{command.title}</td>
                <td className="py-1 text-right font-mono whitespace-nowrap text-fg-muted">
                  {(web && alternatives.length > 0
                    ? [...alternatives, ...primary.map((p) => `${p} (desktop)`)]
                    : [...primary, ...alternatives]
                  ).join(' / ')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-fg-muted">
        Open the command palette ({bindingLabel({ key: 'KeyK', mod: true }, mac)}) to run any
        command.
      </p>
    </section>
  );
}
