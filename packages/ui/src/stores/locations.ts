import type { ProjectLocation } from '@pigeon/platform';

/** Stable identity of a project location (recent-project de-duplication). */
export function locationKey(location: ProjectLocation): string {
  switch (location.kind) {
    case 'native':
      return `native:${location.absolutePath}`;
    case 'fs-access':
      return `fs-access:${location.handleKey}`;
    case 'browser-workspace':
      return `browser-workspace:${location.workspaceId}`;
    case 'memory':
      return `memory:${location.id}`;
  }
}

/** What the user sees for a location: the full folder path on desktop, a name elsewhere. */
export function locationLabel(location: ProjectLocation): string {
  switch (location.kind) {
    case 'native':
      return location.absolutePath;
    case 'fs-access':
      return `${location.name} (folder)`;
    case 'browser-workspace':
      return `${location.name} (browser workspace)`;
    case 'memory':
      return 'In-memory project';
  }
}

/** Folder name of a location, used to suggest a project name. */
export function locationFolderName(location: ProjectLocation): string {
  switch (location.kind) {
    case 'native': {
      const segments = location.absolutePath.split(/[\\/]+/).filter(Boolean);
      return segments.at(-1) ?? '';
    }
    case 'fs-access':
    case 'browser-workspace':
      return location.name;
    case 'memory':
      return '';
  }
}
