export type ErrorCode =
  | "not_found"
  | "unavailable"
  | "api_key_missing"
  | "suspicious"
  | "invalid"
  | "rate_limited";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}
