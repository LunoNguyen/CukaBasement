import { legacySocialLinks, type SocialLink } from '@cuka/shared'
import type { Connection } from 'mongoose'
import type { StoredSocialLink, User } from './user.schema'

const HTTP = /^https?:\/\//i

/**
 * The profile's links as served. Profiles saved before the list keep their fixed fields (`socialLinks`) until the
 * setup migration or their next links save, so an empty list falls back to those; a links save always unsets them,
 * which keeps a list the user emptied empty.
 */
export function effectiveLinks(profile: Pick<User['profile'], 'links' | 'socialLinks'>): SocialLink[] {
  const stored = profile.links ?? []
  if (!stored.length) return legacySocialLinks(profile.socialLinks)
  return stored
    .filter((l) => HTTP.test(l.url))
    .map((l) => (l.platform === 'other' ? { platform: l.platform, label: l.label, url: l.url } : { platform: l.platform, url: l.url }))
}

/** The stored shape of validated input links. */
export function toStoredLinks(links: SocialLink[]): StoredSocialLink[] {
  return links.map((l) => ({ platform: l.platform, label: l.platform === 'other' ? (l.label ?? '') : '', url: l.url }))
}

/**
 * One-off, idempotent: moves every profile's legacy fixed links into `profile.links` and unsets them. A profile
 * that already has a list keeps it. The update is conditional on the legacy fields still being there, so a links
 * save racing the migration wins. Returns the number of profiles migrated.
 */
export async function migrateLegacyLinks(conn: Connection): Promise<number> {
  const users = conn.collection<Pick<User, '_id' | 'profile'>>('users')
  let migrated = 0
  for await (const u of users.find({ 'profile.socialLinks': { $exists: true } }, { projection: { 'profile.links': 1, 'profile.socialLinks': 1 } })) {
    const links = u.profile?.links?.length ? u.profile.links : toStoredLinks(legacySocialLinks(u.profile?.socialLinks))
    const res = await users.updateOne(
      { _id: u._id, 'profile.socialLinks': { $exists: true } },
      { $set: { 'profile.links': links }, $unset: { 'profile.socialLinks': '' } },
    )
    migrated += res.modifiedCount
  }
  return migrated
}
