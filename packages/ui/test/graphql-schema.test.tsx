/**
 * GraphQL schema support in the request editor (PIGN-055): introspection through the request's
 * own context, the cache in local app state, diagnostics, variable checks and the docs panel.
 * Typing-driven autocomplete and hover need a real layout: e2e/web/projects.spec.ts covers them.
 */

import { diagnosticCount, forceLinting } from '@codemirror/lint';
import type { PreparedRequest } from '@pigeon/platform';
import { createMemoryPlatform, MockTransport } from '@pigeon/platform';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildSchema, introspectionFromSchema } from 'graphql';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformProvider } from '../src/app/PlatformProvider';
import { TooltipProvider } from '../src/components/Tooltip';
import {
  docsModel,
  schemaFromFile,
  schemaFromIntrospection,
  variableProblems,
} from '../src/features/graphql/runtime';
import { RequestEditor } from '../src/features/request-editor/RequestEditor';
import { ScratchRequestProvider } from '../src/features/request-editor/ScratchRequestProvider';
import { editorView, setEditorText } from './code-editor';

afterEach(cleanup);

const SDL = `
"A user."
type User { id: ID!, name: String!, roles: [String!]! }
type Query {
  "Looks a user up."
  user(id: ID!): User
  users: [User!]!
}
`;
const INTROSPECTION = introspectionFromSchema(buildSchema(SDL));
const decoder = new TextDecoder();

function renderGraphql(answer: () => { status?: number; body: string }) {
  const sent: PreparedRequest[] = [];
  const transport = new MockTransport().on(
    () => true,
    (req) => {
      sent.push(req);
      const { status = 200, body } = answer();
      return { status, headers: [['content-type', 'application/json']], body };
    },
  );
  const platform = createMemoryPlatform({ transport });
  render(
    <PlatformProvider platform={platform}>
      <TooltipProvider>
        <ScratchRequestProvider>
          <RequestEditor />
        </ScratchRequestProvider>
      </TooltipProvider>
    </PlatformProvider>,
  );
  return { platform, sent, user: userEvent.setup() };
}

async function openGraphqlBody(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('url-input'), 'http://api.test/graphql');
  await user.click(screen.getByTestId('body-tab'));
  await user.click(screen.getByTestId('body-mode-graphql'));
  return screen.findByTestId('graphql-query');
}

