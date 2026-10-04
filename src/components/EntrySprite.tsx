import { motion, useReducedMotion } from 'framer-motion'
import { spriteUrlFor } from '../sprites'
import type { CatalogEntry } from '../types'
import { VoxelGlyph } from './VoxelGlyph'

interface EntrySpriteProps {
  entry: CatalogEntry
  solved?: boolean
  className?: string
  eager?: boolean
}

export function EntrySprite({ entry, solved = false, className = '', eager = false }: EntrySpriteProps) {
  const reduceMotion = useReducedMotion()
  const source = spriteUrlFor(entry)

  // 未揭晓时不露出任何轮廓：只用问号占位，避免提前泄漏形状与配色
  if (!solved) {
    return (
      <motion.div
        className={`sprite-stage sprite-mystery ${className}`}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 180, damping: 18 }}
        aria-label="目标尚未揭晓"
      >
        <span className="mystery-mark" aria-hidden="true">?</span>
        <span className="mystery-note">揭晓后显示官方材质</span>
        <div className="scan-line" aria-hidden="true" />
      </motion.div>
    )
  }

  if (!source) {
    return <VoxelGlyph name={entry.name} kind={entry.kind} revealLevel={5} solved />
  }

  return (
    <motion.div
      className={`sprite-stage is-solved ${className}`}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.9, rotate: -2 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 18 }}
      aria-label={`${entry.zhName} 官方材质`}
    >
      <div className="voxel-shadow" />
      <img
        className="sprite-img"
        src={source}
        alt=""
        draggable={false}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
      <div className="scan-line" aria-hidden="true" />
    </motion.div>
  )
}
