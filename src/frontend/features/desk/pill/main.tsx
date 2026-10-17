import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { api, client, matter, money, today, type State } from '../../../api/client';
import './pill.css';

const tauri = '__TAURI_INTERNALS__' in window;
const stamp = () => new Date().toTimeString().slice(0, 5);
const simulatedMinuteMs = 1500;

function Pill() {
  const [state, setState] = useState<State>();
  const [offline, setOffline] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState('');
  const [noticeIndex, setNoticeIndex] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [started, setStarted] = useState(Date.now());
  const [accruedMinutes, setAccruedMinutes] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const { data, error } = await api.GET('/api/state');
      if (!data || error) throw new Error('State unavailable');
      setState(data);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  };

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 5000);
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    const rotate = window.setInterval(() => setNoticeIndex(index => index + 1), 10000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); window.clearInterval(rotate); };
  }, []);

  const activeBlock = state?.block.find(block => block.state === 'in_progress');
  const entry = state?.time_entry.find(line => line.block_id === activeBlock?.id);
  const openPause = state?.pause.find(pause => !pause.end_time);
  const paused = Boolean(openPause);
  const liveMinutes = accruedMinutes + (activeBlock && !paused ? Math.floor((now - started) / simulatedMinuteMs) : 0);
  const rate = entry && state ? state.pricing[String(entry.id)] : undefined;
  const extra = rate?.flat_fee ? 0 : Math.round(liveMinutes * (rate?.rate_cents ?? 0) / 60);
  const blockAmount = (entry?.amount_cents ?? 0) + extra;
  const dayAmount = (state?.time_entry.filter(line => line.date === today && line.id !== entry?.id)
    .reduce((sum, line) => sum + line.amount_cents, 0) ?? 0) + blockAmount;
  const toCheck = state?.block.filter(block => block.date === today && block.state === 'to_check').length ?? 0;
  const owner = entry && state ? client(state, entry.matter_id) : undefined;
  const caseName = entry && state ? matter(state, entry.matter_id)?.title : undefined;

  const notice = useMemo(() => {
    if (!state || !state.setting[0]?.notifications) return null;
    const notices: { id: string; title: string; detail: string }[] = [];
    const uncertain = state.block.find(block => block.date === today && block.state === 'to_check');
    if (uncertain) {
      const line = state.time_entry.find(item => item.block_id === uncertain.id);
      notices.push({ id: `check-${uncertain.id}`, title: 'Block without a clear case', detail: `${line?.label ?? uncertain.window_title} · ${money(line?.amount_cents ?? 0)} at the base rate, review today` });
    }
    const call = state.block.find(block => block.date === today && block.app === 'Call' && block.state !== 'discarded');
    if (call) {
      const line = state.time_entry.find(item => item.block_id === call.id);
      notices.push({ id: `call-${call.id}`, title: 'Call assigned', detail: `${line?.label ?? call.window_title} · +${money(line?.amount_cents ?? 0)}` });
    }
    if (activeBlock) notices.push({ id: `active-${activeBlock.id}`, title: 'New block', detail: `${caseName ?? 'Unassigned'} · counter is running` });
    return notices.length ? notices[noticeIndex % notices.length] : null;
  }, [state, activeBlock?.id, caseName, noticeIndex]);
  const showNotice = Boolean(notice && dismissed !== notice.id && !offline);

  useEffect(() => {
    if (tauri) void invoke('set_pill_expanded', { expanded, notification: showNotice && !expanded });
  }, [expanded, showNotice]);

  const toggle = async () => {
    const next = !expanded;
    if (tauri) {
      try { await invoke('set_pill_expanded', { expanded: next, notification: showNotice && !next }); }
      catch { setError('Unable to resize the pill'); return; }
    }
    setExpanded(next);
  };
  const run = async (request: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try { await request(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const checked = async <T,>(request: Promise<{ data?: T; error?: unknown }>): Promise<T> => {
    const result = await request;
    if (result.error || !result.data) throw new Error(JSON.stringify(result.error ?? 'Action failed'));
    return result.data;
  };
  const togglePause = () => void run(async () => {
    if (openPause) {
      await checked(api.PATCH('/api/pauses/{id}', { params: { path: { id: openPause.id } }, body: { end_time: stamp() } }));
      setStarted(Date.now());
    } else {
      await checked(api.POST('/api/pauses', { body: { date: today, start_time: stamp(), reason: '' } }));
      setAccruedMinutes(liveMinutes);
      setStarted(Date.now());
    }
  });
  const closeBlock = () => {
    if (!activeBlock) return;
    void run(async () => {
      await checked(api.POST('/api/blocks/{id}/close', { params: { path: { id: activeBlock.id } }, body: { minutes: Math.max(1, liveMinutes) } }));
      setAccruedMinutes(0);
      setStarted(Date.now());
    });
  };
  const changeCase = (id: number) => {
    if (!entry) return;
    void run(async () => { await checked(api.PATCH('/api/time-entries/{id}', { params: { path: { id: entry.id } }, body: { matter_id: id } })); });
  };
  const openDay = () => {
    if (tauri) void invoke('open_my_day').catch(() => setError('Unable to open TimeKeepr'));
    else window.open('/', '_blank');
  };

  return <main className="pill-root">
    <button className="pill-bar" onClick={() => void toggle()} aria-expanded={expanded} aria-label="TimeKeepr, toggle panel">
      <span className="pill-logo">T</span><span className={`status-dot ${paused ? 'paused' : ''}`} />
      <span className="pill-client">{offline ? 'Server not running' : owner?.name ?? 'No active case'}</span>
      <strong className="pill-amount">{offline ? '—' : paused ? 'Paused' : `+${money(blockAmount)}`}</strong>
      {toCheck > 0 && <span className="pill-badge" aria-label={`${toCheck} blocks to review`}>{toCheck}</span>}
    </button>
    {expanded && <section className="pill-panel" aria-label="Current block">
      {offline ? <p className="pill-error" role="status">Server not running. Start the local API and this panel will reconnect.</p> : <>
        <div className="pill-case"><strong>{caseName ?? 'No active case'}</strong>{activeBlock && <small>Confidence {Math.round(activeBlock.confidence * 100)}%</small>}</div>
        <p className="pill-subtitle">{owner?.name ?? 'Unassigned'}{rate ? ` · ${rate.origin}` : ''}</p>
        <div className="pill-totals"><div><small>This block</small><strong>{money(blockAmount)}</strong></div><div><small>Today</small><strong>{money(dayAmount)}</strong></div></div>
        <div className="pill-actions"><button disabled={busy} onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button><button disabled={busy || !activeBlock} onClick={closeBlock}>Close block</button></div>
        <label className="pill-select">Other case<select disabled={busy || !entry} value={entry?.matter_id ?? ''} onChange={event => changeCase(Number(event.target.value))}><option value="" disabled>Choose a case</option>{state?.matter.filter(item => item.status === 'open').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <button className="pill-open" onClick={openDay}>Open my day</button>
        {showNotice && <div className="pill-notice" role="status"><div><strong>{notice!.title}</strong><small>{notice!.detail}</small></div><button aria-label="Dismiss notification" onClick={() => setDismissed(notice!.id)}>×</button></div>}
        {error && <p className="pill-error" role="alert">{error}</p>}
      </>}
    </section>}
    {!expanded && showNotice && <div className="pill-floating-notice" role="status"><div><strong>{notice!.title}</strong><small>{notice!.detail}</small></div><button aria-label="Dismiss notification" onClick={() => setDismissed(notice!.id)}>×</button></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Pill />);
