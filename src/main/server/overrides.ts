import type { JsonDB } from './database'
import type { Override, OverrideKind, ResolvedOverride } from './types'

// Emergency and Flash messages: taking a screen off its playlist.
//
// Every other feature in this product adds something a playlist can play. This
// one interrupts — an operator picks a message, chooses who sees it, and it
// goes up now.
//
// Three rules shape all of it, and each exists because of how it fails:
//
//   1. An activation is state on the server, not a message to a screen. The
//      socket push is only how a screen finds out quickly; a screen that was
//      rebooting, or off the network for thirty seconds, learns about it the
//      moment it next asks what to play. An override that lived only in a
//      push would leave a screen showing the lunch menu during a fire.
//
//   2. The screen counts down on its own. Every payload carries the seconds
//      remaining, never only an end time, because a TV's clock is frequently
//      wrong and because the manager may be asleep when the message is due to
//      come off. A message that outlives its emergency is its own emergency.
//
//   3. One override per screen. Two people activating at once is a real
//      scenario in an actual incident, and a screen has one face — so the most
//      recently activated wins, and the UI says which is showing.

/** How long an activation may run before it stands itself down regardless.
 *  Nothing here is meant to be permanent; a message someone forgot to cancel
 *  is the most likely way this feature goes wrong. */
export const MAX_SECONDS = 12 * 60 * 60

export function overrideDefaults(kind: OverrideKind) {
  return kind === 'emergency'
    ? { seconds: 1800, requireConfirm: true }
    : { seconds: 600, requireConfirm: false }
}

/** The devices an override applies to, resolved now. Kept out of the stored
 *  record so that adding a screen to a group during an incident reaches it. */
export function targetDevices(db: JsonDB, o: Override): string[] {
  const all = db.getAllDevices()
  if (o.targetKind === 'all') return all.map(d => d.id)
  if (o.targetKind === 'devices') {
    const wanted = new Set(o.targetIds)
    return all.filter(d => wanted.has(d.id)).map(d => d.id)
  }
  const wanted = new Set(o.targetIds)
  return all.filter(d => (d.groupIds ?? []).some(g => wanted.has(g))).map(d => d.id)
}

export function isRunning(o: Override, now = Date.now()): boolean {
  if (!o.startedAt || !o.endsAt) return false
  return Date.parse(o.startedAt) <= now && Date.parse(o.endsAt) > now
}

/** The override a given screen should be showing, or null.
 *
 *  Most recently started wins. Ties are impossible in practice and harmless in
 *  principle — what matters is that the choice is made in one place, so the
 *  socket push and the playlist fetch can never disagree about which message a
 *  screen is on. */
export function activeFor(db: JsonDB, deviceId: string | undefined, now = Date.now()): Override | null {
  if (!deviceId) return null
  let best: Override | null = null
  for (const o of db.getAllOverrides()) {
    if (!isRunning(o, now)) continue
    if (!targetDevices(db, o).includes(deviceId)) continue
    if (!best || Date.parse(o.startedAt!) > Date.parse(best.startedAt!)) best = o
  }
  return best
}

/** What a screen is handed. The seconds are what it actually counts down;
 *  `endsAt` travels only so a human reading a log can tell when it was due. */
export function resolveOverride(o: Override, now = Date.now()): ResolvedOverride {
  const endsMs = o.endsAt ? Date.parse(o.endsAt) : now
  return {
    id: o.id,
    kind: o.kind,
    name: o.name,
    contentKind: o.contentKind,
    designId: o.designId,
    appInstanceId: o.appInstanceId,
    imagePath: o.imagePath,
    text: o.text,
    textColor: o.textColor,
    backgroundColor: o.backgroundColor,
    endsAt: o.endsAt ?? '',
    secondsRemaining: Math.max(0, Math.round((endsMs - now) / 1000)),
  }
}

/** Where a screen should point to draw this message. Relative, so it resolves
 *  against whatever address the screen reached the manager on rather than the
 *  one this PC believes it has. */
export function overrideUrl(o: ResolvedOverride): string {
  if (o.contentKind === 'design' && o.designId) {
    return `/tv/scene/${encodeURIComponent(o.designId)}`
  }
  if (o.contentKind === 'app' && o.appInstanceId) {
    return `/tv/app/${encodeURIComponent(o.appInstanceId)}`
  }
  return ''
}

/** The operator-facing reason an override cannot be saved, or null. */
export function overrideProblem(o: Partial<Override>): string | null {
  const name = String(o.name ?? '').trim()
  if (!name) return 'Give this message a name so you can find it in a hurry.'
  if (name.length > 80) return 'That name is too long.'

  if (o.targetKind !== 'all' && !(o.targetIds ?? []).length) {
    return o.targetKind === 'groups'
      ? 'Choose at least one group of screens.'
      : 'Choose at least one screen.'
  }

  switch (o.contentKind) {
    case 'design':
      if (!o.designId) return 'Choose the design to show.'
      break
    case 'app':
      if (!o.appInstanceId) return 'Choose the app to show.'
      break
    case 'image':
      if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(String(o.imagePath ?? ''))) {
        return 'Choose a picture uploaded to this manager.'
      }
      break
    case 'text':
      if (!String(o.text ?? '').trim()) return 'Type the message to show.'
      if (String(o.text ?? '').length > 600) return 'That message is too long to read on a wall.'
      break
    default:
      return 'Choose what this message shows.'
  }

  const seconds = Number(o.seconds)
  if (!Number.isFinite(seconds) || seconds < 10) return 'Set how long it should stay up — at least 10 seconds.'
  if (seconds > MAX_SECONDS) return 'That is longer than half a day. Choose a shorter time.'
  return null
}
