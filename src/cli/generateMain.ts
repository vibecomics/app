/**
 * The standalone image-generation script, `vibecomics-generate.mjs`:
 *
 *   node vibecomics-generate.mjs --service <url> --s3 <connection string> --project <name>
 *
 * It opens the project from the S3-compatible bucket, then runs generateAllImages (src/ai/generateAll.ts)
 * — the very function the page's Generate button calls — which finds everything dirty itself and
 * generates it in order: reference art (cast, props, scenes), then every layer and background panel by
 * panel, then stale panel images. Progress goes to stdout as it happens. Nothing is remembered between
 * runs (no login, no state folder): its inputs are the arguments and environment variables below.
 * Meant for a long-running job an agent starts instead of generating image by image itself.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createComicBuilder } from '../ai/actions';
import type { ActionResult } from '../ai/deps';
import { GENERATE_ALL_PHASES, countGenerateAll } from '../ai/generateAll';
import type { GenerateAllPhase, GenerateAllProgress, GenerateAllResult } from '../ai/generateAll';
import { parseS3ConnectionString } from '../s3/s3Config';
import { errorMessage } from '../utils/errors';
import { UsageError, parseArgv } from './args';
import { createNodeSession } from './nodeSession';
import { StateStore } from './state';

export interface GenerateIo {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const GENERATE_HELP = `vibecomics-generate: generate every image a comic project still needs, in order.

Usage
  node vibecomics-generate.mjs --service <url> --s3 <connection string> --project <name> [options]

Inputs
  --service <url>   The image service: an endpoint this script POSTs each generation request to as
                    JSON ({kind, prompt, referenceImages, width?, height?, transparent?, ...}) and that
                    answers with the image (image/* bytes, or JSON {"image":"data:..."}).
                    Or set VIBECOMICS_IMAGE_SERVICE_URL.
  --s3 <string>     The S3-compatible bucket holding the project:
                    s3://<accessKeyId>:<secretAccessKey>@<host>[:<port>]/<bucket>[?region=..&tls=1&pathStyle=0]
                    Or set VIBECOMICS_S3. Keep secrets out of the command line (it shows in process
                    lists): pass the string without the secret and set VIBECOMICS_S3_SECRET_ACCESS_KEY
                    (and VIBECOMICS_S3_ACCESS_KEY_ID if the string has no key either).
  --project <name>  The project's folder name in the bucket (see "storage listProjects" in vibecomics.mjs).

Options
  --only <list>     Comma-separated stages to run, from: references, layers, panels.
                    Default: all three (panels = stale panel images, only those that already have one).
  --dry-run         Only count and list what would be generated; generate nothing, save nothing.
  --json            Print one JSON object per progress event (newline-delimited) instead of text.
  --help            This text.

What it does
  It looks for the dirty things itself — nothing to list. Order: (1) reference art for characters, props
  and scenes, including their variations; (2) every dirty layer and background, panel by panel;
  (3) stale panel images. Each result is saved to the project as soon as it is made, so stopping early
  (Ctrl-C) keeps everything finished so far, and running it again continues with what is left.

Output (stdout, one line per event)
  Will generate 12 images: 3 reference, 8 layer/background, 1 panel.
  Starting reference images: 3 images.
  1 of 12 done (Character "Mira" — Front view)
  4 of 12 done (Panel 2 in Page 1: layer "Hero")
  5 of 12 done (Panel 2 in Page 1: background "Street") — FAILED: <reason>
  Finished: 11 of 12 generated, 1 failed.
  A failure does not stop the rest. Problems also go to stderr as "error: ...".

Exit code
  0 every image generated (or nothing to do); 1 some failed or it could not run; 2 bad arguments.`;

function parseArguments(argv: string[], env: GenerateIo['env']) {
  const { positional, flags } = parseArgv(argv);
  if (positional.length)
    throw new UsageError(`Unexpected argument "${positional[0]}". See --help.`);
  const known = ['service', 's3', 'project', 'only', 'dry-run', 'json', 'help'];
  for (const name of flags.keys()) {
    if (!known.includes(name)) throw new UsageError(`Unknown option --${name}. See --help.`);
  }
  const text = (name: string, fallback?: string): string | undefined => {
    const value = flags.get(name);
    if (value === true) throw new UsageError(`--${name} needs a value.`);
    return value ?? fallback?.trim() ?? undefined;
  };
  const only = text('only');
  const phases = only
    ? only
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : [...GENERATE_ALL_PHASES];
  for (const phase of phases) {
    if (!GENERATE_ALL_PHASES.includes(phase as GenerateAllPhase)) {
      throw new UsageError(
        `--only: "${phase}" is not a stage. Use: ${GENERATE_ALL_PHASES.join(', ')}.`
      );
    }
  }
  return {
    help: flags.has('help'),
    service: text('service', env.VIBECOMICS_IMAGE_SERVICE_URL),
    s3: text('s3', env.VIBECOMICS_S3),
    project: text('project', env.VIBECOMICS_PROJECT),
    phases: phases as GenerateAllPhase[],
    dryRun: flags.has('dry-run'),
    json: flags.has('json'),
  };
}

/** Run the script; resolves to the process exit code. */
export async function runGenerate(argv: string[], io: GenerateIo): Promise<number> {
  let home: string | undefined;
  try {
    const args = parseArguments(argv, io.env);
    if (args.help) {
      io.stdout(`${GENERATE_HELP}\n`);
      return 0;
    }
    const missing = [
      !args.s3 && '--s3 <connection string> (or VIBECOMICS_S3)',
      !args.project && '--project <name>',
      !args.service && !args.dryRun && '--service <url> (or VIBECOMICS_IMAGE_SERVICE_URL)',
    ].filter(Boolean);
    if (missing.length) throw new UsageError(`Missing: ${missing.join(', ')}. See --help.`);

    // The storage layer reads the bucket's credentials from the environment, not from the string.
    // The key and secret in the connection string win; a blank part comes from the environment.
    const { credentials } = parseS3ConnectionString(args.s3!);
    process.env.VIBECOMICS_S3_ACCESS_KEY_ID =
      credentials.accessKeyId || io.env.VIBECOMICS_S3_ACCESS_KEY_ID;
    process.env.VIBECOMICS_S3_SECRET_ACCESS_KEY =
      credentials.secretAccessKey || io.env.VIBECOMICS_S3_SECRET_ACCESS_KEY || '';

    // Nothing persists between runs: the session's state file lives in a throwaway folder.
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecomics-generate-'));
    const session = createNodeSession({
      store: new StateStore(home),
      fetch: io.fetch,
      deviceClient: null,
    });
    const api = createComicBuilder(session.deps);

    await api.storage.connect(args.s3!);
    const opened = await api.storage.openProject(args.project!);
    if (!opened.ok) throw new Error(opened.error);

    const project = session.deps.getProject()!;
    if (args.dryRun) {
      const counts = countGenerateAll(project, { phases: args.phases });
      io.stdout(
        args.json
          ? `${JSON.stringify({ type: 'dry-run', counts })}\n`
          : `Would generate ${counts.references + counts.layers + counts.panels} images: ` +
              `${counts.references} reference, ${counts.layers} layer/background, ${counts.panels} panel.\n`
      );
      return 0;
    }

    const config = api.generate.config({ provider: 'service', url: args.service! }) as ActionResult;
    if (!config.ok) throw new Error(config.error);
    const reachable = await api.generate.test();
    if (!reachable.ok)
      io.stderr(`warning: ${reachable.error} (continuing; it may only answer POST)\n`);

    const onProgress = async (event: GenerateAllProgress): Promise<void> => {
      io.stdout(args.json ? `${JSON.stringify(event)}\n` : `${event.message}\n`);
      if (event.type === 'item') {
        // Keep every finished image: save the project now, not only at the very end.
        const saved = await session.deps.flushStorageSave();
        if (!saved.ok) io.stderr(`warning: ${saved.error}\n`);
      }
    };
    const result = (await api.generate.batch('all', {
      phases: args.phases,
      onProgress,
    })) as GenerateAllResult;
    await session.finish();

    for (const f of result.failures) io.stderr(`error: ${f.label}: ${f.error}\n`);
    return result.failed ? 1 : 0;
  } catch (e) {
    io.stderr(`error: ${errorMessage(e)}\n`);
    return e instanceof UsageError ? 2 : 1;
  } finally {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  }
}
