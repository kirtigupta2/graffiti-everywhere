import type { SwatchColor } from '../types'

export const PALETTE: SwatchColor[] = [
  { id: 'lime', label: 'Neon Lime', hex: '#cfff3d' },
  { id: 'pink', label: 'Rani Pink', hex: '#ff2f9e' },
  { id: 'brand', label: 'Rust', hex: '#a42100' },
  { id: 'ice', label: 'Ice Blue', hex: '#3df0ff' },
  { id: 'violet', label: 'Ultraviolet', hex: '#8a3dff' },
  { id: 'white', label: 'Chalk', hex: '#ffffff' },
]

/** Line width in raw video-pixel units (the video is typically ~1920px wide). */
export const DEFAULT_STROKE_WIDTH = 14