describe('GraphQL schema in the editor (PIGN-055)', () => {
  it('fetches the schema by introspection, caches it, checks the query and variables', async () => {
    const { platform, sent, user } = renderGraphql(() => ({
      body: JSON.stringify({ data: INTROSPECTION }),
    }));
    const query = await openGraphqlBody(user);
    expect(screen.getByTestId('graphql-schema-status').textContent).toContain('No schema');
    expect((screen.getByTestId('graphql-docs-toggle') as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByTestId('graphql-fetch-schema'));
    await waitFor(() =>
      expect(screen.getByTestId('graphql-schema-status').textContent).toMatch(
        /^Schema: \d+ types from introspection, fetched/,
      ),
    );
    // Sent like the request itself: same URL, POST, the introspection operation.
    const introspection = sent.at(-1)!;
    expect(introspection.url).toBe('http://api.test/graphql');
    expect(introspection.method).toBe('POST');
    expect(
      JSON.parse(decoder.decode((introspection.body as { bytes: Uint8Array }).bytes)),
    ).toMatchObject({
      operationName: 'IntrospectionQuery',
      query: expect.stringContaining('__schema'),
    });
    // Cached in local app state for this URL (the scratch request: the `app` namespace).
    expect(await platform.appState.get('app', 'graphqlSchemas')).toEqual([
      { url: 'http://api.test/graphql', fetchedAt: expect.any(String) },
    ]);

    // An unknown field gets a diagnostic once the schema is in the editor.
    setEditorText(query, '{ users { nope } }');
    const view = editorView(query);
    await waitFor(() => {
      act(() => forceLinting(view));
      expect(diagnosticCount(view.state)).toBeGreaterThan(0);
    });
    setEditorText(query, '{ users { name } }');
    await waitFor(() => {
      act(() => forceLinting(view));
      expect(diagnosticCount(view.state)).toBe(0);
    });

    // Variables are checked against the operation's definitions (a warning, never blocking).
    setEditorText(query, 'query One($id: ID!) { user(id: $id) { name } }');
    await waitFor(() =>
      expect(screen.getByTestId('graphql-variables-schema').textContent).toContain('$id'),
    );
    setEditorText(screen.getByTestId('graphql-variables'), '{ "id": "1" }');
    await waitFor(() => expect(screen.queryByTestId('graphql-variables-schema')).toBeNull());

    // Docs panel: root types, a type's fields with descriptions, search.
    await user.click(screen.getByTestId('graphql-docs-toggle'));
    const docs = screen.getByTestId('graphql-docs');
    await user.click(within(docs).getAllByRole('button', { name: 'Query' })[0]!);
    const type = within(docs).getByTestId('graphql-docs-type');
    expect(type.textContent).toContain('user(id: ID!): User');
    expect(type.textContent).toContain('Looks a user up.');
    await user.type(within(docs).getByTestId('graphql-docs-search'), 'rol');
    expect(within(docs).getByText('roles')).toBeTruthy();

    // Clear forgets the cached schema.
    await user.click(screen.getByTestId('graphql-clear-schema'));
    await waitFor(() =>
      expect(screen.getByTestId('graphql-schema-status').textContent).toContain('No schema'),
    );
    expect(await platform.appState.get('app', 'graphqlSchemas')).toEqual([]);
  });

  it('explains a server that does not answer introspection', async () => {
    const { user } = renderGraphql(() => ({
      body: JSON.stringify({ errors: [{ message: 'GraphQL introspection is not allowed' }] }),
    }));
    await openGraphqlBody(user);
    await user.click(screen.getByTestId('graphql-fetch-schema'));
    expect((await screen.findByTestId('graphql-schema-error')).textContent).toBe(
      'Introspection failed: GraphQL introspection is not allowed',
    );
  });
});

describe('GraphQL runtime', () => {
  it('builds schemas from SDL and introspection JSON files, with clear errors', () => {
    expect(schemaFromFile(SDL, 'schema.graphql').ok).toBe(true);
    expect(schemaFromFile(JSON.stringify({ data: INTROSPECTION }), 'schema.json').ok).toBe(true);
    expect(schemaFromFile(JSON.stringify(INTROSPECTION), 'x.json').ok).toBe(true);
    expect(schemaFromFile('type Query {', 's.graphql')).toMatchObject({
      ok: false,
      message: expect.stringContaining('not valid GraphQL SDL'),
    });
    expect(schemaFromFile('{"nope":1}', 's.json')).toMatchObject({
      ok: false,
      message: 's.json has no "__schema" (an introspection result).',
    });
  });

  it('checks variables and builds the docs model', () => {
    const built = schemaFromIntrospection(INTROSPECTION);
    if (!built.ok) throw new Error(built.message);
    const q = 'query One($id: ID!) { user(id: $id) { name } }';
    expect(variableProblems(built.schema, q, undefined, '')).toHaveLength(1);
    expect(variableProblems(built.schema, q, undefined, '{"id": 1}')).toEqual([]);
    expect(variableProblems(built.schema, q, undefined, '{"id": {"x": 1}}')).toHaveLength(1);
    expect(variableProblems(built.schema, '{ broken', undefined, '')).toEqual([]);
    const docs = docsModel(built.schema);
    expect(docs.roots).toEqual([{ label: 'Query', type: 'Query' }]);
    expect(docs.types.find((t) => t.name === 'User')).toMatchObject({
      kind: 'object',
      description: 'A user.',
      fields: expect.arrayContaining([
        expect.objectContaining({ name: 'roles', type: '[String!]!', typeName: 'String' }),
      ]),
    });
  });
});

describe('committed schema file (PIGN-055)', () => {
  it('uses the request’s schema file instead of introspection', async () => {
    const { initializeProject, ProjectSession } = await import('@pigeon/core');
    const { MemoryAppState, MemoryFs } = await import('@pigeon/platform');
    const { PigeonApp } = await import('../src/app/PigeonApp');
    const { vi } = await import('vitest');
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false,
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      const fs = new MemoryFs();
      await initializeProject(fs, 'Schemas');
      const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
      session.apply({ type: 'createCollection', id: 'c', name: 'API' });
      session.apply({
        type: 'createRequest',
        id: 'g',
        parentId: 'c',
        name: 'Users query',
        request: {
          method: 'POST',
          url: { raw: 'http://api.test/graphql', query: [], pathVariables: [], extra: {} },
          body: {
            mode: 'graphql',
            query: '{ users { name } }',
            variables: '',
            schemaFile: 'schema.graphql',
          },
        },
      });
      await session.saveForCommit();
      await fs.writeFileAtomic('schema.graphql', SDL);
      expect(await fs.readText('collections/api/users-query.request.json')).toContain(
        '"schemaFile": "schema.graphql"',
      );

      const platform = createMemoryPlatform({ os: 'macos' });
      platform.projects.pickResult = platform.projects.add(fs);
      render(<PigeonApp platform={platform} />);
      const user = userEvent.setup();
      await user.click(screen.getByTestId('open-folder'));
      await user.click(await screen.findByText('Users query'));
      await waitFor(() =>
        expect((screen.getByTestId('url-input') as HTMLInputElement).value).toBe(
          'http://api.test/graphql',
        ),
      );
      await act(async () => screen.getByTestId('body-tab').focus());
      await screen.findByTestId('graphql-body', {}, { timeout: 5000 });
      const status = await screen.findByTestId('graphql-schema-status', {}, { timeout: 5000 });
      await waitFor(
        () => expect(status.textContent).toMatch(/^Schema: \d+ types from the schema file$/),
        { timeout: 5000 },
      );
      expect((screen.getByTestId('graphql-schema-file') as HTMLInputElement).value).toBe(
        'schema.graphql',
      );
      expect(screen.queryByTestId('graphql-fetch-schema')).toBeNull();

      // A missing file is explained.
      const { fireEvent } = await import('@testing-library/react');
      fireEvent.change(screen.getByTestId('graphql-schema-file'), {
        target: { value: 'missing.graphql' },
      });
      await waitFor(
        () =>
          expect(screen.getByTestId('graphql-schema-status').textContent).toBe(
            'Schema file missing.graphql not found.',
          ),
        { timeout: 5000 },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
