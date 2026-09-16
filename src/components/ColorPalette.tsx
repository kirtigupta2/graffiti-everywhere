import type { CSSProperties } from 'react'
import { PALETTE } from '../lib/palette'
import styles from './ColorPalette.module.css'

interface ColorPaletteProps {
  activeColorId: string
  hoveredId: string | null
  onSelect: (colorId: string) => void
}

export function ColorPalette({ activeColorId, hoveredId, onSelect }: ColorPaletteProps) {
  return (
    <div className={styles.palette} aria-label="Color palette">
      {PALETTE.map((swatch) => {
        const hoverTargetId = `swatch-${swatch.id}`
        const isHovered = hoveredId === hoverTargetId
        const isActive = activeColorId === swatch.id
        return (
          <button
            key={swatch.id}
            type="button"
            data-hover-id={hoverTargetId}
            className={[styles.swatch, isHovered ? styles.hovered : '', isActive ? styles.active : ''].join(' ').trim()}
            style={{ '--swatch-color': swatch.hex } as CSSProperties}
            aria-label={swatch.label}
            aria-pressed={isActive}
            onClick={() => onSelect(swatch.id)}
          />
        )
      })}
    </div>
  )
}
