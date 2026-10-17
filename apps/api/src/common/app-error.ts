import type { ErrorCode } from '@cuka/shared'

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public status: number,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code)
    this.name = 'AppError'
  }
}
