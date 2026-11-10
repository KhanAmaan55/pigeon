import { fileNameFromSrc, isPickedFileSrc, pickedFileSrc } from '@pigeon/core';
import { FileUp, X } from 'lucide-react';
import { useRef } from 'react';

import { usePlatform } from '../../../app/PlatformProvider';

/**
 * A button opening the system file dialog (a hidden `<input type="file">`, which works in
 * browsers and in the desktop webview). Picked files are read into `Platform.pickedFiles` for
 * the session and reported as `picked:` sources (see `pickedFileSrc`).
 */
export function FilePicker({
  multiple = false,
  label,
  testId,
  onPicked,
}: {
  multiple?: boolean;
  label: string;
  /** `data-testid` of the file input (Playwright `setInputFiles`). */
  testId: string;
  onPicked: (sources: string[]) => void;
}) {
  const { pickedFiles } = usePlatform();
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = async (files: FileList | null) => {
    const sources: string[] = [];
    for (const file of Array.from(files ?? [])) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ref = pickedFiles.add({
        name: file.name,
        bytes,
        ...(file.type ? { mime: file.type } : {}),
      });
      sources.push(pickedFileSrc(ref.id, file.name));
    }
    // Let the same file be picked again (e.g. after it changed on disk).
    if (inputRef.current) inputRef.current.value = '';
    if (sources.length > 0) onPicked(sources);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        tabIndex={-1}
        aria-hidden
        data-testid={testId}
        className="sr-only"
        onChange={(event) => void onChange(event.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border px-2 text-xs text-fg hover:bg-hover"
      >
        <FileUp size={12} aria-hidden />
        {label}
      </button>
    </>
  );
}

/** A chosen file: its name, the full path on hover, and a remove button. */
export function FileChip({ src, onRemove }: { src: string; onRemove: () => void }) {
  const name = fileNameFromSrc(src) || src;
  return (
    <span
      data-testid="file-chip"
      title={isPickedFileSrc(src) ? `${name} (picked this session)` : src}
      className="inline-flex h-6 max-w-48 items-center gap-1 rounded bg-hover px-1.5 font-mono text-xs text-fg"
    >
      <span className="truncate">{name}</span>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="shrink-0 text-fg-muted hover:text-fail"
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  );
}
