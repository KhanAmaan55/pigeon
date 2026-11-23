import { createMemoryPlatform, MemoryFs } from '@pigeon/platform';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformProvider } from '../src/app/PlatformProvider';
import { ExampleView } from '../src/features/examples/ExampleView';
import { AppStoreProvider } from '../src/stores/AppStoreProvider';
import { createAppStore } from '../src/stores/app-store';

afterEach(cleanup);

async function renderExample(body: { text: string; format: 'json' | 'text' }) {
  const platform = createMemoryPlatform();
  const store = createAppStore(platform);
  platform.projects.pickResult = platform.projects.add(new MemoryFs());
  await store.getState().openFolder();
  await store.getState().confirmInit('Schemas');
  const { session, store: projectStore } = store.getState().project!;
  session.apply({ type: 'createCollection', id: 'c', name: 'Users' });
  session.apply({
    type: 'createRequest',
    id: 'r',
    parentId: 'c',
    name: 'Get user',
    request: { url: { raw: 'http://api.test/user', query: [], pathVariables: [], extra: {} } },
  });
  session.apply({
    type: 'createExample',
    requestId: 'r',
    example: {
      id: 'e',
      name: '200 OK',
      response: {
        code: 200,
        status: 'OK',
        headers: [],
        cookies: [],
        body: { kind: 'text', ...body },
      },
      extra: {},
    },
  });
  render(
    <PlatformProvider platform={platform}>
      <AppStoreProvider store={store}>
        <ExampleView session={session} store={projectStore} exampleId="e" />
      </AppStoreProvider>
    </PlatformProvider>,
  );
  return { platform, store };
}

describe('JSON Schema export of an example (PIGN-056)', () => {
  it('exports and copies the schema of a JSON example', async () => {
    const { platform, store } = await renderExample({
      text: '{"id":1,"name":"Ada","tags":["a"]}',
      format: 'json',
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('example-schema-export'));
    await waitFor(() => expect(platform.files.saved).toHaveLength(1));
    const [file] = platform.files.saved;
    expect(file!.name).toBe('get-user-200-ok.schema.json');
    expect(file!.mime).toBe('application/schema+json');
    expect(JSON.parse(file!.data as string)).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      required: ['id', 'name', 'tags'],
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    });
    expect(store.getState().notice?.message).toBe('Exported get-user-200-ok.schema.json.');

    // userEvent provides the clipboard.
    await user.click(screen.getByTestId('example-schema-copy'));
    await waitFor(() =>
      expect(store.getState().notice?.message).toBe('Copied the JSON Schema of “200 OK”.'),
    );
    expect(await navigator.clipboard.readText()).toBe(file!.data);
  });

  it('is not offered for bodies that are not JSON', async () => {
    await renderExample({ text: 'plain', format: 'text' });
    expect(screen.queryByTestId('example-schema-export')).toBeNull();
  });
});
