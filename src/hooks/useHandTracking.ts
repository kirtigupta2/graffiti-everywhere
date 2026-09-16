import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

type LoadStatus = 'loading' | 'ready' | 'error'

/**
 * Loads MediaPipe's HandLandmarker once and exposes a `detect(video,
 * timestamp)` function. Where the drawing actually anchors to the world is
 * handled separately by the optical-flow world tracker — this hook only
 * resolves finger positions and gestures.
 */
export function useHandTracking() {
  const [status, setStatus] = useState<LoadStatus>('loading')
  const handRef = useRef<HandLandmarker | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE)

        const hand = await createWithFallback((delegate) =>
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.6,
            minTrackingConfidence: 0.5,
          }),
        )

        if (cancelled) {
          hand.close()
          return
        }

        handRef.current = hand
        setStatus('ready')
      } catch (err) {
        console.error('Failed to load tracking models', err)
        if (!cancelled) setStatus('error')
      }
    }

    load()

    return () => {
      cancelled = true
      handRef.current?.close()
      handRef.current = null
    }
  }, [])

  const detect = useCallback((video: HTMLVideoElement, timestampMs: number): NormalizedLandmark[] | null => {
    const result = handRef.current?.detectForVideo(video, timestampMs)
    return result?.landmarks?.[0] ?? null
  }, [])

  return useMemo(() => ({ status, detect }), [status, detect])
}

async function createWithFallback<T>(factory: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await factory('GPU')
  } catch {
    return factory('CPU')
  }
}
