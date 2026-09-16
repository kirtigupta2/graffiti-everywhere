import type { ReactNode } from 'react'
import styles from './PromptOverlay.module.css'

interface PromptOverlayProps {
  visible: boolean
  title: ReactNode
  message: string
  isError?: boolean
  onRetry?: () => void
}

export function PromptOverlay({ visible, title, message, isError, onRetry }: PromptOverlayProps) {
  return (
    <div className={[styles.overlay, visible ? '' : styles.hidden].join(' ').trim()}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.hint}>{message}</p>
      {isError ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Try again
        </button>
      ) : (
        <div className={styles.ring} aria-hidden="true" />
      )}
    </div>
  )
}
