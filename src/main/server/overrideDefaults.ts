import { randomUUID } from 'crypto'
import type { Override } from './types'

// The messages a site is most likely to need, written out so they exist before
// anyone needs them. That is the whole point of this feature: nobody composes
// an evacuation notice while the building is emptying.
//
// All six target every screen. Anything narrower would have to name a group or
// a device that does not exist on a fresh install, and a prepared message that
// silently reaches nothing is worse than none at all — the operator can retarget
// once their groups exist.
//
// Colours are deliberate, not decorative: emergency messages are the same deep
// red the product already uses for a live override, flash messages the neutral
// slate, so the two read apart at a glance from across a room.
const EMERGENCY_BG = '#b3261e'
const FLASH_BG     = '#1b2430'

interface Seed {
  kind: Override['kind']
  name: string
  text: string
  minutes: number
}

const SEEDS: Seed[] = [
  {
    kind: 'emergency',
    name: 'Fire drill',
    text: 'Fire drill in progress — please use the nearest stairwell.',
    minutes: 30,
  },
  {
    kind: 'emergency',
    name: 'Fire evacuation — full building',
    text: 'FIRE IN PROGRESS — leave by the nearest exit. Do not use the lift.',
    minutes: 30,
  },
  {
    kind: 'emergency',
    name: 'Lockdown — shelter in place',
    text: 'Stay where you are. Lock the door, move away from windows, wait for the all-clear.',
    minutes: 45,
  },
  {
    kind: 'flash',
    name: 'Visitor parking is full',
    text: 'Visitor parking is full — please use the overflow car park.',
    minutes: 10,
  },
  {
    kind: 'flash',
    name: 'Severe weather — early close',
    text: 'The building closes at 15:00 today. Please make your way home safely.',
    minutes: 10,
  },
  {
    kind: 'flash',
    name: 'Network maintenance tonight',
    text: 'Room booking screens go offline 19:00–21:00 for maintenance.',
    minutes: 10,
  },
]

/** Prepared messages seeded once, so the page is useful the day it is opened. */
export function defaultOverrides(): Override[] {
  const now = new Date().toISOString()
  return SEEDS.map(s => ({
    id: randomUUID(),
    kind: s.kind,
    name: s.name,
    targetKind: 'all' as const,
    targetIds: [],
    contentKind: 'text' as const,
    text: s.text,
    textColor: '#ffffff',
    backgroundColor: s.kind === 'emergency' ? EMERGENCY_BG : FLASH_BG,
    seconds: s.minutes * 60,
    createdAt: now,
    updatedAt: now,
  }))
}
