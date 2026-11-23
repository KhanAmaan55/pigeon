/**
 * The command registry (docs/ui-ux.md §4, PIGN-042): every keyboard-reachable action with its
 * title, category and per-platform bindings. Components provide the handlers (`useCommand`);
 * one key dispatcher (`CommandsProvider`) runs them, the palette lists them and Settings →
 * Keyboard shows the bindings.
 */

export type CommandId =
  | 'request.send'
  | 'request.cancel'
  | 'request.new'
  | 'file.save'
  | 'file.saveForCommit'
  | 'file.import'
  | 'palette.open'
  | 'quickOpen.open'
  | 'tab.close'
  | 'tab.next'
  | 'tab.previous'
  | 'environment.switch'
  | 'url.focus'
  | 'view.toggleResponseLayout'
  | 'view.toggleSidebar'
  | 'project.next'
  | 'project.previous'
  | 'project.open'
  | 'project.close'
  | 'project.export'
  | 'help.webLimitations'
  | 'settings.keyboard';

export type CommandCategory = 'Request' | 'File' | 'Tabs' | 'View' | 'Project' | 'Help';

/**
 * A key combination. `key` is a `KeyboardEvent.code` (layout-independent: Alt changes `key` on
 * macOS). `mod` is Cmd on macOS and Ctrl elsewhere (either is accepted, as before); `ctrl` is
 * the Control key on every platform (Ctrl+Tab).
 */
