import { useEffect, useState } from 'react';
import { api, shortDate, type ScreenProps, type State } from '../../api/client';
import { Card } from '../../shared/components/Card';
import { SourcePackDialog } from '../../shared/components/SourcePackDialog';
import { effectiveMs, formatPreciseDuration } from '../../calculations/billing';
import { auditDate } from '../../shared/format';

type Props=ScreenProps & {selected:string};
export function Source({s,core,selected,action,navigate}:Props) {
  const [clientId,setClientId]=useState('');
  const [caseId,setCaseId]=useState('');
  const [activity,setActivity]=useState<State>(s);
  const [picked,setPicked]=useState<number|null>(null);
  const [frame,setFrame]=useState(0);
  const [pack,setPack]=useState(false);
  const [preview,setPreview]=useState<{x:number;y:number;time:string;excerpt:string;kind:string}|null>(null);
  useEffect(()=>{let live=true; api.GET('/api/state',{params:{query:{clientId:clientId||undefined,caseId:caseId||undefined}}}).then(result=>{if(live&&result.data)setActivity(result.data)});return()=>{live=false}},[s,clientId,caseId]);
  const entries=activity.time_entry;
  const timelineBlock=(entry:typeof entries[number])=>{
    const recorded=activity.block.find(item=>item.id===entry.block_id);
    if(recorded)return recorded;
    const period=core.periods.find(item=>item.id===String(entry.id));
    if(!period)return null;
    return {id:-entry.id,start_time:period.startedAt.slice(11,16),end_time:period.endedAt?.slice(11,16)??'—',minutes:Math.max(1,Math.round((effectiveMs(period)??0)/60000)),window_title:period.label,overlaps_block_id:null};
  };
  const selectedEntry=entries.find(entry=>entry.id===picked)??entries.find(entry=>String(entry.id)===selected)??entries[0];
  const block=selectedEntry?timelineBlock(selectedEntry):null;
  const sources=activity.source.filter(item=>item.block_id===selectedEntry?.block_id && selectedEntry.block_id!==null);
  const source=sources[Math.min(frame,sources.length-1)];
  const period=core.periods.find(item=>item.id===String(selectedEntry?.id));
  const byDate=Object.entries(entries.reduce<Record<string,typeof entries>>((groups,entry)=>{(groups[entry.date]??=[]).push(entry);return groups},{})).sort(([a],[b])=>a.localeCompare(b));
  const audit=activity.audit_event.filter(event=>event.time_entry_id===selectedEntry?.id||event.block_id===block?.id);
  const marker=s.marker.find(m=>m.matter_id===selectedEntry?.matter_id && sources.some(x=>x.detected_marker===m.value));
  const owner=activity.client.find(c=>c.id===activity.matter.find(m=>m.id===selectedEntry?.matter_id)?.client_id);
  const matter=activity.matter.find(m=>m.id===selectedEntry?.matter_id);
  const recognized=marker&&matter ? `Recognized from ${matter.reference} (window title) and ${owner?.name} (screen ${source?.timestamp??'—'}).` : 'Case assignment follows the recorded observation.';
  return <>
    <div className="ph"><div className="t"><h1>Activity</h1><p>Recorded work and the observations behind each period.</p></div>
      <div className="actions activity-filters"><button className="btn" onClick={()=>navigate('myDay')}>Back to My day</button><select className="field" aria-label="Filter by client" value={clientId} onChange={event=>{setClientId(event.target.value);setCaseId('');setPicked(null)}}><option value="">All clients</option>{s.client.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="field" aria-label="Filter by case" value={caseId} onChange={event=>{setCaseId(event.target.value);setPicked(null)}}><option value="">{clientId?'All their cases':'All cases'}</option>{s.matter.filter(m=>!clientId||String(m.client_id)===clientId).map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select>
        <button className="btn" disabled={!selectedEntry?.matter_id} onClick={()=>setPack(true)}>Export source pack</button></div></div>
    <Card className="activity-timeline" style={{'--activity-days':byDate.length} as React.CSSProperties}><div className="row between"><h2>Timeline</h2><div className="activity-legend"><span className="legend-validated">Validated</span><span className="legend-pending">To validate</span><span>Not billable</span><span>No case</span></div></div>
      <div className="activity-timeline-body" style={{gridTemplateRows:`16px repeat(${byDate.length},minmax(0,1fr))`}}><div className="timeline-axis"><span/><div>{Array.from({length:12},(_,i)=><span key={i}>{8+i}h</span>)}</div></div>
      {byDate.map(([date,rows])=><div className="timeline-row" key={date}><b className="num small">{shortDate(date)}</b><div className="timeline-track">{rows.map(entry=>{
        const b=timelineBlock(entry);if(!b)return null;
        const d=activity.matter.find(x=>x.id===entry.matter_id),c=activity.client.find(x=>x.id===d?.client_id);
        const start=Number(b.start_time.slice(0,2))*60+Number(b.start_time.slice(3))-480;
        const width=Math.max(3,b.minutes/660*100);
        const label=byDate.length<=14?(width>18?`${c?.name.split(' ').at(-1)??''} · ${d?.title??''}`:width>10?d?.title:width>6?c?.name.split(' ').at(-1):d?.reference.split('-').slice(0,2).join('-')):'';
        const canonical=core.periods.find(p=>p.id===String(entry.id));
        const show=(x:number,y:number)=>{const source=activity.source.find(item=>item.block_id===entry.block_id && entry.block_id!==null);setPreview({x:Math.max(8,Math.min(window.innerWidth-300,x-140)),y:Math.max(8,y-150),time:b.start_time+'–'+b.end_time,excerpt:source?.excerpt??b.window_title,kind:source?.type==='audio'?'Call transcript':entry.block_id?'Screen capture':'Manual entry'})};
        return <button key={entry.id} style={{left:`${Math.max(0,start)/660*100}%`,width:`${width}%`}} className={`${b.overlaps_block_id?'overlap ':''}${!entry.matter_id?'no-case ':''}${!entry.billable?'not-billable ':canonical?.timeValidated||entry.review_status==='approved'?'validated ':'to-validate '}`} aria-pressed={entry.id===selectedEntry?.id} title={`${c?.name??'No case'} · ${d?.title??''} · ${b.start_time}–${b.end_time}`} onMouseMove={event=>show(event.clientX,event.clientY)} onMouseLeave={()=>setPreview(null)} onFocus={event=>{const box=event.currentTarget.getBoundingClientRect();show(box.left+box.width/2,box.top)}} onBlur={()=>setPreview(null)} onClick={()=>{setPicked(entry.id);setFrame(0);setPreview(null)}}>{label}</button>;
      })}</div></div>)}</div>
    </Card>
    {preview&&<div className="activity-preview glass" style={{left:preview.x,top:preview.y}} aria-hidden="true"><b>{preview.time} · {preview.kind}</b><p>{preview.excerpt}</p></div>}
    {selectedEntry&&block?<div className="activity-lower"><Card className="activity-detail"><div className="row between"><div><h2>{selectedEntry.label}</h2><p className="small muted">{owner?.name??'No case'} · {matter?.title??'Unassigned'} · {shortDate(selectedEntry.date)} · {block.start_time}–{block.end_time}</p></div><span>{formatPreciseDuration(period?effectiveMs(period):null)} · {period?.timeValidated?'Validated':'To validate'}</span></div>
      <div className="recognized-strip">{recognized}</div>
      <div className="activity-sources"><h3>Sources</h3>{sources.length?sources.map((item,index)=>{const canonical=core.sources.find(x=>x.id===String(item.id));return <div className="activity-source-row" key={item.id}><button className={`btn small ${frame===index?'primary':''}`} onClick={()=>setFrame(index)}>{item.timestamp} · {item.type==='audio'?'Call transcript':'Screen capture'}</button><span>{item.excerpt}</span><label className="row small"><input type="checkbox" checked={canonical?.validationStatus==='validated'} disabled={!canonical||canonical.validationStatus==='validated'} onChange={()=>{if(canonical)void action(api.POST('/api/sources/{instanceId}/{contentType}/{externalId}/validate',{params:{path:{instanceId:canonical.instanceId,contentType:canonical.contentType,externalId:canonical.externalId}},body:{}}))}}/>Source validated</label></div>}):<p>No recorded source for this period.</p>}</div></Card>
      <Card className="activity-audit"><h2>Audit trail</h2>{audit.map(item=><div className="audit-row" key={item.id}><span className="small muted">{auditDate(item.timestamp)} · {item.actor==='TimeKeepr'?'TimeKeeper':item.actor}</span><b>{item.action}</b><span className="small muted">{[item.before,item.after].filter(Boolean).join(' → ').replace(/(?:confidence|probability|p\s*=)\s*[^·]+(?:·\s*)?/gi,'').replace(/(?:frame_id|chunk_id)\s*\d+/gi,'').trim()}</span></div>)}</Card></div>:<Card><h2>No activity recorded</h2><p>Choose another client or case.</p></Card>}
    {pack&&selectedEntry?.matter_id&&<SourcePackDialog s={s} matterId={selectedEntry.matter_id} initialPeriodId={selectedEntry.id} action={action} close={()=>setPack(false)}/>}
  </>;
}
