import type { Capabilities } from '@pigeon/platform';

import { OS_LABELS, PLATFORM_KIND_LABELS } from '../../app/platformLabels';
import { usePlatform } from '../../app/PlatformProvider';

/** Settings → About / Diagnostics: platform kind, OS and every capability value. */
export function Diagnostics() {
  const platform = usePlatform();
  const capabilities = Object.entries(platform.capabilities) as Array<
    [keyof Capabilities, Capabilities[keyof Capabilities]]
  >;

  return (
    <section
      aria-labelledby="diagnostics-title"
      data-testid="diagnostics-panel"
      className="p-3 text-sm"
    >
      <h2 id="diagnostics-title" className="mb-2 font-semibold">
        About / Diagnostics
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <Row
          name="Platform"
          value={PLATFORM_KIND_LABELS[platform.kind]}
          testId="diagnostics-kind"
        />
        <Row name="OS" value={OS_LABELS[platform.os]} testId="diagnostics-os" />
      </dl>
      <h3 className="mt-4 mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        Capabilities
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
        {capabilities.map(([name, value]) => (
          <Row key={name} name={name} value={String(value)} testId={`capability-${name}`} />
        ))}
      </dl>
    </section>
  );
}

function Row({ name, value, testId }: { name: string; value: string; testId: string }) {
  return (
    <>
      <dt className="text-fg-muted">{name}</dt>
      <dd data-testid={testId} className="min-w-0 break-words">
        {value}
      </dd>
    </>
  );
}
