import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, client, money, shortDate, today, type ScreenProps } from '../../api/client';
import { configuredRate, draftInvoice, effectiveMs, formatPreciseDuration, formatRoundedMinutes, summarizeWork } from '../../calculations/billing';
import { previousBillingMetrics } from '../../calculations/cases';
import { Card } from '../../shared/components/Card';
import { Kpi } from '../../shared/components/Kpi';
import { MatterReference } from '../../shared/components/MatterReference';
import { Pill } from '../../shared/components/Pill';
import { Icon } from '../../shared/components/Icon';
import { rate as rateLabel } from '../../shared/format';
import './Billing.css';

type InvoiceRow = {id:string;date:string;label:string;durationMs:number|null;amountCents:number|null;kind:'period'|'expense'|'disbursement'|'flat_fee';pending:boolean};
type SortKey = 'date'|'label'|'duration'|'amount';
type SortState = {key:SortKey;direction:'ascending'|'descending'};
let billingSort:SortState|null=null;
const billingDate=(value:string)=>shortDate(value).replace(/\bSept\b/,'Sep');

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

export function PreInvoices({s,core,action,navigate,selectedCase,refresh}:ScreenProps) {
  const [selected,setSelected]=useState<number|null>(selectedCase??null);
  const [type,setType]=useState<'final'|'deposit'>(selectedCase && s.matter.find(m=>m.id===selectedCase)?.mode==='flat_fee'?'final':'deposit');
  const [expenseOpen,setExpenseOpen]=useState(false);
  const [expenseLabel,setExpenseLabel]=useState('');
  const [expenseType,setExpenseType]=useState<'expense'|'disbursement'>('expense');
  const [expenseAmount,setExpenseAmount]=useState('');
  const [sort,setSort]=useState<SortState|null>(billingSort);
  const [undoSort,setUndoSort]=useState<SortState|null|undefined>();
  const [notice,setNotice]=useState('');
  const [pendingAction,setPendingAction]=useState<string|null>(null);
  const [editing,setEditing]=useState<string|null>(null);
  const [correctedMinutes,setCorrectedMinutes]=useState('');
  const overviewRef=useRef<HTMLDivElement>(null);
  const tableRef=useRef<HTMLDivElement>(null);
  const [moreCases,setMoreCases]=useState(false);
  const [tableFade,setTableFade]=useState({top:false,bottom:false});
  useEffect(()=>{setSelected(selectedCase??null);if(selectedCase) setType(s.matter.find(m=>m.id===selectedCase)?.mode==='flat_fee'?'final':'deposit');},[selectedCase]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>{setNotice('');setUndoSort(undefined)},3500);return()=>window.clearTimeout(timer);},[notice]);

  const openCases=s.matter.filter(item=>item.status==='open').map(item=>{
    const owner=client(s,item.id);
    const periods=core.periods.filter(period=>period.caseId===String(item.id)&&!period.excluded&&period.billable&&period.billingStatus==='unbilled');
    const preview=draftInvoice(s,core,item.id,'final');
    const invoices=core.billing.invoices.filter(invoice=>invoice.caseId===String(item.id)).sort((a,b)=>b.date.localeCompare(a.date));
    return {item,owner,periods,preview,lastInvoice:invoices[0],toBillCents:item.mode==='flat_fee'?0:preview.feesCents};
  }).filter(row=>row.owner&&(row.periods.length||row.preview.feesCents>0))
    .sort((a,b)=>b.toBillCents-a.toBillCents);
  useEffect(()=>{
    const node=overviewRef.current;
    if(!node)return;
    const update=()=>setMoreCases(node.scrollHeight-node.scrollTop>node.clientHeight+2);
    const observer=new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize',update);
    update();
    return()=>{observer.disconnect();window.removeEventListener('resize',update)};
  },[selected,openCases.length]);
  useEffect(()=>{
    const node=tableRef.current;
    if(!node)return;
    const update=()=>setTableFade({top:node.scrollTop>2,bottom:node.scrollHeight-node.scrollTop>node.clientHeight+2});
    const observer=new ResizeObserver(update);
    observer.observe(node);
    const body=node.querySelector('tbody');
    if(body)observer.observe(body);
    update();
    return()=>observer.disconnect();
  },[selected,core.periods.length,core.billing.expenses.length,expenseOpen]);

  const validate=async(ids:string[])=>{
    if(pendingAction)return;
    setPendingAction('validate');
    setNotice(`Validating ${ids.length} period${ids.length===1?'':'s'}…`);
    let done=0;
    try {
      for(const id of ids) {
        const result=await api.POST('/api/work-periods/{id}/validate-time',{params:{path:{id}},body:{}});
        if(result.error) {setNotice(`${done} period${done===1?'':'s'} validated; a later validation failed.`);await refresh();return;}
        done++;
      }
      await refresh();
      setNotice(`${done} period${done===1?'':'s'} validated`);
    } catch {
      setNotice(`${done} period${done===1?'':'s'} validated; please try again for the rest.`);
      await refresh().catch(()=>undefined);
    } finally {
      setPendingAction(null);
    }
  };

  const item=s.matter.find(matter=>matter.id===selected);
  if(!item) {
    const prior=previousBillingMetrics(s,core,today);
    const note=`Changes in % compare with the same period last month (${new Date(`${prior.previousDay.slice(0,7)}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}–${prior.previousDay.slice(-2)}).`;
    const ready=openCases.filter(row=>row.item.mode!=='flat_fee'&&row.preview.pendingPeriods===0&&row.preview.complete);
    const waiting=openCases.filter(row=>row.preview.pendingPeriods>0);
    const readyCents=ready.reduce((sum,row)=>sum+row.preview.feesCents,0);
    const allCents=openCases.reduce((sum,row)=>sum+row.toBillCents,0);
    return <>
      <div className="page-head billing-page-head"><div><h1>Billing</h1><p>Choose a case to prepare its invoice. {note}</p></div></div>
      <div className="billing-summary stats billing-scope">
        <Kpi title="Ready to invoice" value={<span className="billing-vrow"><span>{money(readyCents)}</span>{delta(readyCents,prior.readyCents,prior.previousDay,true)}</span>} detail={`${ready.length} case${ready.length===1?'':'s'}, all validated`}/>
        <Kpi title="Waiting for validation" value={<span className="billing-vrow"><span>{waiting.length}</span>{delta(waiting.length,prior.waitingCases,prior.previousDay,false)}</span>} detail={`case${waiting.length===1?'':'s'} with periods to validate`}/>
        <Kpi title="To bill in total" value={<span className="billing-vrow"><span>{money(allCents)}</span>{delta(allCents,prior.toBillCents,prior.previousDay,false)}</span>} detail="Open cases"/>
      </div>
      <div className="billing-overview billing-scope" ref={overviewRef} onScroll={event=>setMoreCases(event.currentTarget.scrollHeight-event.currentTarget.scrollTop>event.currentTarget.clientHeight+2)}><div className="billing-cards">
        {openCases.map(({item:caseItem,owner,preview,lastInvoice})=><button className="billing-card" key={caseItem.id} onClick={()=>{setSelected(caseItem.id);setType(caseItem.mode==='flat_fee'?'final':'deposit')}}>
          <span className="billing-card-head"><strong title={owner!.name}>{owner!.name}</strong><span title={caseItem.title}>{caseItem.title}</span><MatterReference value={caseItem.reference}/></span>
          <span className="billing-card-value"><strong>{money(preview.feesCents)}</strong>{(caseItem.mode!=='flat_fee'||preview.billedMinutes>0)&&<span>{formatRoundedMinutes(preview.billedMinutes)}</span>}</span>
          <span className="billing-card-foot"><Pill kind={preview.pendingPeriods?'warn':caseItem.mode==='flat_fee'?'out':'ok'}>{preview.pendingPeriods?`${preview.pendingPeriods} to validate`:caseItem.mode==='flat_fee'?'Flat fee':'Ready to invoice'}</Pill>{lastInvoice&&<small title={`Last: ${lastInvoice.number}, ${billingDate(lastInvoice.date)}`}>{`Last: ${lastInvoice.number}, ${billingDate(lastInvoice.date)}`}</small>}</span>
        </button>)}
        {!openCases.length&&<Card className="billing-empty"><h2>Nothing to invoice</h2><p>New billable work will appear here.</p><button className="btn" onClick={()=>navigate('matters')}>View cases</button></Card>}
      </div>{moreCases&&<button className="billing-scroll-cue" onClick={()=>overviewRef.current?.scrollBy({top:overviewRef.current.clientHeight,behavior:'smooth'})}>More cases <span aria-hidden="true">↓</span></button>}</div>
      {notice&&<div className="toast billing-toast" role="status" onClick={()=>setNotice('')}>{notice}{notice.startsWith('Sorted by')&&undoSort!==undefined&&<button className="billing-toast-undo" onClick={event=>{event.stopPropagation();billingSort=undoSort;setSort(undoSort);setUndoSort(undefined);setNotice('Sort restored')}}>Undo</button>}<span aria-hidden="true">×</span></div>}
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
  const workRows=rows.filter(row=>row.kind==='period'||row.kind==='flat_fee');
  const expenseRows=rows.filter(row=>row.kind==='expense'||row.kind==='disbursement');
  const sortedWork=sort?sortRows(workRows,sort.key,sort.direction):workRows;
  const sortedExpenses=sort?.key==='date'?sortRows(expenseRows,'date',sort.direction):sortRows(expenseRows,'date','ascending');
  const sorted=[...sortedWork,...sortedExpenses];
  const sortHeader=(key:SortKey,title:string)=><th scope="col" aria-sort={sort?.key===key?sort.direction:undefined}><button type="button" className="sort-button" onClick={()=>{
    setUndoSort(sort);
    billingSort={key,direction:sort?.key===key?(sort.direction==='ascending'?'descending':'ascending'):'ascending'};
    setSort(billingSort);
    setNotice(`Sorted by ${title.toLowerCase()}, ${billingSort.direction}`);
  }}>{title}{sort?.key===key&&<span aria-hidden="true"> {sort.direction==='ascending'?'↑':'↓'}</span>}</button></th>;
  const issue=async()=>{
    if(pendingAction)return;
    setPendingAction('issue');
    setNotice('Creating invoice…');
    const {pendingPeriods,complete,...snapshot}=preview;
    try {
      const result=await action(api.POST('/api/invoices',{body:{...snapshot,type}}));
      setNotice(result?`Invoice ${nextNumber} created`:'Invoice could not be created.');
    } catch {
      setNotice('Invoice could not be created. Please try again.');
    } finally {setPendingAction(null)}
  };
  const downloadCsv=async()=>{
    const esc=(value:string)=>`"${value.replaceAll('"','""')}"`;
    const csv=['date;work;minutes;amount_usd',...rows.map(row=>[row.date,row.label,
      row.durationMs===null?'':String(Math.ceil(row.durationMs/60000)),
      row.amountCents===null?'':(row.amountCents/100).toFixed(2)].map(esc).join(';'))].join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`${nextNumber}-draft.csv`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
    setNotice('Spreadsheet downloaded');
  };

  const shell=document.querySelector('.shell-main');
  return <>
    {shell&&createPortal(<nav className="billing-crumbs-outer" aria-label="Billing breadcrumb"><button onClick={()=>setSelected(null)}>Billing</button><svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="m5 2.5 4.5 4.5L5 11.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg><strong>{owner.name} · {item.title}</strong></nav>,shell)}
    <div className="page-head billing-page-head billing-detail-head"><div><h1>{owner.name} · {item.title}</h1><p>Check what will be billed, then create the invoice.</p></div><button className="btn" onClick={()=>setSelected(null)}><svg className="i sm billing-back-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>All billing</button></div>
    <Card className="billing-hero billing-scope"><div><h2>{item.mode==='flat_fee'?`This case is billed at a flat fee of ${money(item.flat_fee_cents??0)}.`:`You can bill ${owner.name} ${money(preview.feesCents)} for ${formatRoundedMinutes(preview.billedMinutes)} of work.`}</h2><p>{item.title} · {item.mode==='flat_fee'?'flat fee':rateLabel(rate.rateCents)}{alreadyBilledCents?` · ${money(alreadyBilledCents)} already billed`:''}</p></div>{pending.length?<div className="row"><Pill kind="warn">{pending.length} period{pending.length===1?'':'s'} to validate first</Pill><button className="btn attn" disabled={pendingAction!==null} onClick={()=>validate(pending.map(period=>period.id))}>{pendingAction==='validate'?'Validating…':'Validate them'}</button></div>:<Pill kind="ok">Everything is validated</Pill>}</Card>
    {alerts.map(alert=>{const boundary=alert.indexOf('. On ');return <div className="card-l warn billing-alert billing-scope" key={alert}><Icon name="alert"/><span>{boundary<0?alert:<><b>{alert.slice(0,boundary+1)}</b>{alert.slice(boundary+1)}</>}</span></div>})}
    <div className="billing-detail billing-scope">
      <Card className="billing-lines"><div className="billing-card-header"><div><h2>What will be on the invoice</h2><p>{billable.length} line{billable.length===1?'':'s'}{expenses.length?` and ${expenses.length} cost${expenses.length===1?'':'s'}`:''}</p></div><button className="btn small" aria-expanded={expenseOpen} onClick={()=>setExpenseOpen(value=>!value)}><Icon name="plus" small/>Add a cost</button></div>
        <div ref={tableRef} className={`table-scroll${tableFade.top?' billing-fade-top':''}${tableFade.bottom?' billing-fade-bottom':''}`} onScroll={event=>{const node=event.currentTarget;setTableFade({top:node.scrollTop>2,bottom:node.scrollHeight-node.scrollTop>node.clientHeight+2})}}><table><thead><tr>{sortHeader('date','Date')}{sortHeader('label','Work')}{sortHeader('duration','Time')}{sortHeader('amount','Amount')}</tr></thead><tbody>
          {sorted.map((row,index)=><Fragment key={`${row.kind}-${row.id}`}>{index===sortedWork.length&&expenseRows.length>0&&<tr className="billing-expense-subhead"><td colSpan={4}>Expenses</td></tr>}<tr className={editing===row.id?'billing-row-selected':undefined}><td className="num">{billingDate(row.date)}</td><td>{row.label}{(row.pending||row.kind!=='period')&&<small className={row.pending?'billing-pending':''}>{row.pending?'To validate':row.kind==='disbursement'?'Cost paid for the client':row.kind==='expense'?'Expense':'Agreed flat fee'}</small>}{row.kind==='period'&&<button className="link billing-correct" title="Correct time" aria-label={`Correct time for ${row.label}`} onClick={()=>{setEditing(row.id);setCorrectedMinutes(String((row.durationMs??0)/60000))}}><Icon name="edit" small/></button>}</td><td className={`num${row.durationMs===null?' muted':''}`}>{editing===row.id?<span className="row"><input className="field" type="number" min="0" step="0.001" aria-label="Corrected minutes" value={correctedMinutes} onChange={event=>setCorrectedMinutes(event.target.value)}/><button className="btn small" disabled={pendingAction!==null} onClick={async()=>{const value=Number(correctedMinutes);if(!Number.isFinite(value)||value<0){setNotice('Enter a valid duration.');return;}setPendingAction(`correct-${row.id}`);setNotice('Saving corrected time…');try{const result=await action(api.POST('/api/work-periods/{id}/duration-override',{params:{path:{id:row.id}},body:{durationMs:Math.round(value*60000)}}));if(result){setEditing(null);setNotice('Corrected time saved');}else setNotice('Could not save corrected time.');}catch{setNotice('Could not save corrected time. Please try again.');}finally{setPendingAction(null)}}}>{pendingAction===`correct-${row.id}`?'Saving…':'Save'}</button></span>:row.durationMs===null?'—':formatPreciseDuration(row.durationMs)}</td><td className="num">{row.amountCents===null?'Included':money(row.amountCents)}</td></tr></Fragment>)}
          {!rows.length&&<tr><td colSpan={4}><div className="billing-empty-row">Nothing left to bill on this case. <button className="link" onClick={()=>setSelected(null)}>View all cases</button></div></td></tr>}
        </tbody></table></div>
        {expenseOpen&&<form className="row billing-cost-form" onSubmit={async event=>{event.preventDefault();if(pendingAction)return;const cents=Math.round(Number(expenseAmount)*100);if(!Number.isFinite(cents)||cents<=0){setNotice('Enter a valid cost amount.');return;}setPendingAction('expense');setNotice('Adding cost…');try{const result=await action(api.POST('/api/billing/expenses',{body:{caseId:String(item.id),date:today,label:expenseLabel,type:expenseType,amountCents:cents}}));if(result){setExpenseLabel('');setExpenseAmount('');setExpenseOpen(false);setNotice('Cost added');}else setNotice('Could not add cost.');}catch{setNotice('Could not add cost. Please try again.');}finally{setPendingAction(null)}}}>
          <input className="field grow" placeholder="Cost description" aria-label="Cost description" required value={expenseLabel} onChange={event=>setExpenseLabel(event.target.value)}/>
          <select className="field" value={expenseType} aria-label="Cost type" onChange={event=>setExpenseType(event.target.value as typeof expenseType)}><option value="expense">Expense</option><option value="disbursement">Cost paid for the client</option></select>
          <input className="field num" type="number" min="0.01" step="0.01" placeholder="0.00" aria-label="Amount in US dollars" required value={expenseAmount} onChange={event=>setExpenseAmount(event.target.value)}/><button className="btn primary" disabled={pendingAction!==null}>{pendingAction==='expense'?'Adding…':'Add'}</button>
        </form>}
        {(billed.length>0||non.length>0)&&<div className="billing-excluded">Not on this invoice: {billed.length?`${formatRoundedMinutes(summarizeWork(billed,core.sources).roundedMinutes)} already billed`:''}{billed.length&&non.length?' · ':''}{non.length?`${formatRoundedMinutes(summarizeWork(non,core.sources).roundedMinutes)} you chose not to bill`:''}.</div>}
      </Card>
      <Card className="billing-side"><div className="billing-card-header"><div><h2>Invoice {nextNumber}</h2><p>{owner.name}</p></div></div><div className="billing-side-body"><div className="billing-totals"><span>Work</span><strong>{money(preview.feesCents)}</strong>{preview.expensesCents>0&&<><span>Expenses</span><strong>{money(preview.expensesCents)}</strong></>}{preview.vatCents>0&&<><span>Sales tax</span><strong>{money(preview.vatCents)}</strong></>}{preview.disbursementsCents>0&&<><span>Costs paid for the client</span><strong>{money(preview.disbursementsCents)}</strong></>}<span>Total to pay</span><strong>{money(preview.totalCents)}</strong></div>
        <div><span>Type of invoice</span><div className="seg" role="group" aria-label="Type of invoice"><button aria-pressed={type==='deposit'} onClick={()=>setType('deposit')}>Deposit</button><button aria-pressed={type==='final'} onClick={()=>setType('final')}>Final</button></div><small>{type==='deposit'?'An advance on the work done so far. The case stays open.':'The last invoice for this case.'}</small></div>
        <button className="btn primary" disabled={pendingAction!==null||(!pending.length&&(!preview.complete||preview.totalCents===0))} onClick={()=>pending.length?validate(pending.map(period=>period.id)):issue()}>{pendingAction==='validate'?'Validating…':pendingAction==='issue'?'Creating invoice…':pending.length?`Validate ${pending.length} period${pending.length===1?'':'s'}`:!preview.complete?'Resolve coverage gaps':preview.totalCents===0?'Nothing to invoice':`Create invoice ${nextNumber}`}</button>
        <button className="btn billing-download" onClick={downloadCsv}><svg className="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>Download as spreadsheet</button></div>
      </Card>
    </div>
    {notice&&<div className="toast billing-toast" role="status" onClick={()=>setNotice('')}>{notice}{notice.startsWith('Sorted by')&&undoSort!==undefined&&<button className="billing-toast-undo" onClick={event=>{event.stopPropagation();billingSort=undoSort;setSort(undoSort);setUndoSort(undefined);setNotice('Sort restored')}}>Undo</button>}<span aria-hidden="true">×</span></div>}
  </>;
}
