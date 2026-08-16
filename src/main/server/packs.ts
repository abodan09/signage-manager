import fs from 'fs'
import path from 'path'
import type { JsonDB } from './database'
import type { PackRegistryEntry, PackTemplate, TemplatePack } from './types'
import { sanitizeDesign } from './scenes'

// Template packs are per-industry catalogs downloaded on demand, so a fresh
// install ships nothing it will not use. Sources, in order:
//   1. the remote registry (GitHub Pages next to the download site),
//   2. the on-disk cache in <userData>/template-packs (uninstall keeps it, so
//      re-installing a category is instant and offline),
//   3. the packs bundled in <assets>/packs — the same files, frozen at build
//      time, so a manager that has never been online still gets templates.
// Every template body is run through sanitizeDesign() before it is accepted
// from ANY source; a pack is data, and data never gets to skip the whitelist.

const REGISTRY_URL = process.env.SIGNAGE_PACKS_URL || 'https://signage.frozenbit.eu/packs/registry.json'
const FETCH_TIMEOUT_MS = 15_000
const REGISTRY_TTL_MS = 6 * 60 * 60_000   // re-fetch at most every 6h unless forced

export type RegistrySource = 'remote' | 'cache' | 'bundled' | 'none'

export interface CatalogEntry extends PackRegistryEntry {
  installed: boolean
  installedVersion?: string
  updateAvailable: boolean
  /** True when the pack body is already on disk (cache or bundled), so
   *  installing needs no network. */
  availableOffline: boolean
}

interface Registry {
  formatVersion: number
  packs: PackRegistryEntry[]
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SignageManager-Packs/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function validRegistry(raw: unknown): Registry | null {
  const r = raw as Registry
  if (!r || r.formatVersion !== 1 || !Array.isArray(r.packs)) return null
  const packs = r.packs.filter(p =>
    p && typeof p.category === 'string' && /^[a-z0-9-]{1,40}$/.test(p.category) &&
    typeof p.name === 'string' && typeof p.version === 'string' &&
    typeof p.file === 'string' && /^[a-z0-9-]+\.json$/.test(p.file),
  ).map(p => ({
    category: p.category,
    name: String(p.name).slice(0, 60),
    description: String(p.description ?? '').slice(0, 200),
    icon: String(p.icon ?? '🗂️').slice(0, 8),
    version: String(p.version).slice(0, 20),
    templateCount: Number(p.templateCount) || 0,
    file: p.file,
  }))
  return { formatVersion: 1, packs }
}

/** Validates a whole pack body: envelope plus every template design. */
export function validatePack(raw: unknown, expectCategory?: string):
  { ok: true; pack: TemplatePack } | { ok: false; error: string } {
  const p = raw as TemplatePack
  if (!p || p.formatVersion !== 1) return { ok: false, error: 'Unsupported pack format' }
  if (typeof p.category !== 'string' || !/^[a-z0-9-]{1,40}$/.test(p.category)) {
    return { ok: false, error: 'Pack has a bad category id' }
  }
  if (expectCategory && p.category !== expectCategory) {
    return { ok: false, error: `Pack is for "${p.category}", expected "${expectCategory}"` }
  }
  if (!Array.isArray(p.templates) || p.templates.length === 0) {
    return { ok: false, error: 'Pack contains no templates' }
  }
  const templates: PackTemplate[] = []
  const seen = new Set<string>()
  for (let i = 0; i < p.templates.length; i++) {
    const t = p.templates[i]
    if (!t || typeof t.key !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(t.key)) {
      return { ok: false, error: `Template ${i + 1}: bad key` }
    }
    if (seen.has(t.key)) return { ok: false, error: `Template ${i + 1}: duplicate key "${t.key}"` }
    seen.add(t.key)
    const clean = sanitizeDesign({ ...t.design, category: p.category, templateKey: t.key })
    if (!clean.ok) return { ok: false, error: `Template "${t.key}": ${clean.error}` }
    templates.push({
      key: t.key,
      name: String(t.name ?? clean.design.name).slice(0, 80),
      description: t.description ? String(t.description).slice(0, 200) : undefined,
      tags: Array.isArray(t.tags) ? t.tags.slice(0, 10).map(x => String(x).slice(0, 30)) : undefined,
      design: clean.design,
    })
  }
  return {
    ok: true,
    pack: {
      formatVersion: 1,
      category: p.category,
      name: String(p.name ?? p.category).slice(0, 60),
      description: String(p.description ?? '').slice(0, 200),
      icon: String(p.icon ?? '🗂️').slice(0, 8),
      version: String(p.version ?? '1.0.0').slice(0, 20),
      templates,
    },
  }
}

export class PackStore {
  private packsDir: string
  private bundledDir: string
  private db: JsonDB
  private registry: Registry | null = null
  private registrySource: RegistrySource = 'none'
  private registryFetchedAt = 0

  constructor(dataDir: string, assetsDir: string, db: JsonDB) {
    this.packsDir = path.join(dataDir, 'template-packs')
    this.bundledDir = path.join(assetsDir, 'packs')
    this.db = db
    fs.mkdirSync(this.packsDir, { recursive: true })
  }

  private cachePath(category: string) { return path.join(this.packsDir, `${category}.json`) }
  private registryCachePath() { return path.join(this.packsDir, 'registry.json') }

