import styles from './OnboardingOverlay.module.css'

interface OnboardingOverlayProps {
  visible: boolean
  message: string
  isError: boolean
  onRetry?: () => void
}

export function OnboardingOverlay({ visible, message, isError, onRetry }: OnboardingOverlayProps) {
  return (
    <div className={[styles.overlay, visible ? '' : styles.hidden].join(' ').trim()}>
      <h1 className={styles.title}>
        Step back and show your <span className={styles.accent}>hands</span>
      </h1>
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
