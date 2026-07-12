export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api";

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text === "" ? null : (JSON.parse(text) as unknown);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Extracts the download filename from a Content-Disposition header, if present. */
function filenameFromDisposition(header: string | null): string | null {
  if (header === null) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star !== null && star[1] !== undefined) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* malformed encoding — fall through to the plain form */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  if (plain !== null && plain[1] !== undefined) return plain[1].trim();
  return null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  async upload<T>(path: string, file: File): Promise<T> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "include", body: form });
    return parse<T>(res);
  },
  /** Fetches a binary response and triggers a browser download using the server filename. */
  async download(path: string, fallbackName: string): Promise<void> {
    const res = await fetch(`${BASE}${path}`, { credentials: "include" });
    if (!res.ok) {
      const text = await res.text();
      let code = "ERROR";
      let message = `Request failed (${res.status})`;
      try {
        const data = text === "" ? null : (JSON.parse(text) as { error?: { code?: string; message?: string } });
        if (data?.error?.code !== undefined) code = data.error.code;
        if (data?.error?.message !== undefined) message = data.error.message;
      } catch {
        /* non-JSON error body — keep the generic message */
      }
      throw new ApiError(res.status, code, message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? fallbackName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};
