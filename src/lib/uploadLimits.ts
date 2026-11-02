// How big a file one save can carry (2 Nov 2026, Ilies: "yes queue those two" - the compliance and invoice uploads get
// the purchases treatment, option A). Next cuts any request body to 10 MB when middleware runs
// (experimental.middlewareClientMaxBodySize, left as it is) and these files travel base64 in JSON - 4/3 their size - so
// 7 MB is the most one save can carry. A body the server can't read is 413 with plain words (lib/jsonBody.ts), never a
// misleading "No file was sent". No server imports; `npm test` (uploadLimits.test.ts).
export const UPLOAD_FILE_MAX = 7 * 1024 * 1024;
export const UPLOAD_TOO_LARGE = "Too large (7 MB per file) - send big files one at a time.";
export const NEXT_BODY_LIMIT = 10 * 1024 * 1024; // Next's default middlewareClientMaxBodySize
export const fileTooLarge = (bytes: number) => bytes > UPLOAD_FILE_MAX;
// The bytes a data URL carries, without decoding it (for the browser's own check before sending).
export const dataUrlBytes = (dataUrl: string) => {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
};
