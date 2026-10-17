import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api, type CoreState, type State } from '../../../api/client';
import { configuredRate, dayFees, effectiveMs, formatPreciseDuration, type Period } from '../../../calculations/billing';
import { money, rate } from '../../../shared/format';
import { Logo } from '../../../shared/brand/Logo';
import './pill.css';

const tauri = '__TAURI_INTERNALS__' in window;
const requestedTheme = new URLSearchParams(window.location.search).get('theme');
if (requestedTheme === 'dark' || requestedTheme === 'light') document.documentElement.dataset.theme=requestedTheme;
const demoDocuments = [
  '2025-031 Opposition Brief v3.docx',
  '[2025-031] Defendant\'s documents.eml',
  '2025-031 Engagement letter - Paul Dawson.pdf',
  '2025-031 Defendant exhibits 1-12 - index.pdf',
  '2025-031 Letter to client - defendant\'s position.docx',
  'Research - notice of appeal deadline for family court orders.docx',
  '2026-004 Petition for dissolution of marriage - Bennett.pdf',
  '2026-004 Hearing preparation notes.docx',
  '2026-009 Letter to landlord - rent proposal.docx',
  '2026-009 Lease renewal notice - Linden Street Properties.pdf',
  '2026-012 Lumen Bylaws draft v2.docx',
  '2026-015 Memo on right of first refusal.docx',
  'Meeting request - new matter.eml',
  'Program Manager',
];
type Suggestion = { caseId:string; client:string; title:string; reference:string; reason:string };
type Recognition = { suggestion:Suggestion|null; alternatives:Suggestion[]; confidence:'high'|'low' };
type Notice = { windowTitle:string; appName:string; recognition:Recognition; seconds:number; at:string };

