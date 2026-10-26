/**
 * Modal prompts rendered by the platform (native dialogs on desktop). File and folder pickers
 * live in `FileExchange` and `ProjectLocator`.
 */

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label of the accepting button (default "OK"). */
  confirmLabel?: string;
  /** Styles the accepting button as dangerous (delete, discard). */
  destructive?: boolean;
}

export interface MessageOptions {
  title: string;
  message: string;
  kind?: 'info' | 'warning' | 'error';
}

export interface Dialogs {
  /** Resolves `true` when the user accepts. */
  confirm(opts: ConfirmOptions): Promise<boolean>;
  message(opts: MessageOptions): Promise<void>;
}
