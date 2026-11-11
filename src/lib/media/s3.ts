// Large uploads (10 Nov 2026) - the real bucket: Lightsail object storage (the S3 API), private, versioning on.
// OUTBOUND CONNECTION #8 (Ilies approved, 10 Nov 2026). The server may reach ONLY
//   <bucket>.s3.ap-southeast-2.amazonaws.com   (and s3.ap-southeast-2.amazonaws.com, should the SDK use it)
// - checked on every request the SDK sends (a middleware just before it goes) and on every signed address handed to a
// phone. 20 s per request, 2 tries. Errors are reduced to the operation and a code: never the message, an address, a
// key or a signature. The keys come from MEDIA_ACCESS_KEY_ID / MEDIA_SECRET_ACCESS_KEY and go to the client only.
// Server only - loaded by ./store.ts with a dynamic import, never by a browser bundle.
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetObjectCommand, HeadObjectCommand,
  ListMultipartUploadsCommand, ListObjectVersionsCommand, ListPartsCommand, PutObjectCommand, S3Client, UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MEDIA_REGION, MediaStoreError, type HeadResult, type MediaStore, type UploadPartRef } from "./store";

export const allowedHosts = (bucket: string) => [`${bucket}.s3.${MEDIA_REGION}.amazonaws.com`, `s3.${MEDIA_REGION}.amazonaws.com`];

// The host of a URL is on the list (https only, default port) - or it is refused.
export function hostAllowed(url: string, bucket: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.port === "" && allowedHosts(bucket).includes(u.hostname);
  } catch { return false; }
}

// Whatever the SDK threw, as an operation and a code only.
function scrub(op: string, e: unknown): MediaStoreError {
  const x = e as { name?: unknown; $metadata?: { httpStatusCode?: unknown }; Code?: unknown };
  const name = typeof x?.name === "string" && /^[A-Za-z]{1,40}$/.test(x.name) ? x.name : "Error";
  const status = typeof x?.$metadata?.httpStatusCode === "number" ? x.$metadata.httpStatusCode : null;
  return new MediaStoreError(op, name === "NoSuchUpload" ? "NO_UPLOAD" : status ? `${name}/${status}` : name);
}

