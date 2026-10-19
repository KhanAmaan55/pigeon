/** Sidebar views selectable from the activity bar (docs/ui-ux.md §2). */
export type SidebarView = 'collections' | 'environments' | 'pending' | 'runner' | 'settings';

export const SIDEBAR_VIEW_TITLES: Record<SidebarView, string> = {
  collections: 'Collections',
  environments: 'Environments',
  pending: 'Pending Changes',
  runner: 'Runner',
  settings: 'Settings',
};
