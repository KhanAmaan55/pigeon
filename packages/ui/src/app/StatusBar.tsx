/** Platform, transport and project status arrive with PIGN-004 and later stories. */
export function StatusBar() {
  return (
    <footer
      data-testid="status-bar"
      className="flex h-statusbar shrink-0 items-center gap-3 border-t border-border bg-surface-raised px-3 text-xs text-fg-muted"
    />
  );
}
