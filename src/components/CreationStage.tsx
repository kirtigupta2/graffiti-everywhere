import { useCallback, useEffect, useRef, useState } from 'react'
import { useHandTracking } from '../hooks/useHandTracking'
import { resolveGesture } from '../lib/gestures'
import { splitPointsNear } from '../lib/strokes'
import { videoPointToViewport } from '../lib/videoSpace'
import { PointOneEuroFilter } from '../lib/oneEuroFilter'
import { PALETTE, DEFAULT_STROKE_WIDTH } from '../lib/palette'
import { ColorPalette } from './ColorPalette'
import { CaptureButton } from './CaptureButton'
import { PromptOverlay } from './PromptOverlay'
import type { GestureName, Point2D, Stroke } from '../types'
import styles from './CreationStage.module.css'

const MAX_STROKES = 250
const ERASE_RADIUS_PX = 55
const ENGAGE_FRAMES_NEEDED = 8
const MIN_POINT_DISTANCE_PX = 2.5
const STROKE_END_GRACE_FRAMES = 6
// Require the open-palm gesture to hold for a couple of frames before it
// actually erases anything — a single noisy frame reading as an open palm
// (relaxed fingers mid-pinch, a quick hand-shape transition) shouldn't be
// enough to fire a destructive action.
const WIPE_SUSTAIN_FRAMES = 2
const LIME = '#cfff3d'

type CameraStatus = 'requesting' | 'granted' | 'denied'
type PinchMode = 'draw' | 'select' | null

let strokeIdCounter = 0
function makeStrokeId(): string {
  return `s-${Date.now()}-${strokeIdCounter++}`
}

/**
 * The canvas is the video frame itself, treated as a fixed sheet — like a
 * transparent layer painted directly onto a plain wall behind you. Strokes
 * are stored and rendered at the exact video-pixel coordinates they were
 * drawn at, with no per-frame tracking or transform. That's deliberate: a
 * stationary webcam means the background genuinely doesn't move in frame,
 * so "stick to what it was drawn on" falls out for free and reliably,
 * instead of depending on a live vision fit that can drift or misfire.
 */
