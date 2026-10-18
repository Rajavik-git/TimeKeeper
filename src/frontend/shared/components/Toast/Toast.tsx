import { ActionNotice, NOTICE_DURATION_MS } from "../ActionNotice/ActionNotice";
import { useEffect, useState } from "react";

type Notice = { id: number; message: string; actionLabel?: string; onAction?: () => void };
const listeners = new Set<(notice: Notice) => void>();
let nextId = 0;

export function showToast(message: string, actionLabel?: string, onAction?: () => void) {
  const notice = { id: ++nextId, message, actionLabel, onAction };
  listeners.forEach((listener) => listener(notice));
}

export function ToastHost() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    const receive = (next: Notice) => setNotice(next);
    listeners.add(receive);
    return () => {
      listeners.delete(receive);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => setNotice((current) => (current?.id === notice.id ? null : current)),
      NOTICE_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <ActionNotice
      key={notice.id}
      message={notice.message}
      dismiss={() => setNotice(null)}
      actionLabel={notice.actionLabel}
      onAction={() => {
        notice.onAction?.();
        setNotice(null);
      }}
    />
  );
}
