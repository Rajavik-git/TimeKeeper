import { useEffect, useState } from 'react';
import { api, client, money, shortDate, today, type ScreenProps } from '../../api/client';
import { draftInvoice, effectiveMs, formatPreciseDuration, formatRoundedMinutes, summarizeWork } from '../../calculations/billing';
import { Card } from '../../shared/components/Card';
import { Kpi } from '../../shared/components/Kpi';
import { MatterSelect } from '../../shared/components/MatterSelect';
import { MatterReference } from '../../shared/components/MatterReference';
import { Pill } from '../../shared/components/Pill';

export function PreInvoices({s,core,action,source,selectedCase,refresh}:ScreenProps) {
  const [selected,setSelected]=useState(selectedCase ?? s.matter[0]?.id ?? 0);
  useEffect(()=>{if(selectedCase) setSelected(selectedCase);},[selectedCase]);
  const [tab,setTab]=useState<'all'|'bill'|'non'>('all');
  const [type,setType]=useState<'final'|'deposit'>('final');
  const [expenseLabel,setExpenseLabel]=useState('');
  const [expenseType,setExpenseType]=useState<'expense'|'disbursement'>('expense');
  const [expenseAmount,setExpenseAmount]=useState('');
  const [csv,setCsv]=useState('');
  const item=s.matter.find(m=>m.id===selected) ?? s.matter[0];
  if(!item) return null;
  const owner=client(s,item.id)!;
  const periods=core.periods.filter(p=>p.caseId===String(item.id) && !p.excluded).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  const billed=periods.filter(p=>p.billable&&p.billingStatus==='billed');
  const billable=periods.filter(p=>p.billable&&p.billingStatus==='unbilled');
  const non=periods.filter(p=>!p.billable);
  const preview=draftInvoice(s,core,item.id,type);
  const invoices=core.billing.invoices.filter(i=>i.caseId===String(item.id));
  const expenses=core.billing.expenses.filter(e=>e.caseId===String(item.id)&&e.invoiceId===null);
  const billedSummary=summarizeWork(billed,core.sources);
  const allSummary=summarizeWork(periods,core.sources);
  const nonSummary=summarizeWork(non,core.sources);
  const alerts:string[]=[];
  for(const rule of s.client_rule.filter(r=>r.client_id===owner.id)) {
    if(rule.type==='daily_research_cap') {
      const selected=new Set(billable.map(p=>p.id));
      const research=core.periods.filter(p=>p.billable&&!p.excluded&&
        (p.billingStatus==='billed'||selected.has(p.id))&&
        s.matter.find(m=>String(m.id)===p.caseId)?.client_id===owner.id&&
        s.task.find(t=>t.id===p.taskTypeId)?.code==='RECH');
      const byDate=new Map<string,typeof research>();
      for(const period of research) {const date=period.startedAt.slice(0,10);byDate.set(date,[...(byDate.get(date)??[]),period]);}
      for(const [date,day] of byDate) if(summarizeWork(day,core.sources).preciseDurationMs>rule.value*6*60000)
        alerts.push(`${rule.label}: ${date}`);
    }
    if(rule.type==='nonbillable_travel' && billable.some(p=>s.task.find(t=>t.id===p.taskTypeId)?.code==='DEPL'))
      alerts.push(rule.label);
  }
  if(item.budget_cents && preview.feesCents>=item.budget_cents*0.85) alerts.push('Case budget has reached 85%.');
  const issue=async()=>{
    const {pendingPeriods,complete,...snapshot}=preview;
    await action(api.POST('/api/invoices',{body:{...snapshot,type}}));
  };
  const line=(period:(typeof periods)[number])=><div className="line" key={period.id}>
    <span className="num small muted">{shortDate(period.startedAt.slice(0,10))}</span>
    <span><b>{period.label}</b><small><button className="link" disabled={period.billingStatus==='billed'} onClick={()=>action(api.PATCH('/api/work-periods/{id}/details',{params:{path:{id:period.id}},body:{billable:!period.billable,nonbillableReason:period.billable?'offered':null}}))}>{period.billable?'Do not bill':'Bill'}</button>
      {' · '}{core.sources.some(e=>e.workPeriodId===period.id)?<button className="link" onClick={()=>source(period.id)}>source</button>:'added manually'}</small></span>
    <span className="num">{formatPreciseDuration(effectiveMs(period))}</span>
    <span className="num hide-s">{period.billable?item.mode==='flat_fee'?'Flat fee':'Included in grouped fee':'Not billable'}</span>
    <span className="hide-s">{period.timeValidated?'Time validated':'Needs time validation'} · {period.billingStatus}</span>
  </div>;
  const exportCsv=(invoiceId:number)=>{
    const invoice=invoices.find(i=>i.id===invoiceId)!;
    const escape=(value:unknown)=>`"${String(value).replaceAll('"','""')}"`;
    const lines=['number;date;client;case;label;minutes;rate_ex_vat;amount_ex_vat;vat'];
    for(const row of core.billing.lines.filter(l=>l.invoiceId===invoiceId)) lines.push([
      invoice.number,invoice.date,owner.name,item.title,row.label,row.billedMinutes,
      (row.rateCents/100).toFixed(2),(row.amountCents/100).toFixed(2),row.vat?'yes':'no',
    ].map(escape).join(';'));
    setCsv(lines.join('\n'));
  };
  return <>
    <div className="row between"><div><span className="eyebrow">Pre-invoice · {s.setting[0].invoice_prefix}{String(s.setting[0].next_number).padStart(4,'0')} (next number)</span><h1>Pre-invoices</h1></div>
      <label className="col">Case <MatterSelect s={s} value={item.id} onChange={id=>{if(id)setSelected(id)}}/></label></div>
    <div className="grid4">
      <Kpi title="Already billed" value={formatRoundedMinutes(billedSummary.roundedMinutes)} detail={`${billed.length} periods`}/>
      <Kpi title="To bill" value={money(preview.feesCents)} detail={`${formatRoundedMinutes(preview.billedMinutes)} · excl. VAT`}/>
      <Kpi title="Not billable" value={formatRoundedMinutes(nonSummary.roundedMinutes)} detail={`${non.length} periods`}/>
      <Kpi title="To review" value={preview.pendingPeriods} detail={preview.pendingPeriods?'Validate time before issuing':'Ready to issue'}/>
    </div>
    <Card className="pre-progress"><h3>Time worked: {formatRoundedMinutes(allSummary.roundedMinutes)}</h3>
      <p className="small muted">Totals use precise effective milliseconds and round once for the selected group. {allSummary.complete?'Coverage complete.':'Coverage incomplete.'}</p>
      <div className="row small"><span>Billed {formatRoundedMinutes(billedSummary.roundedMinutes)}</span><span>To bill {formatRoundedMinutes(preview.billedMinutes)}</span><span>Non-billable {formatRoundedMinutes(nonSummary.roundedMinutes)}</span></div>
    </Card>
    {alerts.map(alert=><div className="card-l warn" key={alert}><b>Client rule</b> {alert}</div>)}
    <div className="pre-layout"><div className="stack">
      <div className="tabs">{([['all','All'],['bill','Billable'],['non','Non-billable']] as const).map(([key,title])=><button key={key} aria-selected={tab===key} onClick={()=>setTab(key)}>{title}</button>)}</div>
      {tab!=='non'&&<Card><div className="row between"><h3>Billable work</h3><button className="btn small" onClick={async()=>{
        for(const period of billable.filter(p=>!p.timeValidated)) await api.POST('/api/work-periods/{id}/validate-time',{params:{path:{id:period.id}},body:{}});
        await refresh();
      }}>Validate all time</button></div>
        <div className="line line-head"><span>Date</span><span>Work performed</span><span>Duration</span><span className="hide-s">Amount excluding VAT</span><span className="hide-s">Status</span></div>
        {periods.filter(p=>p.billable).map(line)}
        {item.mode==='flat_fee'&&<div className="line"><span/><b>Agreed flat fee {preview.lines.some(l=>l.origin==='flat_fee')?'to bill':'already billed'}</b><span/><span>{money(item.flat_fee_cents??0)}</span></div>}
      </Card>}
      {tab!=='bill'&&<Card><h3>Non-billable</h3>{non.length?non.map(line):<span className="muted">All time on this case is billable.</span>}</Card>}
      <Card><div className="row between"><h3>Expenses and disbursements</h3><span className="tiny muted">Disbursements are charged without VAT</span></div>
        {expenses.map(expense=><div className="row between line-row" key={expense.id}><span>{shortDate(expense.date)} · {expense.label} <Pill>{expense.type}</Pill></span><span>{money(expense.amountCents)} <button className="btn small" onClick={()=>action(api.DELETE('/api/billing/expenses/{id}',{params:{path:{id:expense.id}}}))}>×</button></span></div>)}
        <form className="row" onSubmit={async event=>{event.preventDefault();await action(api.POST('/api/billing/expenses',{body:{caseId:String(item.id),date:today,label:expenseLabel,type:expenseType,amountCents:Math.round(Number(expenseAmount.replace(',','.'))*100)}}));setExpenseLabel('');setExpenseAmount('');}}>
          <input className="field grow" placeholder="Label" aria-label="Expense label" required value={expenseLabel} onChange={event=>setExpenseLabel(event.target.value)}/>
          <select className="field" value={expenseType} onChange={event=>setExpenseType(event.target.value as typeof expenseType)}><option value="expense">expense</option><option value="disbursement">disbursement</option></select>
          <input className="field num" placeholder="0.00" aria-label="Amount in euros" required value={expenseAmount} onChange={event=>setExpenseAmount(event.target.value)}/><button className="btn small">Add</button>
        </form>
      </Card>
      <Card className="main"><h3>Issued invoices</h3>{invoices.length?invoices.map(invoice=><div className="col line-row" key={invoice.id}>
        <div className="row between"><b>{invoice.number} · <MatterReference value={item.reference}/> {item.title}</b><span>{invoice.type} · {money(invoice.subtotalCents)} ex VAT <button className="btn small" onClick={()=>exportCsv(invoice.id)}>CSV</button></span></div>
        {core.billing.lines.filter(l=>l.invoiceId===invoice.id).map(row=><div className="row between tiny muted" key={row.id}><span>{row.label}</span><span>{money(row.amountCents)}</span></div>)}
      </div>):<span className="muted">No invoice for this case.</span>}</Card>
    </div><Card className="side pre-summary">
      <div className="row between"><span>Fees to bill</span><b>{money(preview.feesCents)}</b></div>
      <div className="row between"><span>Expenses</span><b>{money(preview.expensesCents)}</b></div>
      <div className="row between"><span>VAT</span><b>{money(preview.vatCents)}</b></div>
      <div className="row between"><span>Disbursements</span><b>{money(preview.disbursementsCents)}</b></div>
      <div className="row between total"><span>Total including VAT</span><b>{money(preview.totalCents)}</b></div>
      <span className="small">Periods to validate: {preview.pendingPeriods || 'none'}</span>
      <label className="col">Invoice type <select className="field" value={type} onChange={event=>setType(event.target.value as typeof type)}><option value="final">final</option><option value="deposit">deposit</option></select></label>
      <button className="btn primary" disabled={preview.pendingPeriods>0||!preview.complete||alerts.length>0||preview.totalCents===0} onClick={issue}>{preview.pendingPeriods?'Validate time before issuing':!preview.complete?'Resolve coverage gaps':alerts.length?'Resolve client rules':preview.totalCents===0?'Nothing to invoice':'Issue invoice'}</button>
      <span className="tiny muted">Calculated in the app from precise periods. Issuing saves this snapshot and fixes the applied rate.</span>
    </Card></div>
    {csv&&<div className="modal-back"><div className="modal glass pad col"><h2>CSV export</h2><textarea className="field csv" readOnly value={csv}/><div className="row"><button className="btn primary" onClick={()=>navigator.clipboard.writeText(csv)}>Copy</button><button className="btn" onClick={()=>setCsv('')}>Close</button></div></div></div>}
  </>;
}
