/**
 * SVG -> every raster the app ships.
 *
 * The logo is authored once, as SVG, and rasterized here. Nothing in the repo
 * is a hand-made PNG: an icon edited as pixels is an icon that drifts from its
 * source the first time someone touches it, which is the same failure
 * `schema-to-dart` exists to prevent for types (INVARIANT 10).
 *
 * Two modes, matching the codegen tool next door:
 *   `bun run logo`         writes the rasters
 *   `bun run logo:check`   exits non-zero if a committed raster is stale
 *
 * **Why there are two SVG masters.** `rudra.svg` is the full feather. Below
 * roughly 64px its plume averages away to grey haze and the remaining
 * silhouette reads as a map pin, so sizes at or under `SMALL_AT_OR_BELOW` come
 * from `rudra-small.svg` — the ocellus alone, which is what survives. Both
 * masters are hand-editable; edit them together.
 *
 * `@resvg/resvg-js` does the rasterizing. It is a **devDependency in tooling/**
 * and never reaches the sidecar binary or the Flutter bundle, so it has no
 * bearing on the install size PLAN.MD §3 is careful about.
 */

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { buildIco, type IcoImage } from './ico.ts';

const ROOT = resolve(import.meta.dir, '../..');
const MASTER = join(import.meta.dir, 'rudra.svg');
const MASTER_SMALL = join(import.meta.dir, 'rudra-small.svg');

/** At or below this side, the simplified master is used instead. */
const SMALL_AT_OR_BELOW = 64;

/** Sides packed into the Windows `.ico`. 256 is the format's ceiling. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

/** Sides the macOS asset catalogue names in its `Contents.json`. */
const MACOS_SIZES = [16, 32, 64, 128, 256, 512, 1024] as const;

/** Sides the Flutter app bundles for in-app use (about box, boot screen). */
const APP_ASSET_SIZES = [64, 256, 512] as const;

function master(size: number): string {
   return size <= SMALL_AT_OR_BELOW ? MASTER_SMALL : MASTER;
}

const sourceCache = new Map<string, string>();

function readMaster(path: string): string {
   const cached = sourceCache.get(path);
   if (cached !== undefined) return cached;
   const svg = readFileSync(path, 'utf8');
   sourceCache.set(path, svg);
   return svg;
}

/** Rasterize one square PNG at `size` from whichever master suits it. */
function render(size: number): Uint8Array {
   const svg = readMaster(master(size));
   const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
      // The mark is transparent on purpose: it has to sit on both themes
      // (#FAFBFD and #0B0F17), and a baked-in ground would be wrong on one.
      background: 'rgba(0,0,0,0)',
      shapeRendering: 2, // geometricPrecision — these are small, quality wins
   });
   return new Uint8Array(resvg.render().asPng());
}

interface Artifact {
   readonly path: string;
   readonly bytes: Uint8Array;
}

function artifacts(): Artifact[] {
   const out: Artifact[] = [];

   // Windows: one .ico holding every size Explorer might ask for.
   const icoImages: IcoImage[] = ICO_SIZES.map((size) => ({ size, png: render(size) }));
   out.push({
      path: join(ROOT, 'app/windows/runner/resources/app_icon.ico'),
      bytes: buildIco(icoImages),
   });

   // macOS: loose PNGs, named exactly as the asset catalogue expects.
   for (const size of MACOS_SIZES) {
      out.push({
         path: join(
            ROOT,
            `app/macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_${size}.png`,
         ),
         bytes: render(size),
      });
   }

   // Linux has no icon slot in the Flutter runner; the .desktop file points at
   // a PNG supplied at packaging time (Phase 4), so one is emitted for it.
   out.push({ path: join(ROOT, 'app/linux/runner/resources/app_icon.png'), bytes: render(256) });

   // Bundled with the app itself, for anywhere the UI draws the mark.
   for (const size of APP_ASSET_SIZES) {
      out.push({ path: join(ROOT, `app/assets/logo/rudra-${size}.png`), bytes: render(size) });
   }

   return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
   if (a.byteLength !== b.byteLength) return false;
   for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
   return true;
}

function main(): void {
   const check = globalThis.process.argv.includes('--check');
   const built = artifacts();

   if (check) {
      const stale: string[] = [];
      for (const artifact of built) {
         const where = relative(ROOT, artifact.path);
         if (!existsSync(artifact.path)) {
            stale.push(`${where} (missing)`);
            continue;
         }
         if (!sameBytes(readFileSync(artifact.path), artifact.bytes)) {
            stale.push(where);
         }
      }

      if (stale.length > 0) {
         globalThis.process.stderr.write(
            'logo:check FAILED — a raster does not match the SVG master.\n' +
               stale.map((s) => `  ${s}\n`).join('') +
               'Run: bun run logo\n',
         );
         globalThis.process.exit(1);
      }
      globalThis.process.stderr.write(
         `logo:check ok — ${built.length} rasters match the SVG masters.\n`,
      );
      return;
   }

   for (const artifact of built) {
      mkdirSync(dirname(artifact.path), { recursive: true });
      writeFileSync(artifact.path, artifact.bytes);
   }
   globalThis.process.stderr.write(
      `wrote ${built.length} rasters from ${relative(ROOT, MASTER)} and ` +
         `${relative(ROOT, MASTER_SMALL)}\n`,
   );
}

if (import.meta.main) {
   main();
}

export { artifacts, render };
