import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { api, type CoreState, type State } from '../../../api/client';
import { effectiveMs, formatPreciseDuration } from '../../../calculations/billing';
import './pill.css';

const tauri='__TAURI_INTERNALS__' in window;
function Pill() {
  const [state,setState]=useState<State>();
  const [core,setCore]=useState<CoreState>();
  const [offline,setOffline]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [error,setError]=useState('');
  const [dismissed,setDismissed]=useState(false);
  const refresh=async()=>{
    try {
      const [legacy,session,periods,questions]=await Promise.all([
        api.GET('/api/state'),api.GET('/api/sessions/active'),api.GET('/api/work-periods'),api.GET('/api/questions'),
      ]);
      if(legacy.error||session.error||periods.error||questions.error||!legacy.data) throw Error('State unavailable');
      setState(legacy.data);
      setCore({activeSession:session.data??null,sessions:[],periods:periods.data??[],questions:questions.data??[],sources:[],coverageGaps:[],billing:{invoices:[],lines:[],expenses:[]}});
      setOffline(false);
    } catch {setOffline(true);}
  };
  useEffect(()=>{void refresh();const poll=window.setInterval(()=>void refresh(),5000);return()=>window.clearInterval(poll);},[]);
  const active=core?.activeSession;
  const current=core?.periods.find(p=>p.sessionId===active?.id&&p.endedAt===null);
  const item=state?.matter.find(m=>String(m.id)===current?.caseId);
  const owner=item?state?.client.find(c=>c.id===item.client_id):null;
  const pending=core?.periods.filter(p=>p.sessionId===active?.id&&!p.excluded&&!p.timeValidated).length??0;
  const question=core?.questions.find(q=>q.sessionId===active?.id&&q.status==='pending');
  const notice=question&&!dismissed?`Case answer needed for period ${question.periodId}`:null;
  useEffect(()=>{if(tauri) void invoke('set_pill_expanded',{expanded,notification:Boolean(notice&&!expanded)});},[expanded,notice]);
  const toggle=async()=>{
    const next=!expanded;
    if(tauri) try {await invoke('set_pill_expanded',{expanded:next,notification:Boolean(notice&&!next)});} catch {setError('Unable to resize the pill');return;}
    setExpanded(next);
  };
  const openDay=()=>{if(tauri) void invoke('open_my_day').catch(()=>setError('Unable to open TimeKeeper'));else window.open('/','_blank');};
  const assign=async(caseId:string)=>{
    if(!current)return;
    const targetQuestion=core?.questions.find(q=>q.periodId===current.id&&q.status==='pending');
    const response=targetQuestion ? await api.POST('/api/questions/answer',{body:{questionId:targetQuestion.questionId,
      sessionId:targetQuestion.sessionId,periodId:current.id,expectedAssignmentRevision:targetQuestion.expectedAssignmentRevision,
      caseId,responseCommandId:crypto.randomUUID()}}) : await api.POST('/api/work-periods/{id}/assignment',{params:{path:{id:current.id}},
      body:{caseId,expectedAssignmentRevision:current.assignmentRevision,origin:'lawyer'}});
    if(response.error) setError(JSON.stringify(response.error));else await refresh();
  };
  return <main className="pill-root">
    <button className="pill-bar" onClick={()=>void toggle()} aria-expanded={expanded} aria-label="TimeKeeper, toggle panel">
      <span className="pill-logo">T</span><span className={`status-dot ${active?'':'paused'}`}/>
      <span className="pill-client">{offline?'Server not running':active?owner?.name??'Session active':'No active session'}</span>
      <strong className="pill-amount">{offline?'—':current?formatPreciseDuration(effectiveMs(current)):'—'}</strong>
      {pending>0&&<span className="pill-badge" aria-label={`${pending} periods to review`}>{pending}</span>}
    </button>
    {expanded&&<section className="pill-panel" aria-label="Current work period">
      {offline?<p className="pill-error" role="status">Server not running. Start the local API and this panel will reconnect.</p>:<>
        <div className="pill-case"><strong>{active?item?.title??'No current case':'No active session'}</strong><small>{active?`Session ${active.id}`:'Start from Screenpipe'}</small>
          {active&&<small>Session since {active.startedAt.slice(11,16)} · this period since {current?.startedAt.slice(11,16)??'—'}</small>}</div>
        <p className="pill-subtitle">{owner?.name??'Unassigned'} · Demo evidence only</p>
        <div className="pill-totals"><div><small>This period</small><strong>{current?formatPreciseDuration(effectiveMs(current)):'Unknown'}</strong></div><div><small>Review</small><strong>{pending} pending</strong></div></div>
        <div className="pill-actions"><button disabled title="Screenpipe owns recording">Pause</button><button disabled title="A period boundary requires a confirmed transition">Close period</button></div>
        <label className="pill-select">Other case<select disabled={!current||current.billingStatus==='billed'} value={current?.caseId??''} onChange={event=>void assign(event.target.value)}>
          <option value="" disabled>Choose a case</option>{state?.matter.filter(m=>m.status==='open').map(m=><option key={m.id} value={String(m.id)}>{m.title}</option>)}
        </select></label>
        <button className="pill-open" onClick={openDay}>Open my day</button>
        {notice&&<div className="pill-notice" role="status"><div><strong>Question pending</strong><small>{notice}</small></div><button aria-label="Dismiss notification" onClick={()=>setDismissed(true)}>×</button></div>}
        {error&&<p className="pill-error" role="alert">{error}</p>}
      </>}
    </section>}
    {!expanded&&notice&&<div className="pill-floating-notice" role="status"><div><strong>Question pending</strong><small>{notice}</small></div><button aria-label="Dismiss notification" onClick={()=>setDismissed(true)}>×</button></div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Pill/>);
