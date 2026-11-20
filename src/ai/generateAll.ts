/**
 * generateAllImages: the one function that generates every image a project still needs, in order —
 * reference art first (cast, props, scenes, and every variation of them), then every dirty layer and
 * background panel by panel, then (optionally) panel images — and reports progress as it goes.
 *
 * It finds the dirty things itself (see dirtyVariationRefs / dirtyLayerRefs / pendingPanelImages), so
 * a caller never lists what to generate. Everything that drives it shares this one code path: the
 * page's Generate button (via generate.batch("all")) and the standalone script
 * `vibecomics-generate.mjs` (src/cli/generateBin.ts), which prints each progress event to stdout.
 * The caller supplies the image service (deps.getGeneratorConfig) and the storage (the deps' media
 * and project functions); this function knows neither.
 */
import type { ComicProject } from '../types/comic';
import { pendingGenerations, pendingPanelImages, pendingReferenceGenerations } from './builders';
import type { LayerKind, StoryKind } from './builders';
import type { ComicBuilderDeps } from './deps';
import {
  generateAllDirty,
  generateAllDirtyPanelImages,
  generateAllDirtyVariations,
} from './generation';
import type { GenerationOutcome, PanelImageOutcome, VariationRefOutcome } from './generation';

/** The stages, in the order they run. */
export type GenerateAllPhase = 'references' | 'layers' | 'panels';

export const GENERATE_ALL_PHASES: readonly GenerateAllPhase[] = ['references', 'layers', 'panels'];

export interface GenerateAllOptions {
  /** Which stages to run. Default: all three (references, layers, panels). */
  phases?: readonly GenerateAllPhase[];
  /** Only these reference lists ("characters", "objects", "scenes"). Default: all. */
  referenceKinds?: readonly StoryKind[];
  /** Only these layer kinds ("background", "foreground"). Default: both. */
  layerKinds?: readonly LayerKind[];
  /** Called for every progress event, in order; awaited, so a caller can save between images. */
  onProgress?: (event: GenerateAllProgress) => void | Promise<void>;
}

/** How many images each stage will generate. */
export type GenerateAllCounts = Record<GenerateAllPhase, number>;

interface ProgressBase {
  /** A ready-to-print one-line description of this event; the same text the UI shows as status. */
  message: string;
}

export type GenerateAllProgress =
  /** Once, before anything is generated: how many images there are in all. */
  | (ProgressBase & { type: 'start'; total: number; counts: GenerateAllCounts })
  /** A stage is about to begin (`total` is re-counted then, since earlier stages can change it). */
  | (ProgressBase & {
      type: 'phase';
      phase: GenerateAllPhase;
      count: number;
      done: number;
      total: number;
    })
  /** One image finished (ok or failed). `done` counts every finished item so far, failed included. */
  | (ProgressBase & {
      type: 'item';
      phase: GenerateAllPhase;
      done: number;
      total: number;
      ok: boolean;
      /** What it was for, e.g. `Character "Mira" — Front view` or `Panel 2 on Page 1: layer "Hero"`. */
      label: string;
      error?: string;
    })
  /** Once, at the end. */
  | (ProgressBase & { type: 'finish'; total: number; succeeded: number; failed: number });

export interface GenerateAllFailure {
  phase: GenerateAllPhase;
  label: string;
  error: string;
}

export interface GenerateAllResult {
  total: number;
  succeeded: number;
  failed: number;
  failures: GenerateAllFailure[];
}

