/** Sidebar views selectable from the activity bar (docs/ui-ux.md §2). */
export type SidebarView =
  'collections' | 'environments' | 'history' | 'pending' | 'runner' | 'settings';

export const SIDEBAR_VIEW_TITLES: Record<SidebarView, string> = {
  collections: 'Collections',
  environments: 'Environments',
  history: 'History',
  pending: 'Pending Changes',
  runner: 'Runner',
  settings: 'Settings',
};
