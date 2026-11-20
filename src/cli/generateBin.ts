/** Entry point of the bundled generate script (public/vibecomics-generate.mjs). */
import { runGenerate } from './generateMain';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  process.stderr.write(
    `error: vibecomics-generate needs Node.js 20 or newer (this is ${process.version}).\n`
  );
  process.exit(1);
}

process.exitCode = await runGenerate(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
});
