/**
 * Post-Vite build step: bundles src/sw.ts into dist/app/sw.js (esbuild, minified
 * IIFE) and writes dist/app/buildinfo.js as `self.BUILD_INFO = { commit, builtAt,
 * files }`. The service worker compares `commit` on every navigation to detect
 * a new build. Scoped to dist/app (not the whole of dist) because that's where
 * the app itself lives; the root index.html is a standalone static page with no
 * service worker of its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const APP_DIST = path.join(DIST, 'app');
const require = createRequire(path.join(ROOT, 'package.json'));
const esbuild = require('esbuild');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function listFiles(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listFiles(path.join(dir, entry.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(APP_DIST)) {
    throw new Error('dist/app/ does not exist — run vite build first.');
  }

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'sw.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    outfile: path.join(APP_DIST, 'sw.js'),
    logLevel: 'warning',
  });
  console.log('build-meta: bundled src/sw.ts -> dist/app/sw.js');

  // Listed after bundling so sw.js is included; the worker caches buildinfo.js itself.
  // Scoped to the app only: the root landing page and the public docs (llms.txt, api.txt,
  // the CLI, schema/, pages/) sit outside the app's service worker scope on purpose. Vite
  // puts every entry's JS/CSS chunks in one shared dist/assets/, not under dist/app/, but
  // names them after their entry point — "app-<hash>" for this one — so they're told apart
  // from the root landing page's own chunks (if it ever grows any) by that prefix alone.
  const appAssets = listFiles(path.join(DIST, 'assets'))
    .filter((f) => f.startsWith('app-'))
    .map((f) => `../assets/${f}`);
  const files = [...listFiles(APP_DIST).filter((f) => f !== 'buildinfo.js'), ...appAssets].sort();
  const info = {
    commit: git(['rev-parse', 'HEAD']),
    builtAt: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(
    path.join(APP_DIST, 'buildinfo.js'),
    `self.BUILD_INFO=${JSON.stringify(info)};\n`
  );
  console.log(
    `build-meta: wrote dist/app/buildinfo.js (${files.length} files, commit ${info.commit.slice(0, 8)})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
