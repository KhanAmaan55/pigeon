import { describe, expect, it } from 'vitest';

import { hasScripts, readScript, writeScript } from '../src/index';

const events = [
  {
    listen: 'test',
    script: {
      id: 's1',
      type: 'text/javascript',
      exec: ['pm.test("a");', 'pm.test("b");'],
      name: 'tests',
      'x-script': 1,
    },
    'x-event': true,
  },
  { listen: 'prerequest', script: { exec: 'single string script' }, disabled: true },
];

describe('scripts (PIGN-031)', () => {
  it('reads exec arrays and strings joined with newlines', () => {
    expect(readScript(events, 'test')).toEqual({
      text: 'pm.test("a");\npm.test("b");',
      disabled: false,
      index: 0,
    });
    expect(readScript(events, 'prerequest')).toEqual({
      text: 'single string script',
      disabled: true,
      index: 1,
    });
    expect(readScript([], 'test')).toEqual({ text: '', disabled: false, index: -1 });
    expect(hasScripts(events)).toBe(true);
    expect(hasScripts([events[1]])).toBe(false);
    expect(hasScripts([{ listen: 'test', script: { exec: [''] } }])).toBe(false);
  });

  it('edits keep ids, type, name and unknown keys; lines split on LF after CRLF normalization', () => {
    const edited = writeScript(events, 'test', 'pm.test("a");\r\npm.test("c");', false);
    expect(edited[0]).toEqual({
      listen: 'test',
      script: {
        id: 's1',
        type: 'text/javascript',
        exec: ['pm.test("a");', 'pm.test("c");'],
        name: 'tests',
        'x-script': 1,
      },
      'x-event': true,
    });
    expect(edited[1]).toBe(events[1]);
    // Nothing changed: same objects.
    expect(writeScript(events, 'test', 'pm.test("a");\npm.test("b");', false)[0]).toBe(events[0]);
  });

  it('toggles disabled, creates missing scripts and removes emptied ones it created', () => {
    expect(writeScript(events, 'prerequest', 'single string script', false)[1]).toEqual({
      listen: 'prerequest',
      script: { exec: ['single string script'] },
    });
    const created = writeScript([], 'prerequest', 'console.log(1)', true);
    expect(created).toEqual([
      {
        listen: 'prerequest',
        script: { type: 'text/javascript', exec: ['console.log(1)'] },
        disabled: true,
      },
    ]);
    expect(writeScript(writeScript([], 'test', 'x', false), 'test', '', false)).toEqual([]);
    // An emptied script with an id is kept (it is someone's script, just empty now).
    expect(writeScript(events, 'test', '', false)[0]).toMatchObject({
      script: { id: 's1', exec: [''] },
    });
    expect(writeScript([], 'test', '', false)).toEqual([]);
  });
});
