import spriteManifest from './data/sprites.json'
import type { CatalogEntry } from './types'

interface SpriteManifest {
  version: string
  generatedAt: string
  map: Record<string, string>
}

const manifest = spriteManifest as SpriteManifest

export const spriteUrlFor = (entry: CatalogEntry) => manifest.map[entry.id] ?? null

export const spriteManifestVersion = manifest.version
