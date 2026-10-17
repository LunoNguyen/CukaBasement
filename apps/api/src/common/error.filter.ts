import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type { ErrorCode } from '@cuka/shared'
import type { Response } from 'express'
import { ZodError } from 'zod'
import { CONFIG, type Config } from '../config/config'
import { AppError } from './app-error'

interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown }
}

@Catch()
export class GlobalErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalErrorFilter')

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()
    const [status, body] = this.map(exception)
    res.status(status).json(body)
  }

  private map(e: unknown): [number, ErrorBody] {
    if (e instanceof AppError) {
      return [e.status, envelope(e.code, e.message, e.details)]
    }
    if (e instanceof ZodError) {
      return [400, envelope('VALIDATION_FAILED', 'Validation failed', e.issues)]
    }
    if (isDuplicateKey(e)) {
      return [409, envelope('VALIDATION_FAILED', 'Duplicate value')]
    }
    if (e instanceof HttpException && e.constructor.name === 'ThrottlerException') {
      return [429, envelope('RATE_LIMITED', 'Too many requests')]
    }
    if (e instanceof NotFoundException) {
      return [404, envelope('NOT_FOUND', e.message)]
    }
    this.logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    const message = this.config.nodeEnv === 'production' || !(e instanceof Error) ? 'Internal server error' : e.message
    return [500, envelope('INTERNAL', message)]
  }
}

function envelope(code: ErrorCode, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } }
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 11000
}
