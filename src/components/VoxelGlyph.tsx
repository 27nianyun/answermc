import { motion, useReducedMotion } from 'framer-motion'
import { Cube, PawPrint, Sword } from '@phosphor-icons/react'
import type { Kind } from '../types'

interface VoxelGlyphProps {
  name: string
  kind: Kind
  revealLevel: number
  solved: boolean
}

const palette: Record<Kind, [string, string, string]> = {
  block: ['#547a48', '#7e9b55', '#9d7045'],
  item: ['#486b78', '#78919a', '#d0aa65'],
  mob: ['#795f47', '#a17b58', '#d7b47b'],
}

const hash = (value: string) => {
  let result = 0
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0
  }
  return result
}

export function VoxelGlyph({ name, kind, revealLevel, solved }: VoxelGlyphProps) {
  const reduceMotion = useReducedMotion()
  const colors = palette[kind]
  const seed = hash(name)
  const cells = Array.from({ length: 64 }, (_, index) => {
    const row = Math.floor(index / 8)
    const sourceColumn = index % 8 < 4 ? index % 8 : 7 - (index % 8)
    const value = (seed + row * 97 + sourceColumn * 53) % 11
    const active = value > (revealLevel > 2 ? 1 : revealLevel > 0 ? 3 : 5)
    return { active, color: colors[value % colors.length] }
  })

  const Icon = kind === 'block' ? Cube : kind === 'mob' ? PawPrint : Sword

  return (
    <motion.div
      className={`voxel-stage ${solved ? 'is-solved' : ''}`}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.92, rotate: -2 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 18 }}
      aria-label="当前题目的像素化轮廓"
    >
      <div className="voxel-shadow" />
      <div
        className="voxel-grid"
        style={{ filter: solved ? 'none' : `blur(${Math.max(0, 3 - revealLevel * 0.7)}px)` }}
        aria-hidden="true"
      >
        {cells.map((cell, index) => (
          <span
            key={index}
            style={{
              opacity: cell.active ? 1 : 0,
              backgroundColor: solved ? cell.color : '#3f463d',
            }}
          />
        ))}
      </div>
      <Icon className="voxel-kind-icon" weight="duotone" aria-hidden="true" />
      <div className="scan-line" aria-hidden="true" />
    </motion.div>
  )
}
