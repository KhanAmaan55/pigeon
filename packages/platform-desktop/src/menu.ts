import { listen } from '@tauri-apps/api/event';

/**
 * Native menu commands (apps/desktop/src-tauri/src/menu.rs emits `pigeon:menu` with a command
 * id). Returns a function that stops listening.
 */
export async function onMenuCommand(handler: (command: string) => void): Promise<() => void> {
  return listen<string>('pigeon:menu', (event) => handler(event.payload));
}
