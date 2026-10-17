import { useState } from 'react';
import { api, client, matter, money, today, type ScreenProps } from '../../api/client';
import { configuredRate, effectiveMs, formatPreciseDuration, summarizeWork } from '../../calculations/billing';
import { Card } from '../../shared/components/Card';
import { MatterSelect } from '../../shared/components/MatterSelect';
import { Kpi } from '../../shared/components/Kpi';
import { MatterReference } from '../../shared/components/MatterReference';

export function Desk({s,core,action,navigate}:ScreenProps) {
  const [open,setOpen]=useState(false);
  const session=core.activeSession;
  const period=core.periods.find(p=>p.sessionId===session?.id && p.endedAt===null);
  const caseId=period?.caseId ? Number(period.caseId) : null;
  const activeCase=matter(s,caseId);
  const owner=client(s,caseId);
  const duration=period ? formatPreciseDuration(effectiveMs(period)) : 'Unknown';
  const day=core.periods.filter(p=>p.startedAt.startsWith(today)&&!p.excluded);
  const dayDuration=summarizeWork(day,core.sources);
  const rate=caseId ? configuredRate(s,caseId) : null;
  const currentAmount=period && rate && rate.origin!=='flat_fee' && effectiveMs(period)!==null
    ? Math.round(effectiveMs(period)!*rate.rateCents/3600000) : null;
  return <>
    <div className="row between"><div><span className="eyebrow">Lawyer desk · fictional demo</span><h1>The TimeKeeper pill</h1></div>
      <span className="small muted">Session and period state come from the application API.</span></div>
    <div className="desk"><div className="docwin"><div className="row between dochead"><span>{period?.demoWindowTitle ?? 'No active period'}</span>
      <span className="num">{session?.startedAt.slice(11,16) ?? '—'}</span></div><div className="docpage"><h2>{period?.label ?? 'Waiting for a work period'}</h2>
      <p>{period?.demoWindowTitle ?? 'Recorded observations appear here when available.'}</p></div></div>
      <button className="pastille" aria-expanded={open} onClick={()=>setOpen(!open)}><span className="mini-logo">T</span><span className="dot"/>
        <span>{owner?.name ?? 'No case'}</span><span className="num">{duration}</span></button>
      {open&&<div className="float glass pad col"><div className="row between"><b><MatterReference value={activeCase?.reference ?? ''}/> {activeCase?.title ?? 'Case answer needed'}</b>
        <span className="tiny muted">{session ? `Session since ${session.startedAt.slice(11,16)}` : 'No active session'}</span></div>
        <span className="small muted">{period ? `This period since ${period.startedAt.slice(11,16)}` : 'Waiting for a period'} · {duration}</span>
        <div className="grid2"><Kpi title="This period" value={currentAmount===null?'—':money(currentAmount)}/>
          <Kpi title="Today" value={`${dayDuration.roundedMinutes} min`} dark/></div>
        {period&&<label className="col">Other case <MatterSelect s={s} value={caseId} onChange={value=>{
          if(value)void action(api.POST('/api/work-periods/{id}/assignment',{params:{path:{id:period.id}},body:{
            caseId:String(value),expectedAssignmentRevision:period.assignmentRevision,origin:'lawyer'}}));
        }}/></label>}
        <button className="btn primary" onClick={()=>navigate('myDay')}>Open my day</button></div>}
    </div>
    <Card><span className="small muted">Closing the desktop window leaves the session active. Screenpipe commands start and end it.</span></Card>
  </>;
}
