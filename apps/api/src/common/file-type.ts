/**
 * Content sniffing for uploads. The MIME type a browser sends is only a claim; uploads are
 * checked against their first bytes so, for example, an HTML or SVG file cannot be stored as
 * a "screenshot" and later rendered inline.
 */
const SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1')) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'video/webm', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: 'application/zip', test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

export const RASTER_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** The binary type the bytes really are, or null for text / unknown content. */
export function sniff(buf: Buffer): string | null {
  return SIGNATURES.find((s) => s.test(buf))?.mime ?? null;
}

function looksLikeText(buf: Buffer): boolean {
  const head = buf.subarray(0, 4096);
  if (head.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 4))); return true; } catch { return false; }
}

/**
 * Returns the MIME type to store for an upload whose browser-claimed type is already on an
 * allowlist, or an error message when the bytes do not match the claim.
 */
export function verifyUpload(claimed: string, buf: Buffer): { mime: string } | { error: string } {
  const real = sniff(buf);
  if (claimed.startsWith('image/') || claimed.startsWith('video/') || claimed === 'application/zip' || claimed === 'application/pdf') {
    if (!real) return { error: `The file content is not a valid ${claimed} file` };
    if (claimed.split('/')[0] !== real.split('/')[0] || (claimed.startsWith('application/') && claimed !== real)) {
      return { error: `The file content (${real}) does not match its type (${claimed})` };
    }
    return { mime: real };
  }
  // text/plain, application/json: must really be text, never a disguised binary or image.
  if (real || !looksLikeText(buf)) return { error: `The file content does not match its type (${claimed})` };
  return { mime: claimed };
}

/**
 * Response headers for serving a stored file. Only genuine raster images are shown inline;
 * everything else downloads. A sandbox CSP stops any active content from running.
 */
export function fileHeaders(mime: string, data: Buffer, fileName: string): Record<string, string> {
  const real = sniff(data);
  const inline = !!real && RASTER_IMAGES.has(real);
  const type = inline ? real! : real ?? (/^(text\/plain|text\/csv|application\/json)(;|$)/.test(mime) ? `${mime.split(';')[0]}; charset=utf-8` : 'application/octet-stream');
  return {
    'Content-Type': type,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
}
