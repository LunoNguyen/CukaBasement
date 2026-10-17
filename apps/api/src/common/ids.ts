import { Types } from 'mongoose'
import { AppError } from './app-error'

export function toObjectId(s: string): Types.ObjectId {
  if (typeof s !== 'string' || !/^[0-9a-fA-F]{24}$/.test(s)) throw new AppError('NOT_FOUND', 404)
  return new Types.ObjectId(s)
}
