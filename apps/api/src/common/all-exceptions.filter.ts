import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ApiError, ApiErrorCode } from '@polaris/contracts';

/**
 * Gives every error one shape.
 *
 * Without this, Nest returns its own envelope for `HttpException`, a bare 500 for anything
 * else, and the pipe returns a third shape, so a client would need three parsers for what
 * is conceptually one thing. Every failure now arrives as `{ error: { code, message } }`
 * with a machine-readable code, so the UI can branch on `code` rather than matching
 * message strings that change whenever wording is edited.
 *
 * Unexpected errors are logged in full and reported with a generic message plus a
 * `searchId`. Internal messages routinely carry connection strings, file paths and query
 * fragments; returning them to a client is a disclosure risk, while the correlation id
 * still ties the response to the full server-side log entry.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * Converts any thrown value into the standard error response.
   *
   * @param exception - The thrown value, of any type.
   * @param host - Nest execution context, supplying the HTTP response.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // The validation pipe already throws the canonical shape; pass it straight through
      // rather than re-wrapping and losing the field-level detail.
      if (isApiError(body)) {
        response.status(status).json(body);
        return;
      }

      response.status(status).json({
        error: {
          code: codeForStatus(status),
          message: typeof body === 'string' ? body : exception.message,
        },
      } satisfies ApiError);
      return;
    }

    const searchId = randomUUID();
    this.logger.error(
      `Unhandled exception [${searchId}]`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Quote the reference when reporting this.',
        searchId,
      },
    } satisfies ApiError);
  }
}

/**
 * Detects a body that already matches the canonical error shape.
 *
 * @param body - Response body from an HttpException.
 * @returns Whether it is already an {@link ApiError}.
 * @internal
 */
function isApiError(body: unknown): body is ApiError {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ApiError).error?.code === 'string'
  );
}

/**
 * Maps an HTTP status onto a machine-readable code.
 *
 * @param status - HTTP status code.
 * @returns The corresponding error code.
 * @internal
 */
function codeForStatus(status: number): ApiErrorCode {
  if (status === HttpStatus.BAD_REQUEST) return 'VALIDATION_ERROR';
  if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMITED';
  if (status >= 500) return 'UPSTREAM_FAILURE';
  return 'INTERNAL_ERROR';
}
