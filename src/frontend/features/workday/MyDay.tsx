import { useEffect, useState } from 'react';
import { api, client, matter, money, today, type Recognition, type ScreenProps } from '../../api/client';
import { configuredRate, dayFees, effectiveMs, formatPreciseDuration, formatRoundedMinutes, hasCoverageGap, summarizeWork } from '../../calculations/billing';
import { MatterSelect } from '../../shared/components/MatterSelect';
import { Kpi } from '../../shared/components/Kpi';
import { Icon } from '../../shared/components/Icon';
import { MatterReference } from '../../shared/components/MatterReference';

type Filter = 'all'|'review'|'validated'|'left';
export function MyDay({s,core,action,source,refresh}:ScreenProps) {
  const [filter,setFilter]=useState<Filter>('all');
  const [editing,setEditing]=useState<string|null>(null);
  const [minutes,setMinutes]=useState('');
  const [manual,setManual]=useState(false);
  const [manualCase,setManualCase]=useState(s.matter[0]?.id ?? 1);
  const [manualTask,setManualTask]=useState(s.task.find(t=>t.off_screen)?.id ?? s.task[0]?.id ?? 1);
  const [manualMinutes,setManualMinutes]=useState('60');
  const [manualLabel,setManualLabel]=useState('Case management hearing');
  const [answerCase,setAnswerCase]=useState<number|null>(null);
  const [suggestions,setSuggestions]=useState<Record<string,Recognition>>({});
  const all=core.periods.filter(p=>p.startedAt.startsWith(today)).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  const included=all.filter(p=>!p.excluded);
  const excluded=all.filter(p=>p.excluded);
  const review=included.filter(p=>!p.timeValidated || !p.caseId);
  const validated=included.filter(p=>p.timeValidated && p.caseId);
  const shown=filter==='review'?review:filter==='validated'?validated:included;
  const summary=summarizeWork(included,core.sources);
  const coverageGaps=core.coverageGaps.filter(gap=>gap.startedAt.startsWith(today));
  const tableRows=[...shown.map(period=>({kind:'period' as const,startedAt:period.startedAt,period})),
    ...(filter==='all'?coverageGaps.map(gap=>({kind:'gap' as const,startedAt:gap.startedAt,gap})):[])].sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  const fees=dayFees(s,core,included);
  const unresolved=included.filter(p=>!p.caseId);
  useEffect(()=>{
    let alive=true;
    Promise.all(unresolved.map(async period=>{
      const old=s.time_entry.find(entry=>String(entry.id)===period.id);
      if(!old?.block_id) return null;
      const result=(await api.GET('/api/blocks/{id}/recognition',{params:{path:{id:old.block_id}}})).data;
      return result ? [period.id,result] as const : null;
    })).then(items=>{if(alive) setSuggestions(Object.fromEntries(items.filter(item=>item!==null) as Array<readonly [string,Recognition]>));});
    return ()=>{alive=false};
  },[unresolved.map(p=>p.id).join(','),s.time_entry]);
  const questionFor=(periodId:string)=>core.questions.find(q=>q.periodId===periodId && q.status==='pending');
  const assign=(periodId:string,caseId:number)=>{
    const period=core.periods.find(p=>p.id===periodId)!;
    const question=questionFor(periodId);
    if(question) return action(api.POST('/api/questions/answer',{body:{questionId:question.questionId,
      sessionId:question.sessionId,periodId,expectedAssignmentRevision:question.expectedAssignmentRevision,
      caseId:String(caseId),responseCommandId:crypto.randomUUID()}}));
    if(!period.caseId) return;
    return action(api.POST('/api/work-periods/{id}/assignment',{params:{path:{id:periodId}},body:{
      caseId:String(caseId),expectedAssignmentRevision:period.assignmentRevision,origin:'lawyer'}}));
  };
  const saveDuration=(periodId:string)=>{
    const parsed=Number(minutes);
    if(!Number.isFinite(parsed)||parsed<0) return;
    void action(api.POST('/api/work-periods/{id}/duration-override',{params:{path:{id:periodId}},body:{durationMs:Math.round(parsed*60000)}}));
    setEditing(null);
  };
  const tabs:[Filter,string,number][]=[['all','All',included.length],['review','To review',review.length],['validated','Validated',validated.length],['left','Left out',excluded.length]];
  return <>
    <div className="ph"><div className="t"><h1>My day</h1><p>Friday 16 October 2026 · session started from Screenpipe at 08:40. Review each period, then validate time and sources.</p></div>
      <div className="actions"><button className="btn" onClick={()=>setManual(true)}><Icon name="plus" small/>Off-screen time</button>
        <button className="btn primary" onClick={async()=>{for(const period of review.filter(p=>p.caseId)) await api.POST('/api/work-periods/{id}/validate-time',{params:{path:{id:period.id}},body:{}});await refresh();}}><Icon name="check" small/>Validate time for the day</button></div></div>
    <div className="grid4">
      <Kpi title="Time today" value={formatRoundedMinutes(summary.roundedMinutes)} detail="Precise durations summed, then rounded up"/>
      <Kpi title="Fees today" value={money(fees)} detail="Excl. VAT · calculated in the app"/>
      <Kpi title="Coverage" value={`${coverageGaps.length} gap${coverageGaps.length===1?'':'s'}`} detail={coverageGaps.length?`${coverageGaps[0]!.startedAt.slice(11,16)}–${coverageGaps[0]!.endedAt.slice(11,16)} · not counted`:'No recorded gaps'}/>
      <Kpi title="To validate" value={review.length} detail="Time and sources are reviewed separately"/>
    </div>
    {unresolved[0]&&<section className="card pad col"><h2><Icon name="alert" small/> Which case does this period belong to?</h2>
      <p>{unresolved[0].startedAt.slice(11,16)}–{unresolved[0].endedAt?.slice(11,16)} · {unresolved[0].demoApp} · {unresolved[0].demoWindowTitle}. Your answer applies to this period only, even after you move to another case.</p>
      <div className="row"><MatterSelect s={s} value={answerCase} allowEmpty onChange={setAnswerCase}/><button className="btn primary" disabled={!answerCase} onClick={()=>{if(answerCase)void assign(unresolved[0]!.id,answerCase)}}>Answer</button>
        <button className="btn" onClick={()=>action(api.PATCH('/api/work-periods/{id}/details',{params:{path:{id:unresolved[0]!.id}},body:{excluded:true}}))}>Not client work</button>
        <span className="small muted">The suggestion is only an aid. No case is created automatically.</span></div>
    </section>}
    <section className="card"><div className="toolbar"><div className="seg" role="group" aria-label="Work periods filter">
      {tabs.map(([key,title,count])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{title}<span className="c">{count}</span></button>)}
    </div></div>
    {filter==='left'?<div className="tbl"><table><thead><tr><th>Time</th><th>Application</th><th>Work observed</th><th className="r">Duration</th><th/></tr></thead><tbody>
      {excluded.map(period=><tr key={period.id}><td className="num">{period.startedAt.slice(11,16)}–{period.endedAt?.slice(11,16) ?? '…'}</td><td>{period.demoApp ?? '—'}</td>
        <td>{period.demoWindowTitle ?? period.label}</td><td className="r num">{formatPreciseDuration(effectiveMs(period))}</td><td><button className="btn sm" onClick={()=>action(api.PATCH('/api/work-periods/{id}/details',{params:{path:{id:period.id}},body:{excluded:false}}))}>Count as work</button></td></tr>)}
    </tbody></table>{!excluded.length&&<div className="empty"><b>No periods left out</b></div>}</div>
    :<div className="tbl"><table><thead><tr><th>Period</th><th>Client · case</th><th>Work performed</th><th className="r">Duration</th><th className="r">Amount</th><th>Time</th><th>Sources</th><th>Billing</th><th/></tr></thead><tbody>
      {tableRows.map(row=>{
        if(row.kind==='gap') return <tr key={row.gap.id}><td className="num muted">{row.gap.startedAt.slice(11,16)}–{row.gap.endedAt.slice(11,16)}</td><td colSpan={8}><span className="flag"><Icon name="alert" small/>Coverage gap</span> <span className="muted">· no recording for this interval. Not counted as work or idle time.</span></td></tr>;
        const period=row.period;
        const caseId=period.caseId?Number(period.caseId):null;
        const item=matter(s,caseId),owner=client(s,caseId);
        const linked=core.sources.filter(e=>e.workPeriodId===period.id);
        const validatedSources=linked.filter(e=>e.validationStatus==='validated').length;
        const gap=hasCoverageGap(period,core.sources);
        const q=questionFor(period.id),candidate=suggestions[period.id]?.candidates[0],suggestion=candidate?matter(s,candidate.matter_id):undefined;
        const rate=item?configuredRate(s,item.id):{rateCents:s.firm[0]?.base_rate_cents??0,origin:'base' as const};
        const appliedRate=period.billingStatus==='billed' ? period.appliedHourlyRateCents ?? rate.rateCents : rate.rateCents;
        const estimate=effectiveMs(period)===null?null:Math.round(effectiveMs(period)!*appliedRate/3600000);
        return <tr key={period.id}>
          <td className="num">{period.startedAt.slice(11,16)}–{period.endedAt?.slice(11,16) ?? '…'}<span className="sub">{period.demoApp ?? 'Off-screen'}</span></td>
          <td>{item?<>{owner?.name}<span className="sub">{item.title} · <MatterReference value={item.reference}/></span></>:<>
            <span className="flag"><Icon name="alert" small/>Case answer needed</span>
            {q&&<span className="sub">Question {q.questionId} · period {period.id}</span>}
            {suggestion&&<span className="sub suggest">Suggested: {suggestion.title} · {Math.round(candidate!.score*100)}% <button className="link" onClick={()=>assign(period.id,suggestion.id)}>Assign</button></span>}
            <MatterSelect s={s} value={null} allowEmpty onChange={id=>{if(id) void assign(period.id,id)}}/>
          </>}</td>
          <td className="wrap">{period.label}<span className="sub">{s.task.find(t=>t.id===period.taskTypeId)?.label ?? 'Work period'} · {period.billable?'Billable':period.nonbillableReason ?? 'Non-billable'}</span></td>
          <td className="r num">{editing===period.id?<span className="row"><input className="field" type="number" min="0" step="0.001" aria-label="Corrected minutes" value={minutes} onChange={event=>setMinutes(event.target.value)}/><button className="btn sm primary" onClick={()=>saveDuration(period.id)}>Save</button></span>:formatPreciseDuration(effectiveMs(period))}
            <span className="sub">Detected: {formatPreciseDuration(period.detectedDurationMs)}{period.durationOverrideMs!==null?' · corrected':''}</span></td>
          <td className="r num">{period.billable&&rate.origin!=='flat_fee'&&estimate!==null?money(estimate):rate.origin==='flat_fee'?'Flat fee':'—'}</td>
          <td><span className={period.timeValidated?'ok':'flag'}>{period.timeValidated?'Time validated':'Time to validate'}</span>
          </td><td>{linked.length?`${validatedSources}/${linked.length} validated`:'No source'}{linked.some(e=>e.availabilityStatus==='unavailable')&&<span className="sub flag">Unavailable</span>}{gap&&<span className="sub flag">Coverage incomplete</span>}</td>
          <td>{period.billingStatus==='billed'?'Billed':'Unbilled'}</td>
          <td><div className="rowact"><button className="iconbtn" aria-label="Correct duration" title="Correct duration" disabled={period.billingStatus==='billed'} onClick={()=>{setEditing(period.id);setMinutes(String((effectiveMs(period)??0)/60000))}}><Icon name="edit"/></button>
            <button className="iconbtn" aria-label="Validate time" title="Validate time" disabled={!period.caseId||period.timeValidated} onClick={()=>action(api.POST('/api/work-periods/{id}/validate-time',{params:{path:{id:period.id}},body:{}}))}><Icon name="check"/></button>
            {linked.length>0&&<button className="iconbtn" aria-label="View source" title="View source" onClick={()=>source(period.id)}><Icon name="eye"/></button>}
            <button className="btn sm" disabled={period.invoiceId!==null || (period.billingStatus==='unbilled'&&!period.timeValidated)} onClick={()=>action(api.POST('/api/work-periods/{id}/billing-status',{params:{path:{id:period.id}},body:{status:period.billingStatus==='billed'?'unbilled':'billed'}}))}>{period.billingStatus==='billed'?'Unbill':'Mark billed'}</button>
          </div></td>
        </tr>;
      })}</tbody></table><div className="card-b muted" style={{borderTop:'1px solid var(--line)',fontSize:12}}>Line amounts use precise durations. Group totals add precise durations first, then round up to the minute once.</div>{!shown.length&&<div className="empty"><b>No periods in this view</b></div>}</div>}
    </section>
    {manual&&<div className="modal-back"><form className="modal glass pad col" onSubmit={event=>{
      event.preventDefault();if(!core.activeSession) return;
      const durationMs=Math.round(Number(manualMinutes)*60000);
      if(!Number.isSafeInteger(durationMs)||durationMs<0)return;
      const start=`${today}T17:${String(core.periods.filter(p=>p.startedAt.startsWith(`${today}T17:`)).length).padStart(2,'0')}:00Z`;
      void action(api.POST('/api/work-periods/manual',{body:{sessionId:core.activeSession.id,caseId:String(manualCase),startedAt:start,durationMs,taskTypeId:manualTask,label:manualLabel}}));
      setManual(false);
    }}><h2>Add off-screen time</h2><p>This creates a manual period without a source. Validate its time separately.</p>
      <label>Case <MatterSelect s={s} value={manualCase} onChange={id=>{if(id)setManualCase(id)}}/></label>
      <label>Task <select className="field" value={manualTask} onChange={event=>setManualTask(Number(event.target.value))}>{s.task.filter(t=>t.off_screen).map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
      <label>Minutes <input className="field" type="number" min="0" step="0.001" value={manualMinutes} onChange={event=>setManualMinutes(event.target.value)}/></label>
      <label>Label <input className="field" value={manualLabel} onChange={event=>setManualLabel(event.target.value)}/></label>
      <div className="row"><button className="btn primary" disabled={!core.activeSession}>Add</button><button type="button" className="btn" onClick={()=>setManual(false)}>Cancel</button></div>
    </form></div>}
  </>;
}
