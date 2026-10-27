/**
 * Format Dart sources, skipping generated output.
 *
 * Why this exists: `dart format` reformats `app/lib/api/generated/models.dart`
 * into a shape the generator does not emit, so `codegen:check` then reports
 * permanent drift — the generator and the formatter each "correct" the other.
 *
 * The generated file is not read by people (it carries its own
 * `ignore_for_file` header), so the generator's output is canonical and the
 * formatter leaves it alone.
 *
 * Usage: bun run tooling/fmt-dart/index.ts [--check]
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const APP = resolve(import.meta.dir, '../../app');
const ROOTS = ['lib', 'test'];

/** Paths whose contents are owned by a generator, not by `dart format`. */
const SKIP = [join('lib', 'api', 'generated')];

function collect(dir: string, out: string[]): void {
   let entries: string[];
   try {
      entries = readdirSync(dir);
   } catch {
      return;
   }

   for (const entry of entries) {
      const full = join(dir, entry);
      const relative = full.slice(APP.length + 1);
      if (SKIP.some((s) => relative === s || relative.startsWith(s + sep))) continue;

      if (statSync(full).isDirectory()) {
         collect(full, out);
      } else if (entry.endsWith('.dart')) {
         out.push(full);
      }
   }
}

const files: string[] = [];
for (const root of ROOTS) collect(join(APP, root), files);

if (files.length === 0) {
   globalThis.process.stderr.write('No Dart files found.\n');
   globalThis.process.exit(1);
}

const check = globalThis.process.argv.includes('--check');
const args = [
   'format',
   '--line-length',
   '80',
   ...(check ? ['--output', 'none', '--set-exit-if-changed'] : []),
   ...files,
];

const proc = Bun.spawnSync(['dart', ...args], { cwd: APP, stdout: 'inherit', stderr: 'inherit' });
globalThis.process.exit(proc.exitCode);
