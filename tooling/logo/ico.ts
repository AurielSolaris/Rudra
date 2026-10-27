/**
 * Windows `.ico` container.
 *
 * ICO is a directory of images, not an image format: a six-byte header, a
 * sixteen-byte entry per image, then the payloads. Since Vista each payload may
 * be a whole PNG file rather than a DIB, which is what we write — the alternative
 * is emitting BMP with an AND mask by hand, for no benefit.
 *
 * Written here rather than taken from a package because the whole format is the
 * fifty lines below, and a build-time dependency that writes a header is a
 * dependency we would still have to read.
 */

/** ICO stores a 256px side as 0. Anything larger has no representation. */
const SIDE_IN_BYTE = (size: number): number => (size >= 256 ? 0 : size);

export interface IcoImage {
   /** Square side in pixels. 256 is the largest the format can describe. */
   readonly size: number;
   /** A complete PNG file. */
   readonly png: Uint8Array;
}

/**
 * Pack PNGs into one `.ico`.
 *
 * Entries are written smallest-first, which is the order Explorer expects when
 * it picks a representation for a given display size.
 */
export function buildIco(images: readonly IcoImage[]): Uint8Array {
   if (images.length === 0) throw new Error('An .ico needs at least one image.');
   for (const image of images) {
      if (image.size < 1 || image.size > 256) {
         throw new Error(`.ico cannot hold a ${image.size}px image; the range is 1-256.`);
      }
   }

   const ordered = [...images].sort((a, b) => a.size - b.size);

   const HEADER_BYTES = 6;
   const ENTRY_BYTES = 16;
   const directoryBytes = HEADER_BYTES + ENTRY_BYTES * ordered.length;
   const totalBytes = ordered.reduce((sum, image) => sum + image.png.byteLength, directoryBytes);

   const out = new Uint8Array(totalBytes);
   const view = new DataView(out.buffer);

   // ICONDIR: reserved, type 1 (icon), image count. Little-endian throughout.
   view.setUint16(0, 0, true);
   view.setUint16(2, 1, true);
   view.setUint16(4, ordered.length, true);

   let entryAt = HEADER_BYTES;
   let payloadAt = directoryBytes;

   for (const image of ordered) {
      // ICONDIRENTRY
      out[entryAt] = SIDE_IN_BYTE(image.size); // width
      out[entryAt + 1] = SIDE_IN_BYTE(image.size); // height
      out[entryAt + 2] = 0; // palette size; 0 = truecolour
      out[entryAt + 3] = 0; // reserved
      view.setUint16(entryAt + 4, 1, true); // colour planes
      view.setUint16(entryAt + 6, 32, true); // bits per pixel
      view.setUint32(entryAt + 8, image.png.byteLength, true);
      view.setUint32(entryAt + 12, payloadAt, true);

      out.set(image.png, payloadAt);

      entryAt += ENTRY_BYTES;
      payloadAt += image.png.byteLength;
   }

   return out;
}
