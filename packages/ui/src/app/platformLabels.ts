import type { OperatingSystem, PlatformKind } from '@pigeon/platform';

export const PLATFORM_KIND_LABELS: Record<PlatformKind, string> = {
  desktop: 'Desktop',
  web: 'Web',
  node: 'Node',
  memory: 'Memory (test)',
};

export const OS_LABELS: Record<OperatingSystem, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  unknown: 'Unknown OS',
};
