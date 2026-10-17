import { useEffect, useState } from 'react';
import { api, client, money, shortDate, today, type ScreenProps } from '../../api/client';
import { configuredRate, draftInvoice, effectiveMs, formatPreciseDuration, formatRoundedMinutes, summarizeWork } from '../../calculations/billing';
import { previousBillingMetrics } from '../../calculations/cases';
import { Card } from '../../shared/components/Card';
import { Kpi } from '../../shared/components/Kpi';
import { MatterReference } from '../../shared/components/MatterReference';
import { Pill } from '../../shared/components/Pill';
import { rate as rateLabel } from '../../shared/format';

type InvoiceRow = {id:string;date:string;label:string;durationMs:number|null;amountCents:number|null;kind:'period'|'expense'|'disbursement'|'flat_fee';pending:boolean};
type SortKey = 'date'|'label'|'duration'|'amount';
type SortState = {key:SortKey;direction:'ascending'|'descending'};
let billingSort:SortState={key:'date',direction:'ascending'};

function sortRows(rows: InvoiceRow[], key: SortKey, direction:'ascending'|'descending') {
  const value=(row:InvoiceRow):string|number|null => key==='date'?row.date:key==='label'?row.label:key==='duration'?row.durationMs:row.amountCents;
  return [...rows].sort((a,b)=>{
    const left=value(a),right=value(b);
    if(left===null) return right===null?0:1;
    if(right===null) return -1;
    const comparison=typeof left==='number'&&typeof right==='number'?left-right:String(left).localeCompare(String(right),'en-US');
    return direction==='ascending'?comparison:-comparison;
  });
}

