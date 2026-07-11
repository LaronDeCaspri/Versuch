function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing env var: ${name}`);
  return value;
}

export interface Env {
  readonly port: number;
  readonly sessionSecret: string;
  readonly cookieSecure: boolean;
  readonly nodeEnv: string;
}

export function loadEnv(): Env {
  const secret = required("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return {
    port: Number(process.env["PORT"] ?? 3000),
    sessionSecret: secret,
    cookieSecure: process.env["COOKIE_SECURE"] === "true",
    nodeEnv: process.env["NODE_ENV"] ?? "development",
  };
}
