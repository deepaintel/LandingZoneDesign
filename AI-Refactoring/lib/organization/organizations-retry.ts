/**
 * Bounded exponential backoff with full jitter for AWS Organizations API calls.
 *
 * Follows the pattern of the AWS Landing Zone Accelerator `throttlingBackOff` utility
 * (`source/packages/@aws-accelerator/utils/lib/throttle.ts`, release/v1.16.3): a 150 ms starting
 * delay, 12 attempts, full jitter, and an explicit retry predicate. The predicate here is limited
 * to errors AWS Organizations returns; LZA's conditions for other services are not carried over.
 *
 * This is the only retry layer for Organizations calls. `createOrganizationsClient` sets the SDK's
 * own `maxAttempts` to 1, so a logical request makes at most `ORGANIZATIONS_RETRY_MAX_ATTEMPTS`
 * calls in total.
 *
 * Retry safety depends on the operation:
 *  - `idempotent` (reads and `TagResource`): retried on throttling, concurrent modification,
 *    internal service errors, SDK-flagged retryable errors, and transient network errors.
 *  - `non-idempotent` (`CreateAccount`, `MoveAccount`): retried only on errors that prove AWS
 *    rejected the request without acting on it (throttling and concurrent modification). An
 *    internal or network error may arrive after AWS accepted the request, and repeating a
 *    `CreateAccount` would submit a second request for the same email. Those errors fail the
 *    run; the next run reconciles from the live Organization.
 */

export const ORGANIZATIONS_RETRY_START_DELAY_MS = 150;
export const ORGANIZATIONS_RETRY_MAX_ATTEMPTS = 12;
/** Caps a single wait. Without it the twelfth attempt could wait up to 150 ms x 2^10 (about 2.5 minutes). */
export const ORGANIZATIONS_RETRY_MAX_DELAY_MS = 20_000;
/** SDK-level attempts per call. Kept at 1 so retries are not multiplied with the SDK's own retry. */
export const ORGANIZATIONS_SDK_MAX_ATTEMPTS = 1;

export type OrganizationsRetryScope = 'idempotent' | 'non-idempotent';

export interface OrganizationsRetryOptions {
  readonly startDelayMs: number;
  readonly maxAttempts: number;
  readonly maxDelayMs: number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  /** Returns a value in [0, 1). Injected so tests can bound jitter deterministically. */
  readonly random: () => number;
  readonly log: (message: string) => void;
}

export const DEFAULT_ORGANIZATIONS_RETRY_OPTIONS: OrganizationsRetryOptions = {
  startDelayMs: ORGANIZATIONS_RETRY_START_DELAY_MS,
  maxAttempts: ORGANIZATIONS_RETRY_MAX_ATTEMPTS,
  maxDelayMs: ORGANIZATIONS_RETRY_MAX_DELAY_MS,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random: Math.random,
  log: () => undefined
};

/** Errors returned when AWS rejected the request before acting on it. Safe to retry for any operation. */
const REJECTED_REQUEST_ERRORS = new Set([
  'ConcurrentModificationException',
  'TooManyRequestsException',
  'ThrottlingException',
  'Throttling'
]);

/** Internal service errors. The request may or may not have been processed. */
const INTERNAL_SERVICE_ERRORS = new Set(['ServiceException', 'InternalErrorException', 'InternalException']);

/** Transient network failures reported by Node.js. The request may or may not have reached AWS. */
const TRANSIENT_NETWORK_ERRORS = new Set(['ECONNRESET', 'ENOTFOUND', 'EPIPE', 'ETIMEDOUT']);

/**
 * Permanent errors. Never retried, even when the SDK flags them retryable. This covers access,
 * input, and organization-state errors, and every `ConstraintViolationException` reason: account
 * quota and creation-rate limits do not clear within a retry window.
 */
const PERMANENT_ERRORS = new Set([
  'AccessDeniedException',
  'AccessDeniedForDependencyException',
  'AWSOrganizationsNotInUseException',
  'ConstraintViolationException',
  'InvalidInputException',
  'AccountNotFoundException',
  'ChildNotFoundException',
  'ParentNotFoundException',
  'SourceParentNotFoundException',
  'DestinationParentNotFoundException',
  'DuplicateAccountException',
  'TargetNotFoundException',
  'CreateAccountStatusNotFoundException',
  'UnsupportedAPIEndpointException'
]);

interface ErrorShape {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly Reason?: unknown;
  readonly $retryable?: unknown;
}

function shape(error: unknown): ErrorShape {
  return typeof error === 'object' && error !== null ? (error as ErrorShape) : {};
}

/** AWS error name (SDK v3 `name`), falling back to the Node.js network error `code`. */
export function organizationsErrorName(error: unknown): string {
  const { name, code } = shape(error);
  if (typeof code === 'string' && TRANSIENT_NETWORK_ERRORS.has(code)) {
    return code;
  }
  if (typeof name === 'string' && name.length > 0) {
    return name;
  }
  return typeof code === 'string' && code.length > 0 ? code : 'UnknownError';
}

export function isRetryableOrganizationsError(error: unknown, scope: OrganizationsRetryScope): boolean {
  const name = organizationsErrorName(error);
  if (PERMANENT_ERRORS.has(name)) {
    return false;
  }
  if (REJECTED_REQUEST_ERRORS.has(name)) {
    return true;
  }
  if (scope === 'non-idempotent') {
    return false;
  }
  return (
    INTERNAL_SERVICE_ERRORS.has(name) || TRANSIENT_NETWORK_ERRORS.has(name) || shape(error).$retryable !== undefined
  );
}

/** Full jitter: a uniform delay between 0 and the capped exponential bound for this attempt. */
export function organizationsRetryDelayMs(failedAttempt: number, options: OrganizationsRetryOptions): number {
  const exponential = options.startDelayMs * 2 ** (failedAttempt - 1);
  const bound = Math.min(options.maxDelayMs, exponential);
  return Math.floor(options.random() * bound);
}

function describeError(error: unknown): string {
  const { message, Reason } = shape(error);
  const name = organizationsErrorName(error);
  const reason = typeof Reason === 'string' ? ` (Reason: ${Reason})` : '';
  const text = typeof message === 'string' && message.length > 0 ? `: ${message}` : '';
  return `${name}${reason}${text}`;
}

/**
 * Runs one Organizations request with bounded retry. `request` must build a fresh SDK command on
 * every call. Throws an error naming the operation and the AWS error, with the original error
 * as `cause`.
 */
export async function withOrganizationsRetry<T>(
  operation: string,
  scope: OrganizationsRetryScope,
  request: () => Promise<T>,
  options: OrganizationsRetryOptions
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const retryable = isRetryableOrganizationsError(error, scope);
      if (!retryable) {
        throw new Error(`Organizations ${operation} failed: ${describeError(error)}`, { cause: error });
      }
      if (attempt >= options.maxAttempts) {
        throw new Error(`Organizations ${operation} failed after ${attempt} attempts: ${describeError(error)}`, {
          cause: error
        });
      }
      const delayMs = organizationsRetryDelayMs(attempt, options);
      options.log(
        `Organizations ${operation}: attempt ${attempt}/${options.maxAttempts} failed with ` +
          `${organizationsErrorName(error)}; retrying in ${delayMs} ms.`
      );
      await options.sleep(delayMs);
    }
  }
}