function Pill() {
  const [state,setState]=useState<State>();
  const [core,setCore]=useState<CoreState>();
  const [offline,setOffline]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [notice,setNotice]=useState<Notice|null>(null);
  const [recent,setRecent]=useState<{id:string;title:string}|null>(null);
  const [selectedCase,setSelectedCase]=useState('');
  const [dismissedQuestion,setDismissedQuestion]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [now,setNow]=useState(Date.now());
  const debounce=useRef<number|undefined>(undefined);
  const switching=useRef(false);
  const previous=useRef('');
  const dismissedSwitch=useRef(new Set<string>());
  const observed=useRef<{id:string;at:number}|null>(null);
  const coreRef=useRef<CoreState|undefined>(undefined);
  coreRef.current=core;
  const stateRef=useRef<State|undefined>(undefined);
  stateRef.current=state;
  const refresh=useCallback(async()=>{
    try {
      const [legacy,session,periods,questions]=await Promise.all([
        api.GET('/api/state'),api.GET('/api/sessions/active'),api.GET('/api/work-periods'),api.GET('/api/questions'),
      ]);
      if(legacy.error||session.error||periods.error||questions.error||!legacy.data) throw Error('State unavailable');
      setState(legacy.data);
      setCore({activeSession:session.data??null,sessions:[],periods:periods.data??[],questions:questions.data??[],sources:[],coverageGaps:[],billing:{invoices:[],lines:[],expenses:[]}});
      setOffline(false);
    } catch {setOffline(true);}
  },[]);
  useEffect(()=>{void refresh();const poll=window.setInterval(()=>{void refresh();setNow(Date.now());},5000);return()=>window.clearInterval(poll);},[refresh]);
  const active=core?.activeSession;
  const current=core?.periods.find(p=>p.sessionId===active?.id&&p.endedAt===null);
  const dayDate=current?.startedAt.slice(0,10)??active?.startedAt.slice(0,10);
  if(current&&observed.current?.id!==current.id)observed.current={id:current.id,at:Date.now()};
  const caseItem=state?.matter.find(m=>String(m.id)===current?.caseId);
  const owner=state?.client.find(c=>c.id===caseItem?.client_id);
  const setting=state?.setting[0];
  const pauseReason=active?'Desk pill:'+active.id:null;
  const openPause=state?.pause.find(p=>p.reason===pauseReason&&p.end_time===null);
  const paused=!!active&&!!openPause;
  const pending=(core?.periods.filter(p=>p.sessionId===active?.id&&p.startedAt.slice(0,10)===dayDate&&!p.excluded&&(!p.timeValidated||!p.caseId))??[])
    .sort((a,b)=>{
      const readyA=!!a.caseId&&effectiveMs(a)!==null,readyB=!!b.caseId&&effectiveMs(b)!==null;
      return Number(readyB)-Number(readyA)||(readyA&&readyB?(effectiveMs(a)!-effectiveMs(b)!):a.startedAt.localeCompare(b.startedAt));
    });
  const readyPending=pending.filter(p=>p.caseId&&effectiveMs(p)!==null);
  const question=core?.questions.find(q=>q.sessionId===active?.id&&q.status==='pending');
  const questionPeriod=core?.periods.find(p=>p.id===question?.periodId);
  const showQuestion=!!question&&!!questionPeriod&&!questionPeriod.excluded;
  const showQuestionNotice=showQuestion&&!!setting?.notifications&&question?.questionId!==dismissedQuestion;
  const clockStart=current?(tauri?Date.parse(current.startedAt):(observed.current?.at??now)):null;
  const pausedMs=clockStart===null?0:(state?.pause??[]).filter(p=>p.reason===pauseReason).reduce((total,p)=>{
    const parsePause=(time:string)=>Date.parse(p.date+'T'+(time.length===5?time+':00':time)+'Z');
    const from=parsePause(p.start_time);
    let to=p.end_time?parsePause(p.end_time):now;
    if(to<from)to+=86400000;
    return total+Math.max(0,Math.min(now,to)-Math.max(clockStart,from));
  },0);
  const liveElapsed=clockStart===null?null:Math.max(0,now-clockStart-pausedMs);
  const periodMs=current ? effectiveMs(current)??liveElapsed : null;
  const hourlyRate=state&&caseItem?configuredRate(state,caseItem.id):null;
  const amount=periodMs!==null&&hourlyRate&&hourlyRate.origin!=='flat_fee' ? money(Math.round(periodMs*hourlyRate.rateCents/3600000)) : '—';
  const barValue=setting?.pill_display==='time'?(current?formatPreciseDuration(periodMs):'—'):amount;
  const day=dayDate?core?.periods.filter(p=>p.startedAt.startsWith(dayDate)&&!p.excluded)??[]:[];
  const pricedDay=day.map(period=>period.id===current?.id&&periodMs!==null?{...period,durationOverrideMs:periodMs}:period);
  const todayAmount=state&&core?money(dayFees(state,core,pricedDay)):'—';
  useEffect(()=>{if(tauri&&setting)void getCurrentWindow().setAlwaysOnTop(setting.pill_always_on_top).catch(()=>setError('Unable to set pill position.'));},[setting?.pill_always_on_top]);
  useEffect(()=>{if(tauri&&state)void invoke('set_watch_enabled',{enabled:!paused}).catch(()=>setError('Unable to apply file-switch pause.'));},[!!state,paused,active?.id]);
  useEffect(()=>{
    if(!tauri)return;
    const content=[...document.querySelectorAll<HTMLElement>('.pill-panel,.pill-notice')];
    let frame=0;
    const resize=()=>{
      window.cancelAnimationFrame(frame);
      frame=window.requestAnimationFrame(()=>{
        const contentHeight=Math.max(58,...content.map(element=>Math.ceil(element.offsetTop+element.offsetHeight+8)));
        void invoke('set_pill_expanded',{expanded,notification:!!notice||!!recent||(!expanded&&showQuestionNotice),contentHeight})
          .catch(()=>setError('Unable to resize the pill.'));
      });
    };
    const observer=new ResizeObserver(resize);
    content.forEach(element=>observer.observe(element));
    resize();
    return()=>{observer.disconnect();window.cancelAnimationFrame(frame);};
  },[expanded,notice,recent,showQuestionNotice]);
  const showSwitch=useCallback(async(windowTitle:string,appName:string)=>{
    if(!coreRef.current?.activeSession||!windowTitle.trim()||!appName.trim()||previous.current===appName+':'+windowTitle)return;
    previous.current=appName+':'+windowTitle;
    try {
      const result=await api.POST('/api/recognize',{body:{windowTitle,appName}});
      if(result.error||!result.data)throw Error('Unable to recognize this file.');
      if(!result.data.suggestion&&!/\.[a-z0-9]{1,8}(?=\s|$|[-—])/i.test(windowTitle))return;
      const currentCore=coreRef.current;
      const latest=currentCore?.periods.filter(p=>p.sessionId===currentCore.activeSession?.id).map(p=>p.endedAt??p.startedAt).sort().at(-1);
      const at=!tauri&&latest?new Date(Date.parse(latest)+60000).toISOString():new Date().toISOString();
      setNotice({windowTitle,appName,recognition:result.data,seconds:20,at});
      setRecent(null);setSelectedCase('');setExpanded(false);setError('');
    }catch(error){previous.current='';setError(String(error));}
  },[]);
  const dismiss=useCallback(()=>{
    if(notice&&switching.current)dismissedSwitch.current.add(notice.appName+':'+notice.windowTitle+':'+notice.at);
    setNotice(null);setRecent(null);setExpanded(false);setSelectedCase('');
    // Keep a pending question in the panel/My day without immediately reopening its popup.
    if(question?.questionId)setDismissedQuestion(question.questionId);
  },[notice,question?.questionId]);
  useEffect(()=>{
    const onEscape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&(notice||recent||showQuestionNotice||expanded)){
        event.preventDefault();dismiss();
      }
    };
    window.addEventListener('keydown',onEscape);
    return()=>window.removeEventListener('keydown',onEscape);
  },[notice,recent,showQuestionNotice,expanded,dismiss]);
  useEffect(()=>{
    if(!tauri)return;
    let unlisten:(()=>void)|undefined,cancelled=false;
    void listen<{windowTitle:string;appName:string}>('active-window-changed',event=>{
      window.clearTimeout(debounce.current);
      debounce.current=window.setTimeout(()=>void showSwitch(event.payload.windowTitle,event.payload.appName),3000);
    }).then(stop=>{if(cancelled)stop();else unlisten=stop;});
    return()=>{cancelled=true;unlisten?.();window.clearTimeout(debounce.current);};
  },[showSwitch]);
  const switchTo=useCallback(async(target:Notice,caseId:string|null)=>{
    if(switching.current)return;
    switching.current=true;
    setBusy(true);
    try {
      const response=await api.POST('/api/periods/switch',{body:{caseId,windowTitle:target.windowTitle,appName:target.appName,at:target.at,notClientWork:caseId===null}});
      if(response.error||response.response.status!==200||!response.data||!('id' in response.data))throw Error('Unable to record the file switch.');
      const acceptedTitle=caseId===null?'Not client work':stateRef.current?.matter.find(item=>String(item.id)===caseId)?.title??target.recognition.suggestion?.title??'Which case?';
      if(!dismissedSwitch.current.has(target.appName+':'+target.windowTitle+':'+target.at))
        setRecent({id:response.data.id,title:acceptedTitle});
      setNotice(null);await refresh();
    }catch(error){setError(String(error));}
    finally{dismissedSwitch.current.delete(target.appName+':'+target.windowTitle+':'+target.at);switching.current=false;setBusy(false);}
  },[refresh]);
  useEffect(()=>{
    if(!notice||notice.recognition.confidence!=='high'||!notice.recognition.suggestion||selectedCase)return;
    const timer=window.setInterval(()=>setNotice(value=>value?{...value,seconds:Math.max(0,value.seconds-1)}:null),1000);
    return()=>window.clearInterval(timer);
  },[notice?.windowTitle,notice?.recognition.confidence,selectedCase]);
  useEffect(()=>{if(notice?.seconds===0&&notice.recognition.confidence==='high'&&notice.recognition.suggestion&&!selectedCase)void switchTo(notice,notice.recognition.suggestion.caseId);},[notice?.seconds,selectedCase]);
  const validate=async(periods:Period[])=>{
    setBusy(true);
    try {for(const period of periods.filter(p=>p.caseId)){
      const response=await api.POST('/api/work-periods/{id}/validate-time',{params:{path:{id:period.id}},body:{}});
      if(response.error||response.response.status!==200)throw Error('A case and duration are required before validation.');
    }await refresh();}catch(error){setError(String(error));}finally{setBusy(false);}
  };
  const assign=async(periodId:string,caseId:string)=>{
    const period=core?.periods.find(p=>p.id===periodId);
    if(!period)return;
    setBusy(true);
    try {
      const targetQuestion=core?.questions.find(q=>q.periodId===periodId&&q.status==='pending');
      const response=targetQuestion ? await api.POST('/api/questions/answer',{body:{questionId:targetQuestion.questionId,
        sessionId:targetQuestion.sessionId,periodId,expectedAssignmentRevision:targetQuestion.expectedAssignmentRevision,
        caseId,responseCommandId:crypto.randomUUID()}}) : await api.POST('/api/work-periods/{id}/assignment',{params:{path:{id:periodId}},
        body:{caseId,expectedAssignmentRevision:period.assignmentRevision,origin:'lawyer'}});
      if(response.error)throw Error('Unable to assign this case.');
      setSelectedCase('');await refresh();
    }catch(error){setError(String(error));}finally{setBusy(false);}
  };
  const excludeQuestion=async()=>{
    if(!questionPeriod)return;
    setBusy(true);
    try {
      const response=await api.PATCH('/api/work-periods/{id}/details',{params:{path:{id:questionPeriod.id}},body:{excluded:true}});
      if(response.error)throw Error('Unable to leave this period out.');
      setSelectedCase('');await refresh();
    }catch(error){setError(String(error));}finally{setBusy(false);}
  };
  const setPause=async()=>{
    if(!state||!active)return;
    setBusy(true);
    try {
      const open=state.pause.find(p=>p.reason===pauseReason&&p.end_time===null);
      const instant=new Date().toISOString(),time=instant.slice(11,19);
      const response=open?await api.PATCH('/api/pauses/{id}',{params:{path:{id:open.id}},body:{end_time:time}}):
        await api.POST('/api/pauses',{body:{date:instant.slice(0,10),start_time:time,reason:pauseReason??'Desk pill'}});
      if(response.error)throw Error('Unable to change pause state.');await refresh();
    }catch(error){setError(String(error));}finally{setBusy(false);}
  };
  const openDay=()=>{if(tauri)void invoke('open_my_day').catch(()=>setError('Unable to open TimeKeeper.'));else window.open('/','_blank');};
  const openCases=state?.matter.filter(m=>m.status==='open')??[];
  return <main className="pill-root">
    <button className={'pill-bar '+(offline?'offline':'')} onClick={()=>offline?void refresh():notice||recent||showQuestionNotice?dismiss():setExpanded(!expanded)} aria-expanded={expanded} aria-label={offline?'TimeKeeper disconnected, retry':'TimeKeeper, toggle panel'}>
      <span className="pill-mark"><Logo compact wordmark={false}/></span>
      {offline?<><span className="pill-who">TimeKeeper is not running</span><span className="pill-retry">Retry</span></>:<>
        <span className={'pill-rec '+(paused||!active?'paused':'')}/><span className="pill-who" title={owner&&caseItem?owner.name+' · '+caseItem.title:undefined}>{paused?'Paused':caseItem?.title??(active?'Which case?':'No active session')}</span>
        {setting?.pill_display!=='case'&&barValue!=='—'&&<strong className="pill-amount">{barValue}</strong>}
        {pending.length>0&&<span className="pill-badge" aria-label={pending.length+' periods to validate'}>{pending.length}</span>}
        <span className="pill-chevron" aria-hidden="true">⌄</span></>}
    </button>
    {expanded&&!offline&&<section className="pill-panel" aria-label="TimeKeeper panel">
      <header><div className="pill-heading"><strong>{caseItem?.title??(active?'Which case?':'No active session')}</strong><span>{caseItem?.reference??''}</span></div>
        <small>{owner?.name??'Unassigned'}{hourlyRate&&hourlyRate.origin!=='flat_fee'?' · '+hourlyRate.origin.replace('_',' ')+' rate '+rate(hourlyRate.rateCents):''}</small>
        <small>Session since {active?.startedAt.slice(11,16)??'—'} · this period since {current?.startedAt.slice(11,16)??'—'}</small></header>
      <div className="pill-kpis"><div><small>This period</small><strong>{formatPreciseDuration(periodMs)}</strong></div><div><small>Amount</small><strong>{amount}</strong></div><div><small>Today</small><strong>{todayAmount}</strong></div></div>
      <div className="pill-review"><div className="pill-row"><small>To validate · {pending.length}</small></div>
        {pending.slice(0,2).map(period=><div className="pill-row" key={period.id}><div><strong>{period.label||state?.matter.find(m=>String(m.id)===period.caseId)?.title||'Which case?'}</strong>
          <small>{period.startedAt.slice(11,16)}–{period.endedAt?.slice(11,16)??'…'} · {formatPreciseDuration(effectiveMs(period))}</small></div>
          {period.caseId&&<button className="pill-button action" disabled={busy||effectiveMs(period)===null} title={effectiveMs(period)===null?'Add a duration in My day before validation':undefined} onClick={()=>void validate([period])}>Validate</button>}</div>)}
        {(pending.length>2||readyPending.length>0)&&<div className="pill-row"><small>{pending.length>2?'+ '+(pending.length-2)+' more':pending.length-readyPending.length>0?(pending.length-readyPending.length)+' need case or duration':''}</small>
          {readyPending.length>0&&<button className="pill-button action" disabled={busy} title={pending.length>readyPending.length?(pending.length-readyPending.length)+' periods still need a case or duration':undefined} onClick={()=>void validate(readyPending)}>Validate all {readyPending.length}</button>}</div>}
      </div>
      {showQuestion&&<div className="pill-question"><strong>Which case was this? · {questionPeriod?.label}</strong><select aria-label="Choose a case for this period" value={selectedCase} onChange={event=>setSelectedCase(event.target.value)}><option value="">Choose a case</option>{openCases.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><button className="pill-button action" disabled={!selectedCase||busy} onClick={()=>void assign(questionPeriod!.id,selectedCase)}>Answer</button><button className="pill-button" disabled={busy} onClick={()=>void excludeQuestion()}>Not client work</button></div>}
      <footer><button className="pill-button" disabled={!active||busy} onClick={()=>void setPause()}>{paused?'Resume':'Pause'}</button><select aria-label="Change case" value="" disabled={!current||busy} onChange={event=>void assign(current!.id,event.target.value)}><option value="">Change case</option>{openCases.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><button className="pill-button" onClick={openDay}>Open TimeKeeper</button></footer>
    </section>}
    {notice&&!offline&&<section className="pill-notice" role="status" aria-label="File switch suggestion"><button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>×</button><span className="pill-note-icon">!</span><div className="pill-note-body"><strong>Switched to {notice.windowTitle}</strong>
      <small>{notice.recognition.suggestion?notice.recognition.suggestion.title+'? · '+notice.recognition.suggestion.reason:'Which case is this?'}</small>
      <div className="pill-note-actions"><button className="pill-button action" disabled={!notice.recognition.suggestion||busy} onClick={()=>void switchTo(notice,notice.recognition.suggestion?.caseId??null)}>Confirm{notice.recognition.confidence==='high'?' · '+notice.seconds+'s':''}</button>
        <select aria-label="Other case" value={selectedCase} onChange={event=>setSelectedCase(event.target.value)}><option value="">Choose a case…</option>{[...notice.recognition.alternatives,...openCases.filter(item=>!notice.recognition.alternatives.some(alt=>alt.caseId===String(item.id))).map(item=>({caseId:String(item.id),title:item.title}))].map(item=><option key={item.caseId} value={item.caseId}>{item.title}</option>)}</select>
        <button className="pill-button" disabled={!selectedCase||busy} onClick={()=>void switchTo(notice,selectedCase)}>Use case</button></div>
      <div className="pill-note-actions"><button className="pill-button text" disabled={busy} onClick={()=>void switchTo(notice,null)}>Not client work</button><button className="pill-button text" onClick={dismiss}>Later</button></div></div></section>}
    {recent&&!notice&&!expanded&&!offline&&<section className="pill-notice" role="status" aria-label="New work period"><button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>×</button><span className="pill-note-icon"><Logo compact wordmark={false}/></span><div className="pill-note-body"><strong>New period recognized</strong>
      <small>{recent.title} · review the new period in My day</small><div className="pill-note-actions"><button className="pill-button action" onClick={openDay}>Open TimeKeeper</button><button className="pill-button" onClick={()=>{setRecent(null);setExpanded(true);}}>Change case</button><button className="pill-button text" onClick={dismiss}>Later</button></div></div></section>}
    {showQuestionNotice&&!notice&&!recent&&!expanded&&!offline&&<section className="pill-notice" role="status" aria-label="Which case"><button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>×</button><span className="pill-note-icon">!</span><div className="pill-note-body"><strong>Which case was this?</strong>
      <small>{questionPeriod?.startedAt.slice(11,16)}–{questionPeriod?.endedAt?.slice(11,16)??'…'} · {questionPeriod?.label}</small>
      <div className="pill-note-actions"><select aria-label="Choose a case for this period" value={selectedCase} onChange={event=>setSelectedCase(event.target.value)}><option value="">Choose a case</option>{openCases.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><button className="pill-button action" disabled={!selectedCase||busy} onClick={()=>void assign(questionPeriod!.id,selectedCase)}>Answer</button></div>
      <div className="pill-note-actions"><button className="pill-button text" disabled={busy} onClick={()=>void excludeQuestion()}>Not client work</button><button className="pill-button text" onClick={dismiss}>Later</button></div></div></section>}
    {!tauri&&<label className="pill-simulate">Simulate file switch<select aria-label="Simulate file switch" value="" onChange={event=>void showSwitch(event.target.value,'Demo documents')}><option value="">Choose a demo document</option>{demoDocuments.map(file=><option key={file} value={file}>{file==='Program Manager'?'Program Manager (non-document)':file}</option>)}</select></label>}
    {error&&<p className="pill-error" role="alert">{error}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Pill/>);
