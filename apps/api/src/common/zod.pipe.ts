import type { PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

/** Parses the value with the schema; a ZodError is turned into 400 VALIDATION_FAILED by GlobalErrorFilter. */
export class ZodPipe<T extends ZodType> implements PipeTransform<unknown, ReturnType<T['parse']>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): ReturnType<T['parse']> {
    return this.schema.parse(value) as ReturnType<T['parse']>
  }
}
