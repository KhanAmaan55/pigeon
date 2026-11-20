/**
 * Postman `event[]` scripts (data-model.md §4.2, PIGN-031). Events stay the objects read from
 * the file so every key (`script.id`, `type`, `name`, `src`, unknown ones) survives; these
 * helpers read and edit one script, stored as `exec: string[]` (one line per entry, so a
 * one-line edit is a one-line diff).
 */

import { asArray, asObject, isObject, type JsonObject } from './json';

export type ScriptListen = 'prerequest' | 'test';

export interface ScriptView {
  /** Lines joined with `\n`. */
  text: string;
  disabled: boolean;
  /** Position in `events`; `-1` when there is no such event. */
  index: number;
}

function execText(exec: unknown): string {
  if (typeof exec === 'string') return exec;
  return asArray(exec)
    .map((line) => (typeof line === 'string' ? line : String(line)))
    .join('\n');
}

/** The first `listen` script in `events`. */
export function readScript(events: readonly unknown[], listen: ScriptListen): ScriptView {
  const index = events.findIndex((event) => isObject(event) && event['listen'] === listen);
  if (index === -1) return { text: '', disabled: false, index };
  const event = asObject(events[index]);
  return {
    text: execText(asObject(event['script'])['exec']),
    disabled: event['disabled'] === true,
    index,
  };
}

/** True when some enabled event has a non-blank script. */
export function hasScripts(events: readonly unknown[]): boolean {
  return events.some((event) => {
    if (!isObject(event) || event['disabled'] === true) return false;
    return execText(asObject(event['script'])['exec']).trim() !== '';
  });
}

/** Keys a script gets when Pigeon creates it; anything else means the event must stay. */
const CREATED_SCRIPT_KEYS = new Set(['type', 'exec']);

/**
 * `events` with the `listen` script set to `text` (CRLF normalized, split into lines) and its
 * `disabled` flag. Other keys of the event and its script are kept. An emptied script that only
 * holds what Pigeon would create is removed.
 */
export function writeScript(
  events: readonly unknown[],
  listen: ScriptListen,
  text: string,
  disabled: boolean,
): unknown[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const exec = normalized.split('\n');
  const { index } = readScript(events, listen);
  if (index === -1) {
    if (normalized === '') return [...events];
    return [
      ...events,
      {
        listen,
        script: { type: 'text/javascript', exec },
        ...(disabled ? { disabled: true } : {}),
      },
    ];
  }
  const event = asObject(events[index]);
  const script = asObject(event['script']);
  const { disabled: _disabled, ...rest } = event;
  const removable =
    normalized === '' &&
    !disabled &&
    Object.keys(rest).every((key) => key === 'listen' || key === 'script') &&
    Object.keys(script).every((key) => CREATED_SCRIPT_KEYS.has(key));
  if (removable) return events.filter((_, i) => i !== index);
  const unchanged =
    execText(script['exec']) === normalized && (event['disabled'] === true) === disabled;
  if (unchanged) return [...events];
  const next: JsonObject = {
    ...rest,
    script: { ...script, exec },
    ...(disabled ? { disabled: true } : event['disabled'] === false ? { disabled: false } : {}),
  };
  return events.map((existing, i) => (i === index ? next : existing));
}