export interface KeyBinding {
  key: string;
  mod?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface CommandDefinition {
  id: CommandId;
  title: string;
  category: CommandCategory;
  bindings: KeyBinding[];
  /**
   * Extra bindings for browsers, where the primary one is reserved (Cmd/Ctrl+W, Cmd/Ctrl+N,
   * Ctrl+Tab). They work on desktop too.
   */
  webBindings?: KeyBinding[];
  /** Handled by the component itself (e.g. only while focus is in the request editor). */
  local?: boolean;
}

const mod = (key: string, extra: Omit<KeyBinding, 'key' | 'mod'> = {}): KeyBinding => ({
  key,
  mod: true,
  ...extra,
});

export const COMMANDS: readonly CommandDefinition[] = [
  {
    id: 'request.send',
    title: 'Send request',
    category: 'Request',
    bindings: [mod('Enter')],
    local: true,
  },
  {
    id: 'request.cancel',
    title: 'Cancel request',
    category: 'Request',
    bindings: [{ key: 'Escape' }],
    local: true,
  },
  {
    id: 'request.new',
    title: 'New request',
    category: 'Request',
    bindings: [mod('KeyN')],
    webBindings: [{ key: 'KeyN', alt: true }],
  },
  { id: 'url.focus', title: 'Focus URL', category: 'Request', bindings: [mod('KeyL')] },
  { id: 'file.save', title: 'Save', category: 'File', bindings: [mod('KeyS')] },
  {
    id: 'file.saveForCommit',
    title: 'Save for Commit',
    category: 'File',
    bindings: [mod('KeyS', { shift: true })],
  },
  { id: 'file.import', title: 'Import…', category: 'File', bindings: [mod('KeyO')] },
  {
    id: 'palette.open',
    title: 'Command palette',
    category: 'View',
    bindings: [mod('KeyK'), mod('KeyP', { shift: true })],
  },
  {
    id: 'quickOpen.open',
    title: 'Quick open request',
    category: 'View',
    bindings: [mod('KeyP')],
  },
  {
    id: 'tab.close',
    title: 'Close tab',
    category: 'Tabs',
    bindings: [mod('KeyW')],
    webBindings: [{ key: 'KeyW', alt: true }],
  },
  {
    id: 'tab.next',
    title: 'Next tab',
    category: 'Tabs',
    bindings: [{ key: 'Tab', ctrl: true }],
    webBindings: [{ key: 'BracketRight', alt: true }],
  },
  {
    id: 'tab.previous',
    title: 'Previous tab',
    category: 'Tabs',
    bindings: [{ key: 'Tab', ctrl: true, shift: true }],
    webBindings: [{ key: 'BracketLeft', alt: true }],
  },
  {
    id: 'environment.switch',
    title: 'Switch environment',
    category: 'Project',
    bindings: [mod('KeyE')],
  },
  {
    id: 'view.toggleResponseLayout',
    title: 'Toggle response layout',
    category: 'View',
    bindings: [mod('KeyL', { alt: true })],
  },
  { id: 'view.toggleSidebar', title: 'Toggle sidebar', category: 'View', bindings: [] },
  {
    id: 'project.next',
    title: 'Next project',
    category: 'Project',
    bindings: [mod('ArrowRight', { alt: true })],
  },
  {
    id: 'project.previous',
    title: 'Previous project',
    category: 'Project',
    bindings: [mod('ArrowLeft', { alt: true })],
  },
  { id: 'project.open', title: 'Open project…', category: 'Project', bindings: [] },
  { id: 'project.close', title: 'Close project', category: 'Project', bindings: [] },
  { id: 'project.export', title: 'Export project…', category: 'Project', bindings: [] },
  { id: 'help.webLimitations', title: 'Web limitations', category: 'Help', bindings: [] },
  { id: 'settings.keyboard', title: 'Keyboard shortcuts', category: 'Help', bindings: [] },
];

export const COMMANDS_BY_ID: ReadonlyMap<CommandId, CommandDefinition> = new Map(
  COMMANDS.map((command) => [command.id, command]),
);

/** The modifiers a key event has, for exact matching. */
interface EventLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function matchesBinding(event: EventLike, binding: KeyBinding): boolean {
  if (event.code !== binding.key) return false;
  if (event.shiftKey !== (binding.shift ?? false)) return false;
  if (event.altKey !== (binding.alt ?? false)) return false;
  if (binding.ctrl) return event.ctrlKey && !event.metaKey;
  if (binding.mod) return event.metaKey || event.ctrlKey;
  return !event.metaKey && !event.ctrlKey;
}

/** Every binding of `command` (the browser alternatives work everywhere). */
export function bindingsOf(command: CommandDefinition): KeyBinding[] {
  return [...command.bindings, ...(command.webBindings ?? [])];
}

/** The command a key event triggers, if any (local commands excluded). */
export function commandForEvent(event: EventLike): CommandDefinition | undefined {
  return COMMANDS.find(
    (command) =>
      !command.local && bindingsOf(command).some((binding) => matchesBinding(event, binding)),
  );
}

const KEY_LABELS: Record<string, string> = {
  Enter: '↵',
  Escape: 'Esc',
  Tab: 'Tab',
  ArrowRight: '→',
  ArrowLeft: '←',
  BracketRight: ']',
  BracketLeft: '[',
};

/** `⌘⇧S` on macOS, `Ctrl+Shift+S` elsewhere. */
export function bindingLabel(binding: KeyBinding, mac: boolean): string {
  const key = KEY_LABELS[binding.key] ?? binding.key.replace(/^(Key|Digit)/, '');
  if (mac) {
    return `${binding.ctrl ? '⌃' : ''}${binding.alt ? '⌥' : ''}${binding.shift ? '⇧' : ''}${binding.mod ? '⌘' : ''}${key}`;
  }
  return [
    binding.ctrl || binding.mod ? 'Ctrl' : '',
    binding.alt ? 'Alt' : '',
    binding.shift ? 'Shift' : '',
    key === '↵' ? 'Enter' : key,
  ]
    .filter(Boolean)
    .join('+');
}

/**
 * Fuzzy match (case-insensitive subsequence): a score (higher is better) or `-1`. Consecutive
 * characters, word starts and an early first match score more; shorter texts break ties.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const t = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of q) {
    if (char === ' ') continue;
    const index = t.indexOf(char, from);
    if (index === -1) return -1;
    const wordStart = index === 0 || /[\s/._-]/.test(t[index - 1]!);
    score += 1 + (index === previous + 1 ? 5 : 0) + (wordStart ? 3 : 0);
    if (previous === -2) score += Math.max(0, 10 - index);
    previous = index;
    from = index + 1;
  }
  return score * 100 - t.length;
}
