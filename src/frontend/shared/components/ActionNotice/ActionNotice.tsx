export const NOTICE_DURATION_MS = 6000;

export function ActionNotice({
  message,
  dismiss,
  actionLabel,
  onAction,
}: {
  message: string;
  dismiss: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="app-toast" role="status" aria-live="polite">
      <span>{message}</span>
      {actionLabel && (
        <button className="app-toast-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      <button className="app-toast-close" aria-label="Dismiss message" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