export function CreationStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const mediaLayerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('requesting')
  const [bodyEngaged, setBodyEngaged] = useState(false)
  const [activeColorId, setActiveColorId] = useState(PALETTE[0].id)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [captureFlash, setCaptureFlash] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const hand = useHandTracking()

  const activeColorRef = useRef(PALETTE[0].hex)
  const strokesRef = useRef<Stroke[]>([])
  const currentStrokeRef = useRef<Stroke | null>(null)
  const pinchModeRef = useRef<PinchMode>(null)
  const drawGapFramesRef = useRef(0)
  const wipeSustainFramesRef = useRef(0)
  const wasPinchingRef = useRef(false)

  const drawFilterRef = useRef(new PointOneEuroFilter(1.2, 0.6))
  const pointFilterRef = useRef(new PointOneEuroFilter(1.2, 0.6))
  const wipeFilterRef = useRef(new PointOneEuroFilter(1.2, 0.6))
  const lastGestureNameRef = useRef<GestureName>('none')

  const hoveredIdRef = useRef<string | null>(null)
  const engagedFramesRef = useRef(0)
  const engagedFiredRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    activeColorRef.current = PALETTE.find((c) => c.id === activeColorId)?.hex ?? PALETTE[0].hex
  }, [activeColorId])

  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const out = document.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    const ctx = out.getContext('2d')
    if (!ctx) return

    ctx.translate(out.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0, out.width, out.height)

    out.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `graffit-you-${Date.now()}.png`
      link.click()
      URL.revokeObjectURL(url)
    }, 'image/png')

    setCaptureFlash(true)
    setToast('Saved to your downloads')
    window.setTimeout(() => setCaptureFlash(false), 420)
    window.setTimeout(() => setToast(null), 1800)
  }, [])

  // Camera setup.
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled || !videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraStatus('granted')
      } catch (err) {
        console.error('Camera access failed', err)
        if (!cancelled) setCameraStatus('denied')
      }
    }

    start()

    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // Detection + draw loop.
  useEffect(() => {
    if (cameraStatus !== 'granted') return

    function updateHovered(id: string | null) {
      if (hoveredIdRef.current !== id) {
        hoveredIdRef.current = id
        setHoveredId(id)
      }
    }

    function hitTest(point: Point2D): string | null {
      const nodes = stageRef.current?.querySelectorAll<HTMLElement>('[data-hover-id]')
      if (!nodes) return null
      for (const node of nodes) {
        const rect = node.getBoundingClientRect()
        const pad = 8
        if (point.x >= rect.left - pad && point.x <= rect.right + pad && point.y >= rect.top - pad && point.y <= rect.bottom + pad) {
          return node.dataset.hoverId ?? null
        }
      }
      return null
    }

    function runHoverAction(targetId: string) {
      if (targetId === 'capture') {
        capture()
      } else if (targetId.startsWith('swatch-')) {
        setActiveColorId(targetId.slice('swatch-'.length))
      }
    }

    function startNewStroke(point: Point2D) {
      const stroke: Stroke = {
        id: makeStrokeId(),
        color: activeColorRef.current,
        width: DEFAULT_STROKE_WIDTH,
        points: [point],
      }
      currentStrokeRef.current = stroke
      strokesRef.current.push(stroke)
      if (strokesRef.current.length > MAX_STROKES) strokesRef.current.shift()
    }

    function appendPointIfFarEnough(stroke: Stroke, point: Point2D) {
      const last = stroke.points[stroke.points.length - 1]
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_DISTANCE_PX) return
      stroke.points.push(point)
    }

    function eraseAt(cursor: Point2D, radiusPx: number) {
      const next: Stroke[] = []
      let changed = false

      for (const stroke of strokesRef.current) {
        const segments = splitPointsNear(stroke.points, cursor, radiusPx)
        const survivingPoints = segments.reduce((n, s) => n + s.length, 0)

        if (survivingPoints === stroke.points.length) {
          next.push(stroke)
          continue
        }

        changed = true
        for (const segment of segments) {
          if (segment.length === 0) continue
          next.push({ id: makeStrokeId(), color: stroke.color, width: stroke.width, points: segment })
        }
      }

      if (changed) strokesRef.current = next
    }

    function drawCursor(ctx: CanvasRenderingContext2D, name: GestureName, cursor: Point2D, pinchAmount: number) {
      ctx.save()
      ctx.shadowBlur = 0
      if (name === 'draw') {
        ctx.fillStyle = activeColorRef.current
        ctx.beginPath()
        ctx.arc(cursor.x, cursor.y, DEFAULT_STROKE_WIDTH / 1.4, 0, Math.PI * 2)
        ctx.fill()
      } else if (name === 'wipe') {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(cursor.x, cursor.y, ERASE_RADIUS_PX, 0, Math.PI * 2)
        ctx.stroke()
      } else if (name === 'point') {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(cursor.x, cursor.y, 10, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = LIME
        ctx.beginPath()
        ctx.arc(cursor.x, cursor.y, 10, -Math.PI / 2, -Math.PI / 2 + pinchAmount * Math.PI * 2)
        ctx.lineTo(cursor.x, cursor.y)
        ctx.fill()
      }
      ctx.restore()
    }

    /** Strokes a smooth curve through `points` using the midpoint quadratic-curve technique, instead of raw straight segments between noisy points. */
    function strokeSmoothPath(ctx: CanvasRenderingContext2D, points: Point2D[]) {
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length - 1; i++) {
        const mx = (points[i].x + points[i + 1].x) / 2
        const my = (points[i].y + points[i + 1].y) / 2
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my)
      }
      const last = points[points.length - 1]
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
    }

    function tick() {
      rafRef.current = requestAnimationFrame(tick)

      const video = videoRef.current
      const canvas = canvasRef.current
      const media = mediaLayerRef.current
      if (!video || !canvas || !media || video.readyState < 2) return

      if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const now = performance.now()
      const handLandmarks = hand.detect(video, now)

      if (!engagedFiredRef.current) {
        if (handLandmarks) engagedFramesRef.current += 1
        else engagedFramesRef.current = Math.max(0, engagedFramesRef.current - 1)
        if (engagedFramesRef.current > ENGAGE_FRAMES_NEEDED) {
          engagedFiredRef.current = true
          setBodyEngaged(true)
        }
      }

      // Nothing is interactive until onboarding has actually finished —
      // without this gate, hand-tracking noise during warm-up (before a
      // real, steady hand is even on screen) could satisfy the pinch
      // threshold for a stray frame and leave a spurious dot.
      if (!engagedFiredRef.current) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return
      }

      const gesture = handLandmarks
        ? resolveGesture(handLandmarks, canvas.width, canvas.height, wasPinchingRef.current)
        : { name: 'none' as GestureName, cursor: null, pinchAmount: 0 }
      wasPinchingRef.current = gesture.name === 'draw'

      if (gesture.name !== lastGestureNameRef.current) {
        drawFilterRef.current.reset()
        pointFilterRef.current.reset()
        wipeFilterRef.current.reset()
      }
      lastGestureNameRef.current = gesture.name

      wipeSustainFramesRef.current = gesture.name === 'wipe' ? wipeSustainFramesRef.current + 1 : 0

      let smoothedCursor: Point2D | null = null
      if (gesture.cursor) {
        const filter = gesture.name === 'draw' ? drawFilterRef.current : gesture.name === 'wipe' ? wipeFilterRef.current : pointFilterRef.current
        smoothedCursor = filter.filter(gesture.cursor, now)
      }

      let viewportCursor: Point2D | null = null
      if (smoothedCursor) viewportCursor = videoPointToViewport(smoothedCursor, video, media)

      if (gesture.name === 'draw') {
        drawGapFramesRef.current = 0
        if (pinchModeRef.current === null) {
          const targetId = viewportCursor ? hitTest(viewportCursor) : null
          if (targetId) {
            pinchModeRef.current = 'select'
            runHoverAction(targetId)
          } else {
            pinchModeRef.current = 'draw'
            if (!currentStrokeRef.current && smoothedCursor) startNewStroke(smoothedCursor)
          }
        }
        if (pinchModeRef.current === 'draw' && currentStrokeRef.current && smoothedCursor) {
          appendPointIfFarEnough(currentStrokeRef.current, smoothedCursor)
        }
        updateHovered(null)
      } else {
        if (pinchModeRef.current === 'draw') {
          drawGapFramesRef.current += 1
          if (drawGapFramesRef.current > STROKE_END_GRACE_FRAMES) {
            currentStrokeRef.current = null
            pinchModeRef.current = null
          }
        } else if (pinchModeRef.current === 'select') {
          pinchModeRef.current = null
        }

        // While a draw session is still within its grace window (see
        // above), the user's actual intent this instant is still "I'm
        // drawing" — a single noisy frame here can otherwise read as an
        // open palm (fingers relaxed mid-pinch) and fire an erase right on
        // top of the stroke just drawn, which is what caused strokes to
        // visibly break while the pinch was still held.
        if (pinchModeRef.current !== null) {
          updateHovered(null)
        } else if (gesture.name === 'wipe' && smoothedCursor) {
          if (wipeSustainFramesRef.current > WIPE_SUSTAIN_FRAMES) {
            eraseAt(smoothedCursor, ERASE_RADIUS_PX)
          }
          updateHovered(null)
        } else if (gesture.name === 'point' && viewportCursor) {
          updateHovered(hitTest(viewportCursor))
        } else {
          updateHovered(null)
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const stroke of strokesRef.current) {
        const points = stroke.points

        ctx.strokeStyle = stroke.color
        ctx.fillStyle = stroke.color
        ctx.shadowColor = stroke.color
        ctx.shadowBlur = 14

        if (points.length === 1) {
          ctx.beginPath()
          ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2)
          ctx.fill()
          continue
        }

        ctx.lineWidth = stroke.width
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        strokeSmoothPath(ctx, points)
      }
      ctx.shadowBlur = 0

      if (smoothedCursor) {
        drawCursor(ctx, gesture.name, smoothedCursor, gesture.pinchAmount)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [cameraStatus, hand, capture])

  const overlayVisible = !bodyEngaged
  let overlayMessage = 'Sit against a plain wall or background — that’s your canvas. Pinch fully to draw, open your palm to wipe.'
  let overlayError = false
  if (cameraStatus === 'denied') {
    overlayError = true
    overlayMessage = 'Camera access is blocked. Allow camera permissions in your browser and try again.'
  } else if (cameraStatus === 'requesting') {
    overlayMessage = 'Waking up your camera…'
  } else if (hand.status === 'error') {
    overlayError = true
    overlayMessage = 'Hand tracking failed to load. Check your connection and try again.'
  } else if (hand.status === 'loading') {
    overlayMessage = 'Loading hand tracking…'
  }

  return (
    <div className={styles.stage} ref={stageRef}>
      <div className={styles.mediaLayer} ref={mediaLayerRef}>
        <video ref={videoRef} className={styles.video} muted playsInline />
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>

      <div className={styles.wordmark}>
        graffit<span className={styles.dot}>.</span>you
      </div>

      {toast && <div className={styles.toast}>{toast}</div>}

      {bodyEngaged && (
        <>
          <ColorPalette activeColorId={activeColorId} hoveredId={hoveredId} onSelect={setActiveColorId} />
          <CaptureButton hovered={hoveredId === 'capture'} flash={captureFlash} onCapture={capture} />
        </>
      )}

      <PromptOverlay
        visible={overlayVisible}
        title={
          <>
            Step back and show your <span className={styles.accentInline}>hands</span>
          </>
        }
        message={overlayMessage}
        isError={overlayError}
        onRetry={() => window.location.reload()}
      />
    </div>
  )
}
