import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

export interface TrackingFrame {
  hand: NormalizedLandmark[] | null
  pose: NormalizedLandmark[] | null
}

type LoadStatus = 'loading' | 'ready' | 'error'

/**
 * Loads MediaPipe's HandLandmarker + PoseLandmarker once and exposes a
 * `detect(video, timestamp)` function that runs both models against a
 * shared video frame. Kept as a single hook so the caller's render loop
 * only needs one call per frame.
 */
export function useVisionTracking() {
  const [status, setStatus] = useState<LoadStatus>('loading')
  const handRef = useRef<HandLandmarker | null>(null)
  const poseRef = useRef<PoseLandmarker | null>(null)

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

        const pose = await createWithFallback((delegate) =>
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
        )

        if (cancelled) {
          hand.close()
          pose.close()
          return
        }

        handRef.current = hand
        poseRef.current = pose
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
      poseRef.current?.close()
      handRef.current = null
      poseRef.current = null
    }
  }, [])

  const detect = useCallback((video: HTMLVideoElement, timestampMs: number): TrackingFrame => {
    const hand = handRef.current?.detectForVideo(video, timestampMs)
    const pose = poseRef.current?.detectForVideo(video, timestampMs)
    return {
      hand: hand?.landmarks?.[0] ?? null,
      pose: pose?.landmarks?.[0] ?? null,
    }
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
