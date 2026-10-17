import { useState } from 'react';
import { api, type ScreenProps } from '../../api/client';
import { shortDate } from '../format';

type Scope='invoice'|'case'|'period'|'chosen';
export function SourcePackDialog({s,matterId,close,action,initialPeriodId}:Pick<ScreenProps,'s'|'action'> & {matterId:number;close:()=>void;initialPeriodId?:number}) {
  const item=s.matter.find(m=>m.id===matterId);
  const owner=s.client.find(c=>c.id===item?.client_id);
  const entries=s.time_entry.filter(e=>e.matter_id===matterId).sort((a,b)=>a.date.localeCompare(b.date));
  const invoices=s.invoice.filter(i=>i.matter_id===matterId);
  const [scope,setScope]=useState<Scope>(initialPeriodId?'chosen':'case');
  const [invoiceId,setInvoiceId]=useState(invoices[0]?.id);
  const [from,setFrom]=useState(entries[0]?.date??'');
  const [to,setTo]=useState(entries.at(-1)?.date??'');
  const [selected,setSelected]=useState<number[]>(initialPeriodId?[initialPeriodId]:[]);
  const [options,setOptions]=useState<string[]>(['blur','personal','audit']);
  const [receipt,setReceipt]=useState('');
  if(!item) return null;
  const toggle=(value:string)=>setOptions(current=>current.includes(value)?current.filter(x=>x!==value):[...current,value]);
  const create=async()=>{
    const result=await action(api.POST('/api/cases/{id}/source-pack',{params:{path:{id:matterId}},body:{scope,options,
      ...(scope==='invoice'?{invoiceId}:{}),...(scope==='period'?{from,to}:{}),...(scope==='chosen'?{periodIds:selected}:{})}}));
    if(result) {
      setReceipt(result.export.sha256);
      const url=URL.createObjectURL(new Blob([result.payload],{type:'application/json;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`source-pack-${item.reference}-${result.export.id}.json`;link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),0);
    }
  };
  return <div className="modal-back" onMouseDown={event=>{if(event.target===event.currentTarget)close()}}>
    <div className="modal source-pack-dialog" role="dialog" aria-modal="true" aria-label="Export source pack" onKeyDown={event=>{if(event.key==='Escape')close()}}>
      <div className="row between"><div><h2>Export source pack</h2><p>{owner?.name} · {item.title} <span className="matter-reference">{item.reference}</span></p></div><button className="iconbtn" aria-label="Close" onClick={close}>×</button></div>
      <h3>What should it cover?</h3>
      <div className="col">{([['invoice','An invoice'],['case',`The whole case (${entries.length} periods recorded)`],['period','A period'],['chosen','Lines I choose']] as [Scope,string][]).map(([value,label])=><label className="row" key={value}><input type="radio" name="pack-scope" checked={scope===value} onChange={()=>setScope(value)}/>{label}</label>)}</div>
      {scope==='invoice'&&<select className="field" value={invoiceId} onChange={event=>setInvoiceId(Number(event.target.value))}>{invoices.map(i=><option key={i.id} value={i.id}>{i.number}</option>)}</select>}
      {scope==='period'&&<div className="row"><label>From <input className="field" type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>To <input className="field" type="date" value={to} onChange={event=>setTo(event.target.value)}/></label></div>}
      {scope==='chosen'&&<div className="source-pack-lines">{entries.map(e=><label className="row" key={e.id}><input type="checkbox" checked={selected.includes(e.id)} onChange={()=>setSelected(current=>current.includes(e.id)?current.filter(x=>x!==e.id):[...current,e.id])}/>{shortDate(e.date)} · {e.label}</label>)}</div>}
      <h3>Protect confidentiality</h3>
      <div className="col">{[['blur','Blur other visible clients'],['personal','Leave out personal apps'],['transcripts','Include call transcripts'],['audit','Include the audit trail']].map(([value,label])=><label className="row" key={value}><input type="checkbox" checked={options.includes(value)} onChange={()=>toggle(value)}/>{label}</label>)}</div>
      {receipt&&<p role="status" className="small">Source pack created · SHA-256 {receipt}</p>}
      <div className="row end"><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={()=>void create()} disabled={(scope==='invoice'&&!invoiceId)||(scope==='chosen'&&!selected.length)}>Create source pack</button></div>
    </div>
  </div>;
}
