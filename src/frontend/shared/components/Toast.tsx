import { useEffect, useState } from 'react';

type Notice = { id: number; message: string; actionLabel?: string; onAction?: () => void };
const listeners = new Set<(notice: Notice) => void>();
let nextId = 0;

export function showToast(message: string, actionLabel?: string, onAction?: () => void) {
  const notice = { id: ++nextId, message, actionLabel, onAction };
  listeners.forEach(listener => listener(notice));
}

export function ToastHost() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    const receive = (next: Notice) => setNotice(next);
    listeners.add(receive);
    return () => { listeners.delete(receive); };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(current => current?.id === notice.id ? null : current), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return <div className="app-toast" role="status" aria-live="polite" key={notice.id}>
    <span>{notice.message}</span>
    {notice.actionLabel && <button className="app-toast-action" onClick={() => { notice.onAction?.(); setNotice(null); }}>{notice.actionLabel}</button>}
    <button className="app-toast-close" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button>
  </div>;
}
