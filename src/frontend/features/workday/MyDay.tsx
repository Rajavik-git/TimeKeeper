import { useEffect, useState } from 'react';
import { api, client, matter, money, today, type Recognition, type ScreenProps } from '../../api/client';
import { configuredRate, dayFees, effectiveMs, formatPreciseDuration, formatRoundedMinutes, hasCoverageGap, summarizeWork } from '../../calculations/billing';
import { MatterSelect } from '../../shared/components/MatterSelect';
import { Kpi } from '../../shared/components/Kpi';
import { Icon } from '../../shared/components/Icon';
import { MatterReference } from '../../shared/components/MatterReference';
import { longDate, percent } from '../../shared/format';

type Filter = 'all'|'review'|'validated'|'left';
export function MyDay({s,core,action,source,refresh}:ScreenProps) {
  const [filter,setFilter]=useState<Filter>('all');
  const [editing,setEditing]=useState<string|null>(null);
  const [minutes,setMinutes]=useState('');
  const [manual,setManual]=useState(false);
  const [menuOpen,setMenuOpen]=useState<string|null>(null);
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
  const recognized=review.filter(p=>p.caseId);
  const notRecordedMs=coverageGaps.reduce((total,gap)=>total+Math.max(0,Date.parse(gap.endedAt)-Date.parse(gap.startedAt)),0);
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
  const tabs:[Filter,string,number][]=[['all','All',included.length],['review','To validate',review.length],['validated','Validated',validated.length],['left','Left out',excluded.length]];
  return <>
    <div className="ph"><div className="t"><h1>My day</h1><p>{longDate(today)}</p></div>
      <div className="actions"><button className="btn" onClick={()=>setManual(true)}><Icon name="plus" small/>Add a hearing or meeting</button></div></div>
    <div className="grid4">
      <Kpi title="Time today" value={formatRoundedMinutes(summary.roundedMinutes)} detail="Worked and recorded"/>
      <Kpi title="Fees today" value={money(fees)} detail="Excl. VAT"/>
      <Kpi title="Not recorded" value={formatRoundedMinutes(Math.ceil(notRecordedMs/60000))} detail={coverageGaps.length?`${coverageGaps[0]!.startedAt.slice(11,16)}–${coverageGaps[0]!.endedAt.slice(11,16)} · not counted`:'No coverage gap'}/>
      <Kpi title="To validate" value={review.length} detail="Periods"/>
    </div>
    <div className="day-prompts">
      <section className="card day-ready"><h2>Your day is ready.</h2><p>TimeKeeper recognized {recognized.length} periods on their own. {unresolved.length ? `${unresolved.length} needs one answer from you.` : 'Nothing needs your answer.'} Check them below, then validate in one click.</p>
        <button className="btn primary" disabled={!recognized.length} onClick={async()=>{for(const period of recognized) await api.POST('/api/work-periods/{id}/validate-time',{params:{path:{id:period.id}},body:{}});await refresh();}}>Validate the {recognized.length} recognized periods</button>
      </section>
      <section className="card day-question"><h2><Icon name="alert" small/> Which case was this?</h2>
        {unresolved[0]?<><p>{unresolved[0].startedAt.slice(11,16)}–{unresolved[0].endedAt?.slice(11,16)} · {unresolved[0].demoWindowTitle ?? unresolved[0].label}</p>
          <div className="row"><MatterSelect s={s} value={answerCase} allowEmpty onChange={setAnswerCase}/><button className="btn primary" disabled={!answerCase} onClick={()=>{if(answerCase)void assign(unresolved[0]!.id,answerCase)}}>Answer</button>
            <button className="btn" onClick={()=>action(api.PATCH('/api/work-periods/{id}/details',{params:{path:{id:unresolved[0]!.id}},body:{excluded:true}}))}>Not client work</button></div></>
        :<p>Every period has a case. You can review the list below.</p>}
      </section>
    </div>
    <section className="card"><div className="toolbar"><div className="seg" role="group" aria-label="Work periods filter">
      {tabs.map(([key,title,count])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{title}<span className="c">{count}</span></button>)}
    </div></div>
    {filter==='left'?<div className="tbl"><table><thead><tr><th>Time</th><th>Application</th><th>Work observed</th><th className="r">Duration</th><th/></tr></thead><tbody>
      {excluded.map(period=><tr key={period.id}><td className="num">{period.startedAt.slice(11,16)}–{period.endedAt?.slice(11,16) ?? '…'}</td><td>{period.demoApp ?? '—'}</td>
        <td>{period.demoWindowTitle ?? period.label}</td><td className="r num">{formatPreciseDuration(effectiveMs(period))}</td><td><button className="btn sm" onClick={()=>action(api.PATCH('/api/work-periods/{id}/details',{params:{path:{id:period.id}},body:{excluded:false}}))}>Count as work</button></td></tr>)}
    </tbody></table>{!excluded.length&&<div className="empty"><b>No periods left out</b></div>}</div>
    :<div className="tbl day-table"><table><thead><tr><th>Period</th><th>Client · case</th><th>Work performed</th><th className="r">Duration</th><th className="r">Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {tableRows.map(row=>{
        if(row.kind==='gap') return <tr key={row.gap.id}><td className="num muted">{row.gap.startedAt.slice(11,16)}–{row.gap.endedAt.slice(11,16)}</td><td colSpan={6}><span className="flag"><Icon name="alert" small/>Coverage gap</span> <span className="muted">· not recorded or counted as work.</span></td></tr>;
        const period=row.period;
        const caseId=period.caseId?Number(period.caseId):null;
        const item=matter(s,caseId),owner=client(s,caseId);
        const linked=core.sources.filter(record=>record.workPeriodId===period.id);
        const validatedSources=linked.filter(record=>record.validationStatus==='validated').length;
        const candidate=suggestions[period.id]?.candidates[0],suggestion=candidate?matter(s,candidate.matter_id):undefined;
        const rate=item?configuredRate(s,item.id):{rateCents:s.firm[0]?.base_rate_cents??0,origin:'base' as const};
        const appliedRate=period.billingStatus==='billed' ? period.appliedHourlyRateCents ?? rate.rateCents : rate.rateCents;
        const estimate=effectiveMs(period)===null?null:Math.round(effectiveMs(period)!*appliedRate/3600000);
        return <tr key={period.id}>
          <td className="num">{period.startedAt.slice(11,16)}–{period.endedAt?.slice(11,16) ?? '…'}<span className="sub">{period.demoApp ?? 'Off-screen'}</span></td>
          <td>{item?<>{owner?.name}<span className="sub">{item.title} · <MatterReference value={item.reference}/></span></>:<><span className="flag"><Icon name="alert" small/>Unresolved</span><span className="sub">Answer above</span>{suggestion&&<span className="sub suggest">Suggested: {suggestion.title} · {percent(candidate!.score*100)} <button className="link" onClick={()=>assign(period.id,suggestion.id)}>Assign</button></span>}</>}</td>
          <td className="wrap">{period.label}<span className="sub">{s.task.find(task=>task.id===period.taskTypeId)?.label ?? 'Work period'} · {period.billable?'Billable':period.nonbillableReason ?? 'Not billable'}</span></td>
          <td className="r num">{editing===period.id?<span className="row"><input className="field" type="number" min="0" step="0.001" aria-label="Corrected minutes" value={minutes} onChange={event=>setMinutes(event.target.value)}/><button className="btn sm primary" onClick={()=>saveDuration(period.id)}>Save</button></span>:formatPreciseDuration(effectiveMs(period))}
            {period.durationOverrideMs!==null&&<span className="sub">was {formatPreciseDuration(period.detectedDurationMs)}</span>}</td>
          <td className="r num">{period.billable&&rate.origin!=='flat_fee'&&estimate!==null?money(estimate):rate.origin==='flat_fee'?'Flat fee':'—'}</td>
          <td><span className={period.timeValidated?'st ok':'st warn'}><i/>{period.timeValidated?'Validated':'To validate'}</span><span className="sub">{linked.length?`Sources ${validatedSources}/${linked.length}`:'No source'}{linked.some(record=>record.availabilityStatus==='unavailable')?' · unavailable':''}{hasCoverageGap(period,core.sources)?' · incomplete':''}</span></td>
          <td><div className="day-actions"><button className="btn sm primary" disabled={!period.caseId||period.timeValidated} onClick={()=>action(api.POST('/api/work-periods/{id}/validate-time',{params:{path:{id:period.id}},body:{}}))}>Validate</button>
            <button className="btn sm" disabled={!linked.length} onClick={()=>source(period.id)}>Sources</button>
            <div className="day-more"><button className="iconbtn" aria-label={`More actions for ${period.label}`} aria-expanded={menuOpen===period.id} onClick={()=>setMenuOpen(menuOpen===period.id?null:period.id)}><Icon name="more"/></button>
              {menuOpen===period.id&&<div className="row-menu"><button className="btn sm" disabled={period.billingStatus==='billed'} onClick={()=>{setEditing(period.id);setMinutes(String((effectiveMs(period)??0)/60000));setMenuOpen(null);}}>Correct duration</button>
                <button className="btn sm" disabled={period.invoiceId!==null||(period.billingStatus==='unbilled'&&!period.timeValidated)} onClick={()=>{void action(api.POST('/api/work-periods/{id}/billing-status',{params:{path:{id:period.id}},body:{status:period.billingStatus==='billed'?'unbilled':'billed'}}));setMenuOpen(null);}}>{period.billingStatus==='billed'?'Unbill':'Mark billed'}</button></div>}
            </div></div></td>
        </tr>;
      })}</tbody></table>{!shown.length&&<div className="empty"><b>No periods in this view</b></div>}</div>}
    </section>
    {manual&&<div className="modal-back"><form className="modal glass pad col" onSubmit={event=>{
      event.preventDefault();if(!core.activeSession) return;
      const durationMs=Math.round(Number(manualMinutes)*60000);
      if(!Number.isSafeInteger(durationMs)||durationMs<0)return;
      const start=`${today}T17:${String(core.periods.filter(p=>p.startedAt.startsWith(`${today}T17:`)).length).padStart(2,'0')}:00Z`;
      void action(api.POST('/api/work-periods/manual',{body:{sessionId:core.activeSession.id,caseId:String(manualCase),startedAt:start,durationMs,taskTypeId:manualTask,label:manualLabel}}));
      setManual(false);
    }}><h2>Add a hearing or meeting</h2><p>This creates a manual period without a source. Validate its time separately.</p>
      <label>Case <MatterSelect s={s} value={manualCase} onChange={id=>{if(id)setManualCase(id)}}/></label>
      <label>Task <select className="field" value={manualTask} onChange={event=>setManualTask(Number(event.target.value))}>{s.task.filter(t=>t.off_screen).map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
      <label>Minutes <input className="field" type="number" min="0" step="0.001" value={manualMinutes} onChange={event=>setManualMinutes(event.target.value)}/></label>
      <label>Label <input className="field" value={manualLabel} onChange={event=>setManualLabel(event.target.value)}/></label>
      <div className="row"><button className="btn primary" disabled={!core.activeSession}>Add</button><button type="button" className="btn" onClick={()=>setManual(false)}>Cancel</button></div>
    </form></div>}
  </>;
}
