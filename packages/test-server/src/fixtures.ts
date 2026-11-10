/** Fixed response bodies. Everything here is deterministic: no dates, no random ids. */

export interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
  roles: string[];
}

export const USERS: User[] = [
  {
    id: 1,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    active: true,
    roles: ['admin', 'editor'],
  },
  { id: 2, name: 'Alan Turing', email: 'alan@example.com', active: true, roles: ['editor'] },
  { id: 3, name: 'Grace Hopper', email: 'grace@example.com', active: false, roles: [] },
];

const NESTED = {
  company: {
    name: 'Pigeon Test Co.',
    address: { street: '1 Loopback Way', city: 'Localhost', geo: { lat: 51.5072, lng: -0.1276 } },
    departments: [
      {
        name: 'Engineering',
        teams: [
          {
            name: 'Platform',
            members: [
              { id: 1, name: 'Ada Lovelace', skills: [{ name: 'math', level: 5 }] },
              { id: 2, name: 'Alan Turing', skills: [{ name: 'crypto', level: 5 }] },
            ],
          },
        ],
      },
      { name: 'Operations', teams: [] },
    ],
  },
  meta: { version: 1, tags: ['nested', 'fixture'], extra: null },
};

/**
 * One value of every JSON type, written as raw text so it can hold values that a
 * `JSON.stringify` round trip would change: an integer above 2^53, `1.0`, exponents.
 */
const TYPES = `{
  "string": "hello",
  "emptyString": "",
  "integer": 42,
  "negative": -7,
  "zero": 0,
  "float": 3.14,
  "floatWithZero": 1.0,
  "exponent": 1.5e21,
  "bigInteger": 9007199254740993,
  "true": true,
  "false": false,
  "null": null,
  "emptyArray": [],
  "emptyObject": {},
  "mixedArray": [1, "two", true, null, { "five": 5 }, [6]],
  "nestedArrays": [[1, 2], [3, [4, 5]]],
  "escapedString": "quote \\" backslash \\\\ tab \\t newline \\n"
}
`;

const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** `/json/:shape` bodies. */
export const JSON_SHAPES: Record<string, string> = {
  user: pretty(USERS[0]),
  users: pretty(USERS),
  nested: pretty(NESTED),
  types: TYPES,
};

/** `/unicode` body. Combining marks are escaped so editors can't normalise them away. */
export const UNICODE = pretty({
  greetings: {
    ar: 'مرحبا',
    en: 'Hello',
    he: 'שלום',
    hi: 'नमस्ते',
    ja: 'こんにちは',
    ru: 'Привет',
    zh: '你好',
  },
  emoji: '🐦 🚀 👩‍💻 🏳️‍🌈',
  astral: '𝄞 𐐷',
  nfc: 'é',
  nfd: 'é',
  rtlMixed: 'abc אבג 123',
  zeroWidth: 'a​b',
  'ключ 🔑': 'non-ASCII key',
});

/**
 * `/html` body: a page whose script and inline event handler would change `#script-status` and
 * set `window.pigeonScriptRan` (and the parent's), to prove previews never run scripts.
 */
export const HTML_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Pigeon test page</title></head>
<body>
<h1>Pigeon test page 🐦</h1>
<p id="script-status">Scripts did not run.</p>
<img src="data:," alt="" onerror="document.getElementById('script-status').textContent = 'Scripts ran.'; window.pigeonScriptRan = true">
<form action="/echo" method="post"><input name="q" value="x"><button>Send</button></form>
<pre>  kept   as   is
  line two</pre>
<script>
  document.getElementById('script-status').textContent = 'Scripts ran.';
  window.pigeonScriptRan = true;
  try { window.parent.pigeonScriptRan = true; } catch (error) {}
</script>
</body>
</html>
`;

/** `/xml` body, compact on purpose so a formatted view differs from the raw one. */
export const XML_DOC =
  '<?xml version="1.0" encoding="UTF-8"?><catalog><book id="1" lang="en"><title>Notes on the Analytical Engine</title><author>Ada Lovelace</author><tags><tag>math</tag><tag>computing</tag></tags></book><!-- more soon --><empty/></catalog>\n';

/** `/image/png`: a 1×1 opaque red PNG. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
