/**
 * App commands that arrive from outside the React tree (PIGN-041): the desktop menus dispatch
 * `pigeon:command` DOM events whose `detail` is a command id. Keep the ids in step with
 * `UI_COMMANDS` in apps/desktop/src-tauri/src/menu.rs.
 */
export const COMMAND_EVENT = 'pigeon:command';

export type AppCommand =
  | 'new-request'
  | 'open-project'
  | 'import'
  | 'export-project'
  | 'close-project'
  | 'toggle-sidebar'
  | 'toggle-response-layout'
  | 'web-limitations';

export function runAppCommand(command: AppCommand): void {
  window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: command }));
}