function delta(current:number,previous:number,previousDay:string,increaseGood:boolean) {
  if (!previous) return null;
  const change=Math.round((current-previous)*100/previous);
  return <span className={`case-kpi-delta ${change===0?'flat':(change>0)===increaseGood?'up':'down'}`} title={`vs ${new Date(`${previousDay}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}`}>{change>0?'+':change<0?'−':''}{Math.abs(change)}%</span>;
}

export function PreInvoices({s,core,action,selectedCase,refresh}:ScreenProps) {
  const [selected,setSelected]=useState<number|null>(selectedCase??null);
  const [type,setType]=useState<'final'|'deposit'>(selectedCase && s.matter.find(m=>m.id===selectedCase)?.mode==='flat_fee'?'final':'deposit');
  const [expenseOpen,setExpenseOpen]=useState(false);
  const [expenseLabel,setExpenseLabel]=useState('');
  const [expenseType,setExpenseType]=useState<'expense'|'disbursement'>('expense');
  const [expenseAmount,setExpenseAmount]=useState('');
  const [sort,setSort]=useState<SortState>(billingSort);
  const [notice,setNotice]=useState('');
  const [editing,setEditing]=useState<string|null>(null);
  const [correctedMinutes,setCorrectedMinutes]=useState('');
  useEffect(()=>{setSelected(selectedCase??null);if(selectedCase) setType(s.matter.find(m=>m.id===selectedCase)?.mode==='flat_fee'?'final':'deposit');},[selectedCase]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3500);return()=>window.clearTimeout(timer);},[notice]);

  const openCases=s.matter.filter(item=>item.status==='open').map(item=>{
    const owner=client(s,item.id);
    const periods=core.periods.filter(period=>period.caseId===String(item.id)&&!period.excluded&&period.billable&&period.billingStatus==='unbilled');
    const preview=draftInvoice(s,core,item.id,'final');
    const invoices=core.billing.invoices.filter(invoice=>invoice.caseId===String(item.id)).sort((a,b)=>b.date.localeCompare(a.date));
    return {item,owner,periods,preview,lastInvoice:invoices[0]};
  }).filter(row=>row.owner&&(row.periods.length||row.preview.feesCents>0))
    .sort((a,b)=>b.preview.feesCents-a.preview.feesCents);

  const validate=async(ids:string[])=>{
    let done=0;
    for(const id of ids) {
      const result=await api.POST('/api/work-periods/{id}/validate-time',{params:{path:{id}},body:{}});
      if(result.error) {setNotice(`${done} period${done===1?'':'s'} validated; a later validation failed.`);await refresh();return;}
      done++;
    }
    await refresh();
    setNotice(`${done} period${done===1?'':'s'} validated`);
  };

  const item=s.matter.find(matter=>matter.id===selected);
  if(!item) {
    const prior=previousBillingMetrics(s,core,today);
    const note=`Changes in % compare with the same period last month (${new Date(`${prior.previousDay.slice(0,7)}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}–${prior.previousDay.slice(-2)}).`;
    const ready=openCases.filter(row=>row.preview.pendingPeriods===0&&row.preview.complete);
    const waiting=openCases.filter(row=>row.preview.pendingPeriods>0);
    const readyCents=ready.reduce((sum,row)=>sum+row.preview.feesCents,0);
    const allCents=openCases.reduce((sum,row)=>sum+row.preview.feesCents,0);
    return <>
      <div className="page-head"><div><h1>Billing</h1><p>Choose a case to prepare its invoice. {note}</p></div></div>
      <div className="billing-summary stats">
        <Kpi title="Ready to invoice" value={<>{money(readyCents)}{delta(readyCents,prior.readyCents,prior.previousDay,true)}</>} detail={`${ready.length} case${ready.length===1?'':'s'}, all validated`}/>
        <Kpi title="Waiting for validation" value={<>{waiting.length}{delta(waiting.length,prior.waitingCases,prior.previousDay,false)}</>} detail={`case${waiting.length===1?'':'s'} with periods to validate`}/>
        <Kpi title="To bill in total" value={<>{money(allCents)}{delta(allCents,prior.toBillCents,prior.previousDay,false)}</>} detail="Open cases"/>
      </div>
      <div className="billing-overview"><div className="billing-cards">
        {openCases.map(({item:caseItem,owner,preview,lastInvoice})=><button className="billing-card" key={caseItem.id} onClick={()=>{setSelected(caseItem.id);setType(caseItem.mode==='flat_fee'?'final':'deposit')}}>
          <span className="billing-card-head"><strong>{owner!.name}</strong><span>{caseItem.title}</span><MatterReference value={caseItem.reference}/></span>
          <span className="billing-card-value"><strong>{money(preview.feesCents)}</strong><span>{formatRoundedMinutes(preview.billedMinutes)}</span></span>
          <span className="billing-card-foot"><Pill kind={preview.pendingPeriods?'warn':caseItem.mode==='flat_fee'?'out':'ok'}>{preview.pendingPeriods?`${preview.pendingPeriods} to validate`:caseItem.mode==='flat_fee'?'Flat fee':'Ready to invoice'}</Pill>{lastInvoice&&<small>{`Last: ${lastInvoice.number}, ${shortDate(lastInvoice.date)}`}</small>}</span>
        </button>)}
        {!openCases.length&&<Card><h2>Nothing to invoice</h2><p>New billable work will appear here.</p></Card>}
      </div></div>
      {notice&&<div className="toast" role="status" onClick={()=>setNotice('')}>{notice} ×</div>}
    </>;
  }

  const owner=client(s,item.id)!;
  const periods=core.periods.filter(period=>period.caseId===String(item.id)&&!period.excluded).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  const billed=periods.filter(period=>period.billable&&period.billingStatus==='billed');
  const billable=periods.filter(period=>period.billable&&period.billingStatus==='unbilled');
  const non=periods.filter(period=>!period.billable);
  const preview=draftInvoice(s,core,item.id,type);
  const pending=billable.filter(period=>!period.timeValidated);
  const expenses=core.billing.expenses.filter(expense=>expense.caseId===String(item.id)&&expense.invoiceId===null);
  const invoices=core.billing.invoices.filter(invoice=>invoice.caseId===String(item.id));
  const invoiceIds=new Set(invoices.map(invoice=>invoice.id));
  const alreadyBilledCents=core.billing.lines.filter(line=>invoiceIds.has(line.invoiceId)&&(line.origin==='work_period'||line.origin==='flat_fee'))
    .reduce((sum,line)=>sum+line.amountCents,0);
  const nextNumber=`${s.setting[0].invoice_prefix}${String(s.setting[0].next_number).padStart(4,'0')}`;
  const rate=configuredRate(s,item.id);
  const alerts:string[]=[];
  for(const rule of s.client_rule.filter(rule=>rule.client_id===owner.id)) {
    if(rule.type==='daily_research_cap') {
      const selectedIds=new Set(billable.map(period=>period.id));
      const research=core.periods.filter(period=>period.billable&&!period.excluded&&
        (period.billingStatus==='billed'||selectedIds.has(period.id))&&
        s.matter.find(matter=>String(matter.id)===period.caseId)?.client_id===owner.id&&
        s.task.find(task=>task.id===period.taskTypeId)?.code==='RECH');
      const byDate=new Map<string,typeof research>();
      for(const period of research) {const date=period.startedAt.slice(0,10);byDate.set(date,[...(byDate.get(date)??[]),period]);}
      for(const [date,day] of byDate) {
        const ms=summarizeWork(day,core.sources).preciseDurationMs;
        if(ms>rule.value*6*60000) alerts.push(`${owner.name} asked for at most ${formatRoundedMinutes(rule.value*6)} of research per day. On ${shortDate(date)} you recorded ${formatPreciseDuration(ms)}. Check this line before you bill.`);
      }
    }
    if(rule.type==='nonbillable_travel' && billable.some(period=>s.task.find(task=>task.id===period.taskTypeId)?.code==='DEPL')) alerts.push(rule.label);
  }
  if(item.budget_cents && preview.feesCents>=item.budget_cents*0.85) alerts.push('Case budget has reached 85%.');

  // Allocate the combined, once-rounded fee across rows so displayed amounts reconcile.
  const knownBillable=billable.filter(period=>effectiveMs(period)!==null);
  const totalMs=knownBillable.reduce((sum,period)=>sum+(effectiveMs(period)??0),0);
  let allocatedCents=0;
  const flatFeeLine=preview.lines.find(line=>line.origin==='flat_fee');
  const rows:InvoiceRow[]=[...(flatFeeLine?[{id:'flat-fee',date:today,label:flatFeeLine.label,durationMs:null,amountCents:flatFeeLine.amountCents,kind:'flat_fee' as const,pending:false}]:[]),...billable.map(period=>{
    const durationMs=effectiveMs(period);
    let amountCents:number|null=null;
    if(item.mode!=='flat_fee'&&durationMs!==null&&totalMs>0) {
      amountCents=period.id===knownBillable.at(-1)?.id ? preview.feesCents-allocatedCents : Math.round(preview.feesCents*durationMs/totalMs);
      allocatedCents+=amountCents;
    }
    return {id:period.id,date:period.startedAt.slice(0,10),label:period.label,durationMs,amountCents,kind:'period' as const,pending:!period.timeValidated};
  }),...expenses.map(expense=>({
    id:String(expense.id),date:expense.date,label:expense.label,durationMs:null,amountCents:expense.amountCents,
    kind:expense.type as InvoiceRow['kind'],pending:false,
  }))];
  const sorted=sortRows(rows,sort.key,sort.direction);
  const sortHeader=(key:SortKey,title:string)=><th scope="col" aria-sort={sort.key===key?sort.direction:undefined}><button type="button" className="sort-button" onClick={()=>setSort(previous=>{
    billingSort={key,direction:previous.key===key?(previous.direction==='ascending'?'descending':'ascending'):(key==='date'||key==='duration'||key==='amount'?'descending':'ascending')};
    return billingSort;
  })}>{title}<span aria-hidden="true"> {sort.key===key?(sort.direction==='ascending'?'↑':'↓'):'↕'}</span></button></th>;
  const issue=async()=>{
    const {pendingPeriods,complete,...snapshot}=preview;
    const result=await action(api.POST('/api/invoices',{body:{...snapshot,type}}));
    if(result) setNotice(`Invoice ${nextNumber} created`);
  };
  const downloadCsv=async()=>{
    const esc=(value:string)=>`"${value.replaceAll('"','""')}"`;
    const csv=['date;work;minutes;amount_usd',...rows.map(row=>[row.date,row.label,
      row.durationMs===null?'':String(Math.ceil(row.durationMs/60000)),
      row.amountCents===null?'':(row.amountCents/100).toFixed(2)].map(esc).join(';'))].join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`${nextNumber}-draft.csv`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  };

  return <>
    <div className="page-head"><div><div className="eyebrow"><button className="link" onClick={()=>setSelected(null)}>Billing</button> › {owner.name} · {item.title}</div><h1>{owner.name} · {item.title}</h1><p>Check what will be billed, then create the invoice.</p></div><button className="btn" onClick={()=>setSelected(null)}>All cases</button></div>
    <Card className="billing-hero"><div><h2>{item.mode==='flat_fee'?`This case is billed at a flat fee of ${money(item.flat_fee_cents??0)}.`:`You can bill ${owner.name} ${money(preview.feesCents)} for ${formatRoundedMinutes(preview.billedMinutes)} of work.`}</h2><p>{item.title} · {item.mode==='flat_fee'?'flat fee':rateLabel(rate.rateCents)}{alreadyBilledCents?` · ${money(alreadyBilledCents)} already billed`:''}</p></div>{pending.length?<div className="row"><Pill kind="warn">{pending.length} period{pending.length===1?'':'s'} to validate first</Pill><button className="btn attn" onClick={()=>validate(pending.map(period=>period.id))}>Validate them</button></div>:<Pill kind="ok">Everything is validated</Pill>}</Card>
    {alerts.map(alert=><div className="card-l warn" key={alert}><b>Client rule</b> {alert}</div>)}
    <div className="billing-detail">
      <Card className="billing-lines"><div className="row between"><div><h2>What will be on the invoice</h2><p>{billable.length} line{billable.length===1?'':'s'}{expenses.length?` and ${expenses.length} cost${expenses.length===1?'':'s'}`:''}</p></div><button className="btn small" onClick={()=>setExpenseOpen(value=>!value)}>Add a cost</button></div>
        <div className="table-scroll"><table><thead><tr>{sortHeader('date','Date')}{sortHeader('label','Work')}{sortHeader('duration','Time')}{sortHeader('amount','Amount')}</tr></thead><tbody>
          {sorted.map(row=><tr key={`${row.kind}-${row.id}`}><td className="num">{shortDate(row.date)}</td><td>{row.label}<small>{row.pending?'To validate':row.kind==='disbursement'?'Cost paid for the client':row.kind==='expense'?'Expense':row.kind==='flat_fee'?'Agreed flat fee':''}</small>{row.kind==='period'&&<button className="link" onClick={()=>{setEditing(row.id);setCorrectedMinutes(String((row.durationMs??0)/60000))}}>Correct time</button>}</td><td className="num">{editing===row.id?<span className="row"><input className="field" type="number" min="0" step="0.001" aria-label="Corrected minutes" value={correctedMinutes} onChange={event=>setCorrectedMinutes(event.target.value)}/><button className="btn small" onClick={async()=>{const value=Number(correctedMinutes);if(!Number.isFinite(value)||value<0)return;const result=await action(api.POST('/api/work-periods/{id}/duration-override',{params:{path:{id:row.id}},body:{durationMs:Math.round(value*60000)}}));if(result)setEditing(null)}}>Save</button></span>:row.durationMs===null?'—':formatPreciseDuration(row.durationMs)}</td><td className="num">{row.amountCents===null?'Included':money(row.amountCents)}</td></tr>)}
          {!rows.length&&<tr><td colSpan={4}>Nothing left to bill on this case.</td></tr>}
        </tbody></table></div>
        {expenseOpen&&<form className="row billing-cost-form" onSubmit={async event=>{event.preventDefault();const cents=Math.round(Number(expenseAmount)*100);if(!Number.isFinite(cents)||cents<=0){setNotice('Enter a valid cost amount.');return;}const result=await action(api.POST('/api/billing/expenses',{body:{caseId:String(item.id),date:today,label:expenseLabel,type:expenseType,amountCents:cents}}));if(result){setExpenseLabel('');setExpenseAmount('');setExpenseOpen(false);}}}>
          <input className="field grow" placeholder="Cost description" aria-label="Cost description" required value={expenseLabel} onChange={event=>setExpenseLabel(event.target.value)}/>
          <select className="field" value={expenseType} aria-label="Cost type" onChange={event=>setExpenseType(event.target.value as typeof expenseType)}><option value="expense">Expense</option><option value="disbursement">Cost paid for the client</option></select>
          <input className="field num" type="number" min="0.01" step="0.01" placeholder="0.00" aria-label="Amount in US dollars" required value={expenseAmount} onChange={event=>setExpenseAmount(event.target.value)}/><button className="btn primary">Add</button>
        </form>}
        {(billed.length>0||non.length>0)&&<div className="billing-excluded">Not on this invoice: {billed.length?`${formatRoundedMinutes(summarizeWork(billed,core.sources).roundedMinutes)} already billed`:''}{billed.length&&non.length?' · ':''}{non.length?`${formatRoundedMinutes(summarizeWork(non,core.sources).roundedMinutes)} you chose not to bill`:''}.</div>}
      </Card>
      <Card className="billing-side"><h2>Invoice {nextNumber}</h2><p>{owner.name}</p><div className="billing-totals"><span>Work</span><strong>{money(preview.feesCents)}</strong>{preview.expensesCents>0&&<><span>Expenses</span><strong>{money(preview.expensesCents)}</strong></>}{preview.vatCents>0&&<><span>Sales tax</span><strong>{money(preview.vatCents)}</strong></>}{preview.disbursementsCents>0&&<><span>Costs paid for the client</span><strong>{money(preview.disbursementsCents)}</strong></>}<span>Total to pay</span><strong>{money(preview.totalCents)}</strong></div>
        <div><span>Type of invoice</span><div className="seg" role="group" aria-label="Type of invoice"><button aria-pressed={type==='deposit'} onClick={()=>setType('deposit')}>Deposit</button><button aria-pressed={type==='final'} onClick={()=>setType('final')}>Final</button></div><small>{type==='deposit'?'An advance on the work done so far. The case stays open.':'The last invoice for this case.'}</small></div>
        <button className="btn primary" disabled={pending.length>0||!preview.complete||preview.totalCents===0} onClick={issue}>{pending.length?`Validate ${pending.length} period${pending.length===1?'':'s'} first`:!preview.complete?'Resolve coverage gaps':preview.totalCents===0?'Nothing to invoice':`Create invoice ${nextNumber}`}</button>
        <button className="btn" onClick={downloadCsv}>Download as spreadsheet</button>
      </Card>
    </div>
    {notice&&<div className="toast" role="status" onClick={()=>setNotice('')}>{notice} ×</div>}
  </>;
}
