/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import type { ComicProject } from '../types/comic';
import type { ComicBuilderDeps } from './deps';
import { countGenerateAll, generateAllImages } from './generateAll';
import type { GenerateAllProgress } from './generateAll';

/** A project with one dirty character variation and, on its first panel, one dirty background and one
 * dirty foreground layer: 3 images, of which the reference art must be generated first. */
function dirtyProject(): ComicProject {
  const project = createBlankProject('Test');
  project.metadata.characters.push({
    id: 'c1',
    name: 'Mira',
    description: 'A girl.',
    imageIds: [],
    sceneIds: [],
    variations: [{ id: 'v1', name: 'Front view', prompt: 'Front.', imageIds: [], dirty: true }],
  });
  project.pages[0].panels[0].layers.push(
    {
      id: 'bg',
      name: 'Street',
      kind: 'background',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
      prompt: 'A street.',
      dirty: true,
    },
    {
      id: 'fg',
      name: 'Hero',
      kind: 'foreground',
      visible: true,
      x: 10,
      y: 10,
      width: 40,
      rotation: 0,
      opacity: 1,
      prompt: 'A hero.',
      dirty: true,
    }
  );
  return project;
}

function makeDeps(
  holder: { project: ComicProject },
  options: { failPrompt?: RegExp } = {}
): ComicBuilderDeps {
  let uploads = 0;
  return {
    getProject: () => holder.project,
    updateProject: (mutation: (p: ComicProject) => void) => {
      const next = structuredClone(holder.project);
      mutation(next);
      holder.project = next;
    },
    setStatus: () => undefined,
    getGeneratorConfig: () => ({ provider: 'service' as const, url: 'http://svc/generate' }),
    generatorFetch: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { prompt: string };
      if (options.failPrompt?.test(body.prompt)) return new Response('boom', { status: 500 });
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png' },
      });
    }) as unknown as typeof fetch,
    downloadStorageMedia: async (id: string) => ({
      name: id,
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
    }),
    uploadStorageMedia: async (name: string) => ({
      id: `m${++uploads}`,
      name,
      fileName: `m${uploads}.png`,
      mimeType: 'image/png',
    }),
  } as unknown as ComicBuilderDeps;
}

const commitTo =
  (holder: { project: ComicProject }) => (panelId: string, layerId: string, mediaId: string) => {
    const layer = holder.project.pages
      .flatMap((p) => p.panels)
      .find((p) => p.id === panelId)!
      .layers.find((l) => l.id === layerId)!;
    layer.mediaId = mediaId;
    layer.dirty = false;
    return layer;
  };

test('countGenerateAll counts every stage from what is dirty, without generating', () => {
  assert.deepEqual(countGenerateAll(dirtyProject()), { references: 1, layers: 2, panels: 0 });
  assert.deepEqual(countGenerateAll(dirtyProject(), { phases: ['layers'] }), {
    references: 0,
    layers: 2,
    panels: 0,
  });
  assert.deepEqual(countGenerateAll(dirtyProject(), { layerKinds: ['background'] }).layers, 1);
});

test('generateAllImages generates reference art first, then layers, announcing the total up front', async () => {
  const holder = { project: dirtyProject() };
  const events: GenerateAllProgress[] = [];
  const result = await generateAllImages(makeDeps(holder), commitTo(holder), {
    onProgress: (e) => void events.push(e),
  });

  assert.deepEqual(result, { total: 3, succeeded: 3, failed: 0, failures: [] });
  assert.equal(events[0].type, 'start');
  assert.match(
    events[0].message,
    /^Will generate 3 images: 1 reference, 2 layer\/background, 0 panel/
  );
  const items = events.filter((e) => e.type === 'item');
  assert.match(items[0].message, /^1 of 3 done \(Character "Mira" — Front view\)$/);
  assert.match(items[1].message, /^2 of 3 done \(Panel 1 in Page 0: /);
  assert.equal(events.at(-1)?.type, 'finish');
  // Everything was committed, so nothing is dirty any more: a second run has nothing to do.
  assert.deepEqual(countGenerateAll(holder.project), { references: 0, layers: 0, panels: 0 });
  assert.equal(holder.project.metadata.characters[0].variations[0].imageIds.length, 1);
});

test('generateAllImages keeps going past a failure and reports it', async () => {
  const holder = { project: dirtyProject() };
  const events: GenerateAllProgress[] = [];
  const result = await generateAllImages(
    makeDeps(holder, { failPrompt: /A hero/ }),
    commitTo(holder),
    {
      onProgress: (e) => void events.push(e),
    }
  );

  assert.equal(result.total, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.succeeded, 2);
  assert.match(result.failures[0].label, /layer "Hero"/);
  const failed = events.filter((e) => e.type === 'item' && !e.ok);
  assert.equal(failed.length, 1);
  assert.match(failed[0].message, /layer "Hero"\) — FAILED: Image service failed: 500/);
  // The failed layer is still dirty, so the next run picks it up again.
  assert.deepEqual(countGenerateAll(holder.project), { references: 0, layers: 1, panels: 0 });
});

test('generateAllImages with nothing dirty says so and generates nothing', async () => {
  const holder = { project: createBlankProject('Empty') };
  const events: GenerateAllProgress[] = [];
  const result = await generateAllImages(makeDeps(holder), commitTo(holder), {
    onProgress: (e) => void events.push(e),
  });
  assert.equal(result.total, 0);
  assert.deepEqual(
    events.map((e) => e.type),
    ['start', 'finish']
  );
});
