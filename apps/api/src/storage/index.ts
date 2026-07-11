import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface FileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/** Dev/test driver: writes under a base directory. */
class LocalStorage implements FileStorage {
  constructor(private readonly baseDir: string) {}

  private path(key: string): string {
    const full = resolve(this.baseDir, key);
    if (!full.startsWith(resolve(this.baseDir))) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
}

export async function createStorage(): Promise<FileStorage> {
  const driver = process.env["STORAGE_DRIVER"] ?? "local";
  if (driver === "local") {
    return new LocalStorage(process.env["STORAGE_DIR"] ?? join(process.cwd(), ".storage"));
  }
  if (driver === "s3") {
    const { createS3Storage } = await import("./s3.js");
    return createS3Storage();
  }
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
}
