/**
 * Errors this package throws.
 *
 * Two families, as in the Go and Python SDKs:
 *
 * - {@link APIError} and its subclasses — the API refused the request.
 * - {@link TaskFailed} / {@link Blocked} — the API accepted the task but the
 *   page could not be scraped. Failed tasks are refunded.
 */

import type { Result } from "./models.js";

/** Base class for every error this package throws. */
export class DataFuelError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** No key was passed and DATAFUEL_API_KEY is empty. Thrown before any request. */
export class NoApiKey extends DataFuelError {}

/** The request never got an answer: DNS, connection, abort, read timeout. */
export class TransportError extends DataFuelError {}

/** The `code` of an API error. The API may add codes; unknown ones pass through. */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_API_KEY"
  | "FORBIDDEN"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMIT_EXCEEDED"
  | "CONCURRENCY_LIMIT_REACHED"
  | "INVALID_REQUEST_BODY"
  | "INVALID_ATTRIBUTES"
  | "MISSING_TARGET"
  | "UNSUPPORTED_TASK_TYPE"
  | "JOB_REQUIRES_MULTIPLE_TARGETS"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_TASK_ID"
  | "INVALID_JOB_ID"
  | "TASK_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "CRAWL_NOT_FOUND"
  | "JOB_NOT_CANCELLABLE"
  | "INVALID_CRAWL_PATTERN"
  | "CRAWL_UNSUPPORTED_OPTION"
  | "INVALID_CURSOR"
  | "INVALID_PROXY_TYPE"
  | "INVALID_COUNTRY"
  | "INVALID_DATE_FORMAT"
  | "INVALID_DATE_RANGE"
  | "INVALID_INTERVAL"
  | "MODULE_UNAVAILABLE"
  | "ENGINE_UNAVAILABLE"
  | "API_KEY_RESET_FAILED"
  | "TASK_RESULT_TIMEOUT"
  | "INTERNAL_ERROR"
  | (string & {});

/** A non-2xx answer from the API itself. */
export class APIError extends DataFuelError {
  readonly status: number;
  readonly code: ErrorCode;
  /** Seconds the API asked us to wait, from Retry-After. 0 when absent. */
  readonly retryAfter: number;

  constructor(status: number, code: string, message: string, retryAfter = 0) {
    super(code ? `${message} (${status} ${code})` : `${message} (${status})`);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** 401: the API key is missing or invalid. */
export class Unauthorized extends APIError {}
/** 403 FORBIDDEN: the account is inactive. */
export class Forbidden extends APIError {}
/** 404: unknown id, or one that belongs to another account. */
export class NotFound extends APIError {}
/** 429: the account's request rate or concurrency limit was reached. */
export class RateLimited extends APIError {}
/** 402: not enough credits for this task. */
export class InsufficientCredits extends APIError {}
/** 400 INVALID_ATTRIBUTES: the attributes do not match the task type. */
export class InvalidAttributes extends APIError {}
/** 422: the key was already used for a different request. */
export class IdempotencyKeyReused extends APIError {}
/** 409 JOB_NOT_CANCELLABLE: the job or crawl already finished. */
export class JobNotCancellable extends APIError {}
/** 503: an operator switched something off, or a dependency is down. The message carries the reason. */
export class Unavailable extends APIError {}
/** 503 MODULE_UNAVAILABLE: this task type is switched off. Nothing was charged. */
export class ModuleUnavailable extends Unavailable {}
/** 503 ENGINE_UNAVAILABLE: this LLM engine is switched off. Nothing was charged. */
export class EngineUnavailable extends Unavailable {}

/**
 * The task was accepted but could not be completed. Refunded.
 *
 * `result` carries the envelope: `statusCode`, `blocked`, `protection`, `error`.
 */
export class TaskFailed extends DataFuelError {
  readonly result: Result;

  constructor(result: Result) {
    const detail = result.error ?? result.payload?.error_detail ?? "no detail";
    super(`task failed: ${detail}`);
    this.result = result;
  }

  /** Anti-bot vendor recognised on the target, when there was one. */
  get protection(): string | undefined {
    return this.result.protection;
  }
}

/**
 * The target refused or challenged the request (403/429/503, anti-bot wall).
 *
 * Refunded. Retry with `jsRendering: true` or a Premium proxy.
 */
export class Blocked extends TaskFailed {}

/**
 * A wait ran out of time. The work keeps running and billing server-side.
 *
 * `id` picks it back up (`waitCrawl`, `jobResults`, or a re-send under the same
 * idempotency key); `status` is the last one seen, when there was one.
 */
export class WaitTimeout extends DataFuelError {
  readonly id: string | undefined;
  readonly status: unknown;

  constructor(message: string, id?: string, status?: unknown) {
    super(message);
    this.id = id;
    this.status = status;
  }
}

const BY_CODE: Record<string, new (s: number, c: string, m: string, r?: number) => APIError> = {
  MODULE_UNAVAILABLE: ModuleUnavailable,
  ENGINE_UNAVAILABLE: EngineUnavailable,
  INSUFFICIENT_CREDITS: InsufficientCredits,
  INVALID_ATTRIBUTES: InvalidAttributes,
  IDEMPOTENCY_KEY_REUSED: IdempotencyKeyReused,
  INVALID_API_KEY: Unauthorized,
  FORBIDDEN: Forbidden,
  JOB_NOT_CANCELLABLE: JobNotCancellable,
};

const BY_STATUS: Record<number, new (s: number, c: string, m: string, r?: number) => APIError> = {
  401: Unauthorized,
  402: InsufficientCredits,
  403: Forbidden,
  404: NotFound,
  409: JobNotCancellable,
  422: IdempotencyKeyReused,
  429: RateLimited,
  503: Unavailable,
};

/** Map an error answer onto the narrowest class that fits. */
export function apiError(status: number, body: unknown, retryAfter = 0): APIError {
  let code = "";
  let message = "";
  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    code = typeof record.code === "string" ? record.code : "";
    message = typeof record.message === "string" ? record.message : "";
  } else if (typeof body === "string" && body.length > 0 && body.length <= 300) {
    message = body;
  }
  const Cls = BY_CODE[code] ?? BY_STATUS[status] ?? APIError;
  return new Cls(status, code, message || `HTTP ${status}`, retryAfter);
}
