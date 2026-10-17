import { describe, expect, it } from 'vitest'
import { normalizeTag } from '../src'

describe('normalizeTag', () => {
  it('strips #, lowercases', () => expect(normalizeTag('#DuCaArt')).toBe('ducaart'))
  it('collapses whitespace to underscore', () =>
    expect(normalizeTag('  Hibiki  Du Ca ')).toBe('hibiki_du_ca'))
  it('returns null for empty', () => expect(normalizeTag('#')).toBeNull())
  it('returns null for too long', () => expect(normalizeTag('a'.repeat(31))).toBeNull())
  it('accepts max length', () => expect(normalizeTag('a'.repeat(30))).toBe('a'.repeat(30)))
  it('NFC-normalizes', () => expect(normalizeTag('é')).toBe('é'))
})
