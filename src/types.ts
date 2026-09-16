export interface Point2D {
  x: number
  y: number
}

export type GestureName = 'draw' | 'wipe' | 'point' | 'none'

export interface GestureState {
  name: GestureName
  /** Fingertip used as the active cursor (index tip for draw/point, palm center for wipe). Screen-space, pixels. */
  cursor: Point2D | null
  /** 0-1 confidence-ish pinch closeness, only meaningful while pointing, used for a "charging up" select animation. */
  pinchAmount: number
}

export interface BodyAnchor {
  origin: Point2D
  rotation: number
  scale: number
}

export interface StrokePoint {
  x: number
  y: number
}

export interface Stroke {
  id: string
  color: string
  width: number
  points: StrokePoint[]
}

export interface SwatchColor {
  id: string
  label: string
  hex: string
}
