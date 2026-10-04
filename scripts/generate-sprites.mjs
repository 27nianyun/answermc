/**
 * 使用 Mojang 官方客户端资源（26.1 client.jar）渲染每个条目的图标：
 * - 方块：解析 blockstates → block model，用等距投影把模型 elements 光栅化成体素小图
 * - 物品：解析 items/<name>.json → model，3D 模型走等距渲染，平面图标走 layer 合成
 * - 生物：优先使用官方刷怪蛋图标，其次使用实体贴图
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const assetRoot = join(root, '.cache/jar/assets/minecraft')
const catalogPath = join(root, 'src/data/catalog.json')
const outDir = join(root, 'public/sprites')
const manifestPath = join(root, 'src/data/sprites.json')

const SIZE = 64
const N = 60
const CX = SIZE / 2
const CY = SIZE / 2

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const version = catalog.meta.version

const jsonCache = new Map()
const readJson = (file) => {
  if (jsonCache.has(file)) return jsonCache.get(file)
  let value = null
  if (existsSync(file)) {
    try {
      value = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      value = null
    }
  }
  jsonCache.set(file, value)
  return value
}

const pngCache = new Map()
const loadTexture = (relPath) => {
  if (!relPath) return null
  if (pngCache.has(relPath)) return pngCache.get(relPath)
  const file = join(assetRoot, 'textures', `${relPath}.png`)
  let png = null
  if (existsSync(file)) {
    try {
      png = PNG.sync.read(readFileSync(file))
      const meta = readJson(`${file}.mcmeta`)
      if (meta?.animation && png.height > png.width && png.height % png.width === 0) {
        const frame = new PNG({ width: png.width, height: png.width })
        frame.data.set(png.data.subarray(0, png.width * png.width * 4))
        png = frame
      }
    } catch {
      png = null
    }
  }
  pngCache.set(relPath, png)
  return png
}

const normalizeModelPath = (value) => {
  if (!value) return null
  const withoutNamespace = value.includes(':') ? value.split(':')[1] : value
  return withoutNamespace.startsWith('block/') || withoutNamespace.startsWith('item/')
    ? withoutNamespace
    : `block/${withoutNamespace}`
}

const resolveTextureRef = (rawValue, map, depth = 0) => {
  let value = rawValue
  if (value && typeof value === 'object') value = value.sprite ?? value.texture ?? null
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('#')) {
    const next = map[value.slice(1)]
    return next && depth < 8 ? resolveTextureRef(next, map, depth + 1) : null
  }
  const withoutNamespace = value.includes(':') ? value.split(':')[1] : value
  const withFolder = withoutNamespace.includes('/') ? withoutNamespace : `block/${withoutNamespace}`
  return existsSync(join(assetRoot, 'textures', `${withFolder}.png`)) ? withFolder : null
}

const resolveModel = (modelPath) => {
  const chain = []
  let current = modelPath
  for (let depth = 0; depth < 12 && current; depth += 1) {
    const json = readJson(join(assetRoot, 'models', `${current}.json`))
    if (!json) break
    chain.push(json)
    current = json.parent ? normalizeModelPath(json.parent) : null
  }
  if (!chain.length) return null

  const textures = {}
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    Object.assign(textures, chain[index].textures ?? {})
  }
  const resolved = {}
  for (const [key, value] of Object.entries(textures)) {
    resolved[key] = resolveTextureRef(value, textures)
  }

  let elements = null
  for (const level of chain) {
    if (level.elements) {
      elements = level.elements
      break
    }
  }

  return { textures: resolved, elements, shadeRoot: chain[0].shade !== false }
}

const FACE_CORNERS = {
  up: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
  down: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]],
  north: [[1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]],
  south: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]],
  east: [[1, 1, 1], [1, 1, 0], [1, 0, 0], [1, 0, 1]],
  west: [[0, 1, 0], [0, 1, 1], [0, 0, 1], [0, 0, 0]],
}

const FACE_SHADE = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 }
const FACE_NORMAL = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
}

const TINT_COLORS = [
  [/water|bubble|portal|enchant/, [63, 118, 228]],
  [/redstone/, [193, 24, 24]],
  [/leaves|spruce|birch|jungle|acacia|dark_oak|azalea|cherry|mangrove|pale_oak/, [119, 171, 47]],
  [/grass|fern|vine|moss|seagrass|kelp|melon|pumpkin|wheat|beetroot|carrot|potato|sapling|bamboo|sugar_cane|cactus|lily|dripleaf|berry|cocoa|warped|crimson|nether_sprouts|twisting|weeping/, [124, 175, 74]],
]

const tintFor = (texturePath) => {
  if (!texturePath) return null
  for (const [pattern, color] of TINT_COLORS) {
    if (pattern.test(texturePath)) return color
  }
  return null
}

const isGrayish = (png) => {
  let max = 0
  let total = 0
  const step = Math.max(1, Math.floor(png.width * png.height / 64))
  for (let index = 0; index < png.width * png.height; index += step) {
    const offset = index * 4
    const r = png.data[offset]
    const g = png.data[offset + 1]
    const b = png.data[offset + 2]
    if (png.data[offset + 3] < 8) continue
    max = Math.max(max, Math.max(r, g, b) - Math.min(r, g, b))
    total += 1
  }
  return total > 0 && max < 34
}

const lerpPoint = (from, to, bits) => [
  from[0] + (to[0] - from[0]) * bits[0],
  from[1] + (to[1] - from[1]) * bits[1],
  from[2] + (to[2] - from[2]) * bits[2],
]

const rotatePoint = (point, origin, axis, angleDeg, rescale) => {
  if (!angleDeg) return point
  const radians = (angleDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point[0] - origin[0]
  const dy = point[1] - origin[1]
  const dz = point[2] - origin[2]
  let rx = dx
  let ry = dy
  let rz = dz
  if (axis === 'x') {
    ry = dy * cos - dz * sin
    rz = dy * sin + dz * cos
  } else if (axis === 'y') {
    rx = dx * cos + dz * sin
    rz = -dx * sin + dz * cos
  } else {
    rx = dx * cos - dy * sin
    ry = dx * sin + dy * cos
  }
  const scale = rescale ? 1 / Math.max(0.2, Math.cos(radians)) : 1
  return [rx * scale + origin[0], ry * scale + origin[1], rz * scale + origin[2]]
}

const project = (point) => {
  const x = point[0] / 16
  const y = point[1] / 16
  const z = point[2] / 16
  return [CX + (x - z) * (N / 2), CY + (x + z) * (N / 4) - y * (N / 2)]
}

const defaultUv = (direction, from, to) => {
  if (direction === 'up' || direction === 'down') return [from[0], from[2], to[0], to[2]]
  if (direction === 'north' || direction === 'south') return [from[0], 16 - to[1], to[0], 16 - from[1]]
  return [from[2], 16 - to[1], to[2], 16 - from[1]]
}

const blankCanvas = () => new PNG({ width: SIZE, height: SIZE })

const blend = (canvas, x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a === 0) return
  const offset = (y * SIZE + x) * 4
  const data = canvas.data
  if (a >= 255) {
    data[offset] = r
    data[offset + 1] = g
    data[offset + 2] = b
    data[offset + 3] = 255
    return
  }
  const alpha = a / 255
  const inverse = 1 - alpha
  data[offset] = Math.round(r * alpha + data[offset] * inverse)
  data[offset + 1] = Math.round(g * alpha + data[offset + 1] * inverse)
  data[offset + 2] = Math.round(b * alpha + data[offset + 2] * inverse)
  data[offset + 3] = Math.max(data[offset + 3], a)
}

const drawQuad = (canvas, p0, p1, p3, texture, uv, rotation, brightness, tint) => {
  const ax = p1[0] - p0[0]
  const ay = p1[1] - p0[1]
  const bx = p3[0] - p0[0]
  const by = p3[1] - p0[1]
  const det = ax * by - bx * ay
  if (Math.abs(det) < 1e-6) return

  const corners = [p0, p1, [p1[0] + bx, p1[1] + by], [p0[0] + bx, p0[1] + by]]
  const minX = Math.max(0, Math.floor(Math.min(...corners.map((point) => point[0]))))
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(...corners.map((point) => point[0]))))
  const minY = Math.max(0, Math.floor(Math.min(...corners.map((point) => point[1]))))
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(...corners.map((point) => point[1]))))
  if (minX > maxX || minY > maxY) return

  const [u0, v0, u1, v1] = uv
  const tw = texture.width
  const th = texture.height
  const data = texture.data

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - p0[0]
      const dy = y + 0.5 - p0[1]
      let u = (dx * by - bx * dy) / det
      let v = (ax * dy - dx * ay) / det
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      if (rotation === 90) [u, v] = [1 - v, u]
      else if (rotation === 180) [u, v] = [1 - u, 1 - v]
      else if (rotation === 270) [u, v] = [v, 1 - u]

      const texU = u0 + (u1 - u0) * u
      const texV = v0 + (v1 - v0) * v
      let px = Math.floor((texU / 16) * tw)
      let py = Math.floor((texV / 16) * th)
      px = Math.min(tw - 1, Math.max(0, px))
      py = Math.min(th - 1, Math.max(0, py))
      const offset = (py * tw + px) * 4
      const alpha = data[offset + 3]
      if (alpha < 8) continue
      let r = data[offset] * brightness
      let g = data[offset + 1] * brightness
      let b = data[offset + 2] * brightness
      if (tint) {
        r = (r * tint[0]) / 255
        g = (g * tint[1]) / 255
        b = (b * tint[2]) / 255
      }
      blend(canvas, x, y, Math.min(255, Math.round(r)), Math.min(255, Math.round(g)), Math.min(255, Math.round(b)), alpha)
    }
  }
}

const renderElements = (model) => {
  const canvas = blankCanvas()
  const faces = []

  for (const element of model.elements) {
    const from = element.from ?? [0, 0, 0]
    const to = element.to ?? [16, 16, 16]
    const rotation = element.rotation ?? null
    const shade = element.shade !== false

    for (const [direction, face] of Object.entries(element.faces ?? {})) {
      const corners = FACE_CORNERS[direction]
      if (!corners) continue
      const transform = (bits) => {
        const point = lerpPoint(from, to, bits)
        return rotation
          ? rotatePoint(point, rotation.origin ?? [8, 8, 8], rotation.axis ?? 'y', rotation.angle ?? 0, rotation.rescale === true)
          : point
      }
      const quad = corners.map(transform)
      const normal = rotation
        ? rotatePoint(
          [FACE_NORMAL[direction][0] * 8 + (rotation.origin?.[0] ?? 8), FACE_NORMAL[direction][1] * 8 + (rotation.origin?.[1] ?? 8), FACE_NORMAL[direction][2] * 8 + (rotation.origin?.[2] ?? 8)],
          rotation.origin ?? [8, 8, 8],
          rotation.axis ?? 'y',
          rotation.angle ?? 0,
          false,
        ).map((value, index) => value - (rotation.origin?.[index] ?? 8))
        : FACE_NORMAL[direction]

      const facing = normal[0] + normal[1] + normal[2]
      if (facing <= 0.0001) continue

      const texturePath = model.textures[String(face.texture ?? '').replace('#', '')] ?? null
      const texture = loadTexture(texturePath)
      if (!texture) continue

      const uv = face.uv ?? defaultUv(direction, from, to)
      const brightness = shade && face.shade !== false ? FACE_SHADE[direction] ?? 1 : 1
      let tint = null
      if (typeof face.tintindex === 'number' && face.tintindex >= 0) {
        const color = tintFor(texturePath)
        if (color && isGrayish(texture)) tint = color
      }

      const centroid = quad.reduce(
        (accumulator, point) => [accumulator[0] + point[0], accumulator[1] + point[1], accumulator[2] + point[2]],
        [0, 0, 0],
      ).map((value) => value / 4)
      const depth = centroid[0] + centroid[1] + centroid[2]

      faces.push({
        depth,
        p0: project(quad[0]),
        p1: project(quad[1]),
        p3: project(quad[3]),
        texture,
        uv,
        rotation: face.rotation ?? 0,
        brightness,
        tint,
      })
    }
  }

  if (!faces.length) return null
  faces.sort((a, b) => a.depth - b.depth)
  for (const face of faces) {
    drawQuad(canvas, face.p0, face.p1, face.p3, face.texture, face.uv, face.rotation, face.brightness, face.tint)
  }
  return canvas
}

const drawLayer = (canvas, png) => {
  if (!png) return
  const scale = Math.max(1, Math.round(SIZE / Math.max(png.width, png.height)))
  const width = png.width * scale
  const height = png.height * scale
  const offsetX = Math.round((SIZE - width) / 2)
  const offsetY = Math.round((SIZE - height) / 2)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.floor(x / scale)
      const sourceY = Math.floor(y / scale)
      const offset = (sourceY * png.width + sourceX) * 4
      const alpha = png.data[offset + 3]
      if (alpha < 8) continue
      blend(
        canvas,
        offsetX + x,
        offsetY + y,
        png.data[offset],
        png.data[offset + 1],
        png.data[offset + 2],
        alpha,
      )
    }
  }
}

const renderFlat = (model) => {
  const canvas = blankCanvas()
  const keys = ['layer0', 'layer1', 'layer2', 'layer3', 'layer4', 'texture', 'particle', 'all']
    .filter((key) => model.textures[key])
  for (const key of keys) {
    const png = loadTexture(model.textures[key])
    if (!png) continue
    const tint = tintFor(model.textures[key])
    if (tint && isGrayish(png)) {
      const tinted = new PNG({ width: png.width, height: png.height })
      for (let index = 0; index < png.data.length; index += 4) {
        tinted.data[index] = Math.round((png.data[index] * tint[0]) / 255)
        tinted.data[index + 1] = Math.round((png.data[index + 1] * tint[1]) / 255)
        tinted.data[index + 2] = Math.round((png.data[index + 2] * tint[2]) / 255)
        tinted.data[index + 3] = png.data[index + 3]
      }
      drawLayer(canvas, tinted)
      continue
    }
    drawLayer(canvas, png)
  }
  return canvas.data.some((value, index) => index % 4 === 3 && value > 0) ? canvas : null
}

const renderModel = (modelPath) => {
  const model = resolveModel(modelPath)
  if (!model) return null
  if (model.elements?.length) {
    const rendered = renderElements(model)
    if (rendered) return rendered
  }
  return renderFlat(model)
}

const pickVariantModel = (blockstate) => {
  if (blockstate?.variants) {
    const keys = Object.keys(blockstate.variants)
    if (!keys.length) return null
    const normal = keys.find((key) => key === '')
      ?? keys.filter((key) => key.includes('false')).sort((a, b) => a.length - b.length)[0]
      ?? keys.slice().sort((a, b) => a.length - b.length)[0]
    const variant = blockstate.variants[normal]
    const chosen = Array.isArray(variant) ? variant[0] : variant
    return chosen?.model ? normalizeModelPath(chosen.model) : null
  }
  return null
}

const blockSprite = (name) => {
  const blockstate = readJson(join(assetRoot, 'blockstates', `${name}.json`))
  if (blockstate?.multipart) {
    const defaults = blockstate.multipart.filter((part) => !part.when)
    const parts = defaults.length ? defaults : blockstate.multipart
    const canvases = parts
      .map((part) => (part.apply?.model ? renderModel(normalizeModelPath(part.apply.model)) : null))
      .filter(Boolean)
    if (canvases.length) {
      const canvas = blankCanvas()
      for (const layer of canvases) {
        for (let index = 0; index < canvas.data.length; index += 4) {
          const alpha = layer.data[index + 3]
          if (!alpha) continue
          blend(canvas, (index / 4) % SIZE, Math.floor(index / 4 / SIZE), layer.data[index], layer.data[index + 1], layer.data[index + 2], alpha)
        }
      }
      return canvas
    }
  }

  const variant = pickVariantModel(blockstate)
  if (variant) {
    const rendered = renderModel(variant)
    if (rendered) return rendered
  }

  const direct = renderModel(`block/${name}`)
  if (direct) return direct

  const textureCandidates = [`block/${name}`, `block/${name}_0`, `block/${name}_off`, `block/${name}_side`, `block/${name}_top`, `block/${name}_front`]
  for (const candidate of textureCandidates) {
    const texture = loadTexture(candidate)
    if (texture) {
      const canvas = blankCanvas()
      const tint = tintFor(candidate)
      if (tint && isGrayish(texture)) {
        const tinted = new PNG({ width: texture.width, height: texture.height })
        for (let index = 0; index < texture.data.length; index += 4) {
          tinted.data[index] = Math.round((texture.data[index] * tint[0]) / 255)
          tinted.data[index + 1] = Math.round((texture.data[index + 1] * tint[1]) / 255)
          tinted.data[index + 2] = Math.round((texture.data[index + 2] * tint[2]) / 255)
          tinted.data[index + 3] = texture.data[index + 3]
        }
        drawLayer(canvas, tinted)
      } else {
        drawLayer(canvas, texture)
      }
      return canvas
    }
  }
  return null
}

const firstModelPath = (node, depth = 0) => {
  if (!node || typeof node !== 'object' || depth > 6) return null
  if (node.type === 'minecraft:model' && typeof node.model === 'string') return node.model
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = firstModelPath(item, depth + 1)
      if (found) return found
    }
    return null
  }
  const candidates = [
    node.fallback,
    node.on_true,
    node.on_false,
    ...(Array.isArray(node.cases) ? node.cases.map((item) => item.model) : []),
    ...(Array.isArray(node.models) ? node.models : []),
    ...(Array.isArray(node.entries) ? node.entries.map((item) => item.model) : []),
  ]
  for (const candidate of candidates) {
    const found = firstModelPath(candidate, depth + 1)
    if (found) return found
  }
  return typeof node.base === 'string' ? node.base : null
}

const itemSprite = (name) => {
  const definition = readJson(join(assetRoot, 'items', `${name}.json`))
  const modelRef = firstModelPath(definition?.model)
  if (modelRef) {
    const rendered = renderModel(normalizeModelPath(modelRef))
    if (rendered) return rendered
  }
  const legacy = renderModel(`item/${name}`)
  if (legacy) return legacy
  const texture = loadTexture(`item/${name}`)
  if (texture) {
    const canvas = blankCanvas()
    drawLayer(canvas, texture)
    return canvas
  }
  return null
}

let entityTextureIndex = null

const buildEntityTextureIndex = () => {
  if (entityTextureIndex) return entityTextureIndex
  const base = join(assetRoot, 'textures/entity')
  const index = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, file.name)
      if (file.isDirectory()) walk(full)
      else if (file.name.endsWith('.png') && !file.name.endsWith('_emissive.png')) {
        index.push({
          base: file.name.replace(/\.png$/, ''),
          rel: `entity/${full.slice(base.length + 1).split('\\').join('/').replace(/\.png$/, '')}`,
        })
      }
    }
  }
  walk(base)
  entityTextureIndex = index
  return index
}

const mobEntityTexture = (name) => {
  const candidates = [
    `entity/${name}/${name}`,
    `entity/${name}`,
    `entity/${name}/${name}_0`,
    `entity/mob/${name}`,
  ]
  const direct = candidates.find((candidate) => loadTexture(candidate))
  if (direct) return direct
  const index = buildEntityTextureIndex()
  const hit = index.find((item) => item.base === name)
    ?? index.find((item) => item.base.startsWith(`${name}_`))
  return hit?.rel ?? null
}

const mobSprite = (name) => {
  const egg = renderModel(`item/${name}_spawn_egg`)
  if (egg) return egg
  const asItem = renderModel(`item/${name}`)
  if (asItem) return asItem
  const fromItems = readJson(join(assetRoot, 'items', `${name}.json`))
  const itemRef = firstModelPath(fromItems?.model)
  if (itemRef) {
    const rendered = renderModel(normalizeModelPath(itemRef))
    if (rendered) return rendered
  }
  const entity = mobEntityTexture(name)
  if (entity) {
    const canvas = blankCanvas()
    drawLayer(canvas, loadTexture(entity))
    return canvas
  }
  return null
}

const isEmpty = (canvas) => !canvas?.data.some((value, index) => index % 4 === 3 && value > 8)

const main = () => {
  if (!existsSync(assetRoot)) {
    console.error('缺少 .cache/jar/assets/minecraft，请先运行 node scripts/extract-jar.mjs')
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })

  const manifest = { version, generatedAt: new Date().toISOString(), map: {} }
  const counters = { block: 0, item: 0, mob: 0 }
  const missing = { block: [], item: [], mob: [] }

  for (const entry of catalog.catalog) {
    const canvas = entry.kind === 'block'
      ? blockSprite(entry.name)
      : entry.kind === 'item'
        ? itemSprite(entry.name)
        : mobSprite(entry.name)

    if (!canvas || isEmpty(canvas)) {
      missing[entry.kind].push(entry.name)
      continue
    }
    const target = join(outDir, entry.kind, `${entry.name}.png`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, PNG.sync.write(canvas))
    manifest.map[entry.id] = `/sprites/${entry.kind}/${entry.name}.png`
    counters[entry.kind] += 1
  }

  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest))

  const total = counters.block + counters.item + counters.mob
  console.log(`生成 ${total} 个官方材质图标（Java ${version}）：`)
  console.log(`  方块 ${counters.block} / ${catalog.meta.counts.blocks}`)
  console.log(`  物品 ${counters.item} / ${catalog.meta.counts.items}`)
  console.log(`  生物 ${counters.mob} / ${catalog.meta.counts.entities}`)
  for (const kind of Object.keys(missing)) {
    if (missing[kind].length) {
      console.log(`  缺少图标的 ${kind}：${missing[kind].length} 个 → ${missing[kind].slice(0, 12).join(', ')}${missing[kind].length > 12 ? ' …' : ''}`)
    }
  }
}

main()
