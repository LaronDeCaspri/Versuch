import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { FileStorage } from "./index.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * In-Kingdom S3-compatible object storage. Endpoint and region come from env so
 * the same code targets any PDPL-compliant provider without a code change.
 */
class S3Storage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = requireEnv("S3_BUCKET");
    const endpoint = process.env["S3_ENDPOINT"];
    this.client = new S3Client({
      region: requireEnv("S3_REGION"),
      forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] === "true",
      credentials: {
        accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
      },
      ...(endpoint !== undefined && endpoint !== "" ? { endpoint } : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (bytes === undefined) throw new Error(`Empty object: ${key}`);
    return Buffer.from(bytes);
  }
}

export function createS3Storage(): FileStorage {
  return new S3Storage();
}
