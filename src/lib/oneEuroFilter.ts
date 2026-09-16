import type { Point2D } from '../types'

/**
 * The 1€ Filter (Casiez, Roussel, Vogel 2012): an adaptive low-pass filter
 * that smooths out slow jitter but backs off automatically during fast
 * motion, so a smoothed hand-drawn line doesn't lag behind a quick stroke.
 */
class LowPassFilter {
  private value = 0
  private initialized = false

  filter(x: number, alpha: number): number {
    this.value = this.initialized ? alpha * x + (1 - alpha) * this.value : x
    this.initialized = true
    return this.value
  }

  reset() {
    this.initialized = false
  }
}

function smoothingAlpha(cutoff: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dtSeconds)
}

class ScalarOneEuroFilter {
  private xFilter = new LowPassFilter()
  private dxFilter = new LowPassFilter()
  private lastValue: number | null = null
  private minCutoff: number
  private beta: number
  private dCutoff: number

  constructor(minCutoff: number, beta: number, dCutoff: number) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  filter(x: number, dtSeconds: number): number {
    const dt = Math.max(dtSeconds, 1 / 240)
    const prev = this.lastValue ?? x
    const dx = (x - prev) / dt
    const edx = this.dxFilter.filter(dx, smoothingAlpha(this.dCutoff, dt))
    const cutoff = this.minCutoff + this.beta * Math.abs(edx)
    const filtered = this.xFilter.filter(x, smoothingAlpha(cutoff, dt))
    this.lastValue = x
    return filtered
  }

  reset() {
    this.xFilter.reset()
    this.dxFilter.reset()
    this.lastValue = null
  }
}

/** Smooths a moving 2D point (e.g. a fingertip cursor) frame to frame. */
export class PointOneEuroFilter {
  private x: ScalarOneEuroFilter
  private y: ScalarOneEuroFilter
  private lastTimestamp: number | null = null

  constructor(minCutoff = 0.8, beta = 0.4, dCutoff = 1.0) {
    this.x = new ScalarOneEuroFilter(minCutoff, beta, dCutoff)
    this.y = new ScalarOneEuroFilter(minCutoff, beta, dCutoff)
  }

  filter(point: Point2D, timestampMs: number): Point2D {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestampMs
      return point
    }
    const dt = (timestampMs - this.lastTimestamp) / 1000
    this.lastTimestamp = timestampMs
    return {
      x: this.x.filter(point.x, dt),
      y: this.y.filter(point.y, dt),
    }
  }

  reset() {
    this.x.reset()
    this.y.reset()
    this.lastTimestamp = null
  }
}
