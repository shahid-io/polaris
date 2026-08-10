import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a request body against a Zod schema from `@polaris/contracts`.
 *
 * ### Why not class-validator DTOs
 * NestJS conventionally validates with decorated DTO classes. That would mean maintaining
 * a second description of every request shape alongside the Zod schema the frontend
 * already uses — and two descriptions of one contract drift apart. Validating directly
 * against the shared schema means the API and the client cannot disagree about what a
 * valid request is, because there is only one definition.
 *
 * ### Why not the nestjs-zod library
 * It was the first choice, but its `createZodDto` expects a `ZodObject`, and several of
 * our schemas end in `.refine(...)` — origin must differ from destination, and a time
 * range's start must precede its end. Those produce a wrapped effect type rather than a
 * plain object, which the library does not accept. A twenty-line pipe handles every Zod
 * type and adds no dependency.
 *
 * @typeParam T - The validated output type.
 *
 * @example
 * ```ts
 * @Post()
 * search(@Body(new ZodValidationPipe(searchRequestSchema)) body: SearchRequest) { … }
 * ```
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  /**
   * @param schema - Schema the incoming value must satisfy.
   */
  constructor(private readonly schema: ZodType<T>) {}

  /**
   * Parses and validates the value.
   *
   * @param value - Raw incoming value.
   * @returns The parsed value, with schema defaults applied.
   * @throws {BadRequestException} Carrying field-level detail, so a client can highlight
   *   the offending input rather than showing one generic message.
   */
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The search request is not valid',
          details: result.error.issues.map((issue) => ({
            path: issue.path.join('.') || '(root)',
            message: issue.message,
          })),
        },
      });
    }

    return result.data;
  }
}
