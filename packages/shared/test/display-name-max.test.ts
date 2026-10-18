import { describe, expect, it } from 'vitest'
import { LIMITS, registerSchema, updateProfileSchema } from '../src'

describe('displayNameMax', () => {
  it('is 50 and drives both schemas', () => {
    expect(LIMITS.displayNameMax).toBe(50)
    expect(updateProfileSchema.safeParse({ displayName: 'a'.repeat(50) }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ displayName: 'a'.repeat(51) }).success).toBe(false)
    expect(registerSchema.shape.displayName.safeParse('a'.repeat(51)).success).toBe(false)
  })
})
