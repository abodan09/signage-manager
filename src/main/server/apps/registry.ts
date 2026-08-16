import type { AppDefinition } from './types'
import { canva } from './canva'
import { simpleclock } from './clock'
import { fbcounter, igcounter } from './counters'
import { facebook } from './facebook'
import { gcal } from './gcal'
import { gslides } from './gslides'
import { instagram } from './instagram'
import { powerbi } from './powerbi'
import { qrcode } from './qrcode'
import { split } from './split'
import { weather } from './weather'
import { youtube } from './youtube'

// Every app the manager can create instances of. Adding one is a single import
// plus an entry here — the config form, validation, storage, caching, playlist
// plumbing and player page are all generic and come for free.
export const APPS: AppDefinition[] = [
  instagram,
  youtube,
  weather,
  canva,
  facebook,
  powerbi,
  gslides,
  gcal,
  igcounter,
  fbcounter,
  qrcode,
  simpleclock,
  split,
]

const BY_ID = new Map(APPS.map(a => [a.id, a]))

export function getApp(id: string): AppDefinition | undefined {
  return BY_ID.get(id)
}