export async function makeS3Store(o: { bucket: string; accessKeyId: string; secretAccessKey: string }): Promise<MediaStore> {
  const Bucket = o.bucket;
  const client = new S3Client({
    region: MEDIA_REGION,
    credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
    forcePathStyle: false, // <bucket>.s3.ap-southeast-2.amazonaws.com
    followRegionRedirects: false, // never chase the bucket to another region / host
    disableS3ExpressSessionAuth: true,
    // Checksums only where S3 needs one: a phone's PUT to a signed address can't add the SDK's own checksum headers.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 2,
    requestHandler: { requestTimeout: 20_000, connectionTimeout: 5_000 },
  });
  // The allowlist, on every request the SDK sends - just before it leaves.
  client.middlewareStack.add(
    (next) => async (args) => {
      const req = args.request as { hostname?: string; protocol?: string; port?: number };
      if (req.protocol !== "https:" || req.port != null && req.port !== 443 || !allowedHosts(Bucket).includes(req.hostname ?? "")) {
        throw new MediaStoreError("request", "HOST_NOT_ALLOWED");
      }
      return next(args);
    },
    { step: "finalizeRequest", name: "lobosMediaHostAllowlist", priority: "low" },
  );
  const signed = async (op: string, make: () => Promise<string>) => {
    let url: string;
    try { url = await make(); } catch (e) { throw scrub(op, e); }
    if (!hostAllowed(url, Bucket)) throw new MediaStoreError(op, "HOST_NOT_ALLOWED");
    return url;
  };
  const call = async <T>(op: string, f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) { throw e instanceof MediaStoreError ? e : scrub(op, e); }
  };

  return {
    name: "s3",
    // Content-Type AND Content-Length are signed (PS-043 - tested on the real bucket 11 Nov 2026: a bigger body gets 403
    // SignatureDoesNotMatch): the PUT must send exactly that type and that many bytes, one key, one method, ttl seconds.
    presignPut: (key, mime, bytes, ttlSec) => signed("presignPut", () => getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: mime, ContentLength: bytes }),
      { expiresIn: ttlSec, signableHeaders: new Set(["content-type", "content-length"]) })),
    createMultipart: (key, mime) => call("createMultipart", async () => {
      const r = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: mime }));
      if (!r.UploadId) throw new MediaStoreError("createMultipart", "NO_UPLOAD_ID");
      return r.UploadId;
    }),
    // A part's exact length is signed too (PS-043).
    presignPart: (key, uploadId, n, bytes, ttlSec) =>
      signed("presignPart", () => getSignedUrl(client, new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: n, ContentLength: bytes }),
        { expiresIn: ttlSec, signableHeaders: new Set(["content-length"]) })),
    listParts: (key, uploadId) => call("listParts", async () => {
      const out: UploadPartRef[] = [];
      let marker: string | undefined;
      for (let page = 0; page < 20; page++) {
        const r = await client.send(new ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, MaxParts: 1000, PartNumberMarker: marker }));
        for (const p of r.Parts ?? []) if (p.PartNumber && p.ETag) out.push({ n: p.PartNumber, etag: p.ETag, size: Number(p.Size ?? 0) });
        if (!r.IsTruncated) break;
        marker = r.NextPartNumberMarker;
      }
      return out;
    }),
    completeMultipart: (key, uploadId, parts) => call("completeMultipart", async () => {
      await client.send(new CompleteMultipartUploadCommand({
        Bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: [...parts].sort((a, b) => a.n - b.n).map((p) => ({ PartNumber: p.n, ETag: p.etag })) },
      }));
    }),
    abortMultipart: (key, uploadId) => call("abortMultipart", async () => { await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId })); }),
    head: (key) => call("head", async (): Promise<HeadResult | null> => {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: Number(r.ContentLength ?? -1), contentType: r.ContentType ?? null, versionId: r.VersionId ?? null };
      } catch (e) {
        const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (x?.name === "NotFound" || x?.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    }),
    getRange: (key, versionId, start, end) => call("getRange", async () => {
      const r = await client.send(new GetObjectCommand({ Bucket, Key: key, VersionId: versionId ?? undefined, Range: `bytes=${start}-${end}` }));
      if (!r.Body) return new Uint8Array(0);
      return await r.Body.transformToByteArray();
    }),
    // PS-043's usage watch (the bucket key may list versions and unfinished uploads - checked on the server 11 Nov 2026).
    listVersions: () => call("listVersions", async () => {
      const out: { key: string; versionId: string | null; size: number }[] = [];
      let KeyMarker: string | undefined, VersionIdMarker: string | undefined;
      for (let page = 0; page < 200; page++) {
        const r = await client.send(new ListObjectVersionsCommand({ Bucket, KeyMarker, VersionIdMarker, MaxKeys: 1000 }));
        for (const v of r.Versions ?? []) if (v.Key) out.push({ key: v.Key, versionId: v.VersionId && v.VersionId !== "null" ? v.VersionId : null, size: Number(v.Size ?? 0) });
        if (!r.IsTruncated) break;
        KeyMarker = r.NextKeyMarker; VersionIdMarker = r.NextVersionIdMarker;
      }
      return out;
    }),
    listUploads: () => call("listUploads", async () => {
      const ups: { key: string; uploadId: string }[] = [];
      let KeyMarker: string | undefined, UploadIdMarker: string | undefined;
      for (let page = 0; page < 20; page++) {
        const r = await client.send(new ListMultipartUploadsCommand({ Bucket, KeyMarker, UploadIdMarker, MaxUploads: 1000 }));
        for (const u of r.Uploads ?? []) if (u.Key && u.UploadId) ups.push({ key: u.Key, uploadId: u.UploadId });
        if (!r.IsTruncated) break;
        KeyMarker = r.NextKeyMarker; UploadIdMarker = r.NextUploadIdMarker;
      }
      const out: { key: string; uploadId: string; bytes: number }[] = [];
      for (const u of ups.slice(0, 500)) {
        const r = await client.send(new ListPartsCommand({ Bucket, Key: u.key, UploadId: u.uploadId, MaxParts: 1000 })).catch(() => null);
        out.push({ ...u, bytes: (r?.Parts ?? []).reduce((a, p) => a + Number(p.Size ?? 0), 0) });
      }
      return out;
    }),
    presignGet: (key, versionId, ttlSec, o2) => signed("presignGet", () => getSignedUrl(client, new GetObjectCommand({
      Bucket, Key: key, VersionId: versionId ?? undefined, ResponseContentType: o2.mime,
      ResponseContentDisposition: o2.download ? `attachment; filename="${o2.download.replace(/[^A-Za-z0-9._-]/g, "")}"` : "inline",
      ResponseCacheControl: "private, max-age=300",
    }), { expiresIn: ttlSec })),
  };
}