const KIND_NOUN: Record<StoryKind, string> = {
  characters: 'Character',
  objects: 'Prop',
  scenes: 'Scene',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How many images each stage would generate right now, without generating anything. */
export function countGenerateAll(
  project: ComicProject,
  options: Pick<GenerateAllOptions, 'phases' | 'referenceKinds' | 'layerKinds'> = {}
): GenerateAllCounts {
  const phases = options.phases ?? GENERATE_ALL_PHASES;
  return {
    references: phases.includes('references')
      ? pendingReferenceGenerations(project).filter(
          (r) => !options.referenceKinds || options.referenceKinds.includes(r.kind)
        ).length
      : 0,
    layers: phases.includes('layers')
      ? pendingGenerations(project).filter(
          (l) => !options.layerKinds || options.layerKinds.includes(l.kind)
        ).length
      : 0,
    panels: phases.includes('panels') ? pendingPanelImages(project).length : 0,
  };
}

const sum = (counts: GenerateAllCounts) => counts.references + counts.layers + counts.panels;

/**
 * Generates every outstanding image, one request at a time: reference art, then layers and
 * backgrounds, then panel images (each stage only if selected). Each result is committed as it is
 * made, so stopping part-way keeps everything finished so far. A failure on one image does not stop
 * the rest. Progress is reported through `options.onProgress` and mirrored to `deps.setStatus`.
 *
 * `commit` sets a layer's image (see setLayerMedia in actions.ts).
 */
export async function generateAllImages(
  deps: ComicBuilderDeps,
  commit: Parameters<typeof generateAllDirty>[1],
  options: GenerateAllOptions = {}
): Promise<GenerateAllResult> {
  const phases = GENERATE_ALL_PHASES.filter((p) =>
    (options.phases ?? GENERATE_ALL_PHASES).includes(p)
  );
  const project = (): ComicProject => {
    const current = deps.getProject();
    if (!current) throw new Error('No project is open.');
    return current;
  };
  const scope = { phases, referenceKinds: options.referenceKinds, layerKinds: options.layerKinds };

  const emit = async (event: GenerateAllProgress): Promise<void> => {
    deps.setStatus(event.message);
    await options.onProgress?.(event);
  };

  const initial = countGenerateAll(project(), scope);
  let total = sum(initial);
  let done = 0;
  const failures: GenerateAllFailure[] = [];

  await emit({
    type: 'start',
    total,
    counts: initial,
    message: total
      ? `Will generate ${plural(total, 'image')}: ${initial.references} reference, ${initial.layers} layer/background, ${initial.panels} panel.`
      : 'Nothing to generate: every image already matches its prompt.',
  });

  const finishItem = async (
    phase: GenerateAllPhase,
    label: string,
    outcome: { ok: boolean; error?: string }
  ): Promise<void> => {
    done++;
    if (!outcome.ok) failures.push({ phase, label, error: outcome.error ?? 'Failed.' });
    await emit({
      type: 'item',
      phase,
      done,
      total,
      ok: outcome.ok,
      label,
      error: outcome.error,
      message: outcome.ok
        ? `${done} of ${total} done (${label})`
        : `${done} of ${total} done (${label}) — FAILED: ${outcome.error}`,
    });
  };

  // A stage's count is taken again as it begins: finished reference art can change what is dirty
  // after it, so the total always reads "finished so far + still to do".
  const begin = async (phase: GenerateAllPhase): Promise<number> => {
    const count = countGenerateAll(project(), { ...scope, phases: [phase] })[phase];
    total =
      done +
      count +
      phases
        .slice(phases.indexOf(phase) + 1)
        .reduce(
          (n, later) => n + countGenerateAll(project(), { ...scope, phases: [later] })[later],
          0
        );
    if (count) {
      await emit({
        type: 'phase',
        phase,
        count,
        done,
        total,
        message: `Starting ${phase === 'references' ? 'reference images' : phase === 'layers' ? 'layers and backgrounds' : 'panel images'}: ${plural(count, 'image')}.`,
      });
    }
    return count;
  };

  if (phases.includes('references') && (await begin('references'))) {
    const labels = new Map(
      pendingReferenceGenerations(project()).map((r) => [
        `${r.kind}/${r.entryId}/${r.variationId}`,
        `${KIND_NOUN[r.kind]} "${r.entryName}" — ${r.variationName}`,
      ])
    );
    await generateAllDirtyVariations(deps, options.referenceKinds, (o: VariationRefOutcome) =>
      finishItem(
        'references',
        labels.get(`${o.kind}/${o.entryId}/${o.variationId}`) ?? o.variationId,
        o
      )
    );
  }

  if (phases.includes('layers') && (await begin('layers'))) {
    const labels = new Map(
      pendingGenerations(project()).map((l) => [
        `${l.panelId}/${l.layerId}`,
        `Panel ${l.panelNumber} in Page ${l.page}: ${l.kind === 'background' ? 'background' : 'layer'} "${l.name}"`,
      ])
    );
    await generateAllDirty(deps, commit, options.layerKinds, (o: GenerationOutcome) =>
      finishItem('layers', labels.get(`${o.panelId}/${o.layerId}`) ?? o.layerId, o)
    );
  }

  if (phases.includes('panels') && (await begin('panels'))) {
    const labels = new Map(
      pendingPanelImages(project()).map((p) => [
        p.panelId,
        `Panel ${p.panelNumber} in Page ${p.page}: panel image`,
      ])
    );
    await generateAllDirtyPanelImages(deps, (o: PanelImageOutcome) =>
      finishItem('panels', labels.get(o.panelId) ?? o.panelId, o)
    );
  }

  const result: GenerateAllResult = {
    total: done,
    succeeded: done - failures.length,
    failed: failures.length,
    failures,
  };
  await emit({
    type: 'finish',
    total: result.total,
    succeeded: result.succeeded,
    failed: result.failed,
    message: result.failed
      ? `Finished: ${result.succeeded} of ${result.total} generated, ${result.failed} failed.`
      : result.total
        ? `Finished: ${plural(result.total, 'image')} generated.`
        : 'Finished: nothing needed generating.',
  });
  return result;
}
