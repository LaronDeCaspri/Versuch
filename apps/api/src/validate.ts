import { badRequest } from "./errors.js";

type Obj = Record<string, unknown>;

export function asObject(body: unknown): Obj {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest("Expected a JSON object");
  return body as Obj;
}

export function str(o: Obj, key: string, opts: { min?: number; max?: number } = {}): string {
  const v = o[key];
  if (typeof v !== "string") throw badRequest(`Field "${key}" must be a string`);
  const t = v.trim();
  if (t.length < (opts.min ?? 1)) throw badRequest(`Field "${key}" is required`);
  if (opts.max !== undefined && t.length > opts.max) throw badRequest(`Field "${key}" is too long`);
  return t;
}

export function optStr(o: Obj, key: string): string | null {
  const v = o[key];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw badRequest(`Field "${key}" must be a string`);
  return v.trim();
}

export function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[]): T {
  const v = o[key];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw badRequest(`Field "${key}" must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}
