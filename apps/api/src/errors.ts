export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string): AppError => new AppError(400, "BAD_REQUEST", msg);
export const unauthorized = (msg = "Not authenticated"): AppError => new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "Not permitted"): AppError => new AppError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Not found"): AppError => new AppError(404, "NOT_FOUND", msg);
export const conflict = (msg: string): AppError => new AppError(409, "CONFLICT", msg);