  private readJsonFile(file: string): unknown {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
  }

  private loadLocalRegistry(): void {
    if (this.registry) return
    const cached = validRegistry(this.readJsonFile(this.registryCachePath()))
    if (cached) { this.registry = cached; this.registrySource = 'cache'; return }
    const bundled = validRegistry(this.readJsonFile(path.join(this.bundledDir, 'registry.json')))
    if (bundled) { this.registry = bundled; this.registrySource = 'bundled' }
  }

  /** Fetches the remote registry (respecting the TTL unless forced), falling
   *  back to cache, then to the bundled copy. Never throws. */
  async refreshRegistry(force = false): Promise<RegistrySource> {
    const fresh = this.registrySource === 'remote' && Date.now() - this.registryFetchedAt < REGISTRY_TTL_MS
    if (fresh && !force) return this.registrySource
    try {
      const remote = validRegistry(await fetchJson(REGISTRY_URL))
      if (remote) {
        this.registry = remote
        this.registrySource = 'remote'
        this.registryFetchedAt = Date.now()
        try { fs.writeFileSync(this.registryCachePath(), JSON.stringify(remote, null, 2), 'utf-8') }
        catch { /* disk hiccup — the in-memory copy still serves this run */ }
        return this.registrySource
      }
    } catch { /* offline or the site is down — local copies below */ }
    this.loadLocalRegistry()
    return this.registrySource
  }

  async getCatalog(forceRefresh = false): Promise<{ categories: CatalogEntry[]; source: RegistrySource }> {
    await this.refreshRegistry(forceRefresh)
    const installed = new Map(this.db.getInstalledPacks().map(p => [p.category, p]))
    const entries = (this.registry?.packs ?? []).map(p => {
      const inst = installed.get(p.category)
      return {
        ...p,
        installed: !!inst,
        installedVersion: inst?.version,
        updateAvailable: !!inst && inst.version !== p.version,
        availableOffline: fs.existsSync(this.cachePath(p.category)) || fs.existsSync(path.join(this.bundledDir, p.file)),
      }
    })
    return { categories: entries, source: this.registrySource }
  }

  /** Reads a pack body from cache or the bundled copy, newest version wins. */
  private readLocalPack(category: string): TemplatePack | null {
    const fromCache = validatePack(this.readJsonFile(this.cachePath(category)), category)
    const cachePack = fromCache.ok ? fromCache.pack : null
    const entry = this.registry?.packs.find(p => p.category === category)
    const bundledFile = entry ? path.join(this.bundledDir, entry.file) : path.join(this.bundledDir, `${category}.json`)
    const fromBundle = validatePack(this.readJsonFile(bundledFile), category)
    const bundlePack = fromBundle.ok ? fromBundle.pack : null
    if (cachePack && bundlePack) return cachePack.version >= bundlePack.version ? cachePack : bundlePack
    return cachePack ?? bundlePack
  }

  /** Downloads (if needed) and installs a category. Remote first, then cache,
   *  then bundled — so "install" always succeeds when the pack exists anywhere. */
  async install(category: string): Promise<{ ok: true; pack: TemplatePack } | { ok: false; error: string }> {
    await this.refreshRegistry()
    const entry = this.registry?.packs.find(p => p.category === category)

    let pack: TemplatePack | null = null
    const local = this.readLocalPack(category)
    const localIsCurrent = !!local && (!entry || local.version === entry.version)

    if (localIsCurrent) {
      pack = local
    } else if (entry) {
      try {
        const url = new URL(entry.file, REGISTRY_URL).toString()
        const checked = validatePack(await fetchJson(url), category)
        if (checked.ok) pack = checked.pack
      } catch { /* offline — the local copy below still installs */ }
      if (!pack) pack = local
    } else {
      pack = local
    }

    if (!pack) return { ok: false, error: 'This template category is not available yet. Check your internet connection and try again.' }

    try { fs.writeFileSync(this.cachePath(category), JSON.stringify(pack, null, 2), 'utf-8') }
    catch { /* cache write failed — install still proceeds from memory */ }

    this.db.setPackInstalled({
      category,
      version: pack.version,
      templateCount: pack.templates.length,
      installedAt: new Date().toISOString(),
    })
    return { ok: true, pack }
  }

  /** Uninstall removes the category from the installed set but keeps the cached
   *  file, so swapping categories back later is instant and offline. */
  uninstall(category: string): boolean {
    return this.db.removePack(category)
  }

  /** Templates of one installed category (or every installed category). */
  getInstalledTemplates(category?: string): Array<PackTemplate & { category: string }> {
    const cats = category ? [category] : this.db.getInstalledPacks().map(p => p.category)
    const out: Array<PackTemplate & { category: string }> = []
    for (const cat of cats) {
      if (!this.db.getInstalledPack(cat)) continue
      const pack = this.readLocalPack(cat)
      if (!pack) continue
      for (const t of pack.templates) out.push({ ...t, category: cat })
    }
    return out
  }

  getTemplate(category: string, key: string): (PackTemplate & { category: string }) | null {
    const pack = this.readLocalPack(category)
    const t = pack?.templates.find(x => x.key === key)
    return t ? { ...t, category } : null
  }
}
