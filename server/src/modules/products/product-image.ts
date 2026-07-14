// Validates uploaded product images against GoFood's requirements: PNG,
// square (1:1), and ≤1MB. Dimensions are read from the PNG IHDR chunk so no
// image library is needed. Errors are returned (Bahasa Indonesia) rather than
// thrown so the route can turn them into 400s.

export const MAX_IMAGE_BYTES = 1_048_576; // 1 MB, per GoFood

// PNG signature: 89 50 4E 47 0D 0A 1A 0A
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ValidateImageResult =
  | { ok: true; width: number; height: number }
  | { ok: false; error: string };

export function validateSquarePng(buffer: Buffer): ValidateImageResult {
  if (buffer.length === 0) {
    return { ok: false, error: "Gambar kosong." };
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Ukuran gambar melebihi 1 MB." };
  }
  // Need at least the 8-byte signature + IHDR (length 4 + "IHDR" 4 + data 13).
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false, error: "Gambar harus berformat PNG." };
  }
  // First chunk after the signature must be IHDR (bytes 12–16), with width at
  // bytes 16–20 and height at bytes 20–24 (big-endian).
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    return { ok: false, error: "File PNG tidak valid." };
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width === 0 || height === 0) {
    return { ok: false, error: "Dimensi gambar tidak valid." };
  }
  if (width !== height) {
    return { ok: false, error: "Gambar harus berbentuk persegi (rasio 1:1)." };
  }
  return { ok: true, width, height };
}

// Public upload filenames are validated to be nothing but a nanoid + .png, so
// the serving route can safely join them onto the uploads directory.
const UPLOAD_FILENAME_RE = /^[A-Za-z0-9_-]{1,64}\.png$/;

export function isSafeUploadFilename(filename: string): boolean {
  return UPLOAD_FILENAME_RE.test(filename);
}
