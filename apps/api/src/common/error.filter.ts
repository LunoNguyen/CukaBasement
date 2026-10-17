import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
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
    if (e instanceof ThrottlerException) {
      return [429, envelope('RATE_LIMITED', 'Too many requests')]
    }
    if (e instanceof NotFoundException) {
      return [404, envelope('NOT_FOUND', e.message)]
    }
    if (e instanceof HttpException && e.getStatus() < 500) {
      const status = e.getStatus()
      return [status, envelope(codeForStatus(status), e.message)]
    }
    // Errors from Express middleware such as body-parser (413 entity too large) carry their own 4xx status.
    const clientStatus = clientErrorStatus(e)
    if (clientStatus !== null) {
      return [clientStatus, envelope(codeForStatus(clientStatus), e instanceof Error ? e.message : 'Bad request')]
    }
    this.logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    const message = this.config.nodeEnv === 'production' || !(e instanceof Error) ? 'Internal server error' : e.message
    return [500, envelope('INTERNAL', message)]
  }
}

function envelope(code: ErrorCode, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } }
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 429:
      return 'RATE_LIMITED'
    default:
      return 'VALIDATION_FAILED' // 400, 413, 422 and any other 4xx
  }
}

function clientErrorStatus(e: unknown): number | null {
  if (typeof e !== 'object' || e === null) return null
  const { status, statusCode } = e as { status?: unknown; statusCode?: unknown }
  const s = typeof status === 'number' ? status : statusCode
  return typeof s === 'number' && Number.isInteger(s) && s >= 400 && s < 500 ? s : null
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 11000
}
