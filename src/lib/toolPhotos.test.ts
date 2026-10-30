// savePhoto - shared by tool photos, site requests, the daily log's photos and the before / after photos - keeps a file
// only when its bytes really are a JPEG, PNG or WebP (SEC-BA-003). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { imageTypeOf, readPhoto, savePhoto } from "./toolPhotos";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const url = (type: string, b: Buffer) => `data:${type};base64,${b.toString("base64")}`;

test("the real type comes from the first bytes", () => {
  assert.equal(imageTypeOf(PNG), "image/png");
  assert.equal(imageTypeOf(JPEG), "image/jpeg");
  assert.equal(imageTypeOf(WEBP), "image/webp");
  assert.equal(imageTypeOf(Buffer.from("<html><script>x</script>")), null);
  assert.equal(imageTypeOf(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])), null, "a RIFF that isn't WebP (a WAV)");
  assert.equal(imageTypeOf(Buffer.from([0xff, 0xd8])), null, "too short");
});

test("savePhoto keeps real photos (the extension from the bytes) and refuses anything that only claims to be one", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "photos-test-"));
  const before = process.env.TOOL_PHOTO_DIR;
  process.env.TOOL_PHOTO_DIR = dir;
  try {
    const png = await savePhoto(url("image/png", PNG));
    assert.ok("fileName" in png && png.fileName.endsWith(".png"), JSON.stringify(png));
    assert.deepEqual(await readPhoto((png as { fileName: string }).fileName), PNG);
    const jpeg = await savePhoto(url("image/jpeg", JPEG));
    assert.ok("fileName" in jpeg && jpeg.fileName.endsWith(".jpg"));
    const mislabelled = await savePhoto(url("image/jpeg", PNG));
    assert.ok("fileName" in mislabelled && mislabelled.fileName.endsWith(".png"), "a PNG sent as image/jpeg is kept as .png");
    for (const bad of [url("image/jpeg", Buffer.from("<html><script>alert(1)</script></html>")), url("image/png", Buffer.from("GIF89a....")), url("image/webp", Buffer.from("RIFF0000WAVEfmt "))]) {
      const r = await savePhoto(bad);
      assert.ok("error" in r && /JPEG, PNG or WebP/.test(r.error), JSON.stringify(r));
    }
    assert.equal(readdirSync(dir).length, 3, "nothing written for the refused ones");
  } finally {
    if (before === undefined) delete process.env.TOOL_PHOTO_DIR; else process.env.TOOL_PHOTO_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
