import { useEffect, useState } from 'react';
import { api, type ScreenProps, type Matter } from '../../api/client';
import { effectiveMs, formatPreciseDuration, formatRoundedMinutes } from '../../calculations/billing';
import { caseMetrics, clientMetrics } from '../../calculations/cases';
import { money, percent, rate as formatRate, shortDate } from '../../shared/format';
import { Icon } from '../../shared/components/Icon';
import { MatterReference } from '../../shared/components/MatterReference';

export function Cases({ s, core, action, navigate, source, selectedCase }: ScreenProps) {
  const [clientId, setClientId] = useState<number | null>(null);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [adverse, setAdverse] = useState('');
  const [newClientId, setNewClientId] = useState(s.client[0]?.id ?? 0);
  const [markerValue, setMarkerValue] = useState('');
  const [markerType, setMarkerType] = useState<'case_number'|'opposing_party'|'file'|'email'|'domain'|'keyword'>('keyword');
  const [tab, setTab] = useState<'time'|'markers'>('time');
  useEffect(() => {
    if (selectedCase) {
      const target = s.matter.find(item => item.id === selectedCase);
      if (target) { setClientId(target.client_id); setCaseId(target.id); }
    }
  }, [selectedCase, s.matter]);
  const currentClient = s.client.find(item => item.id === clientId);
  const currentCase = s.matter.find(item => item.id === caseId);
  const openClient = (id: number) => { setClientId(id); setCaseId(null); };
  const openCase = (item: Matter) => { setClientId(item.client_id); setCaseId(item.id); setTab('time'); };
  const breadcrumb = <nav className="case-breadcrumb" aria-label="Case breadcrumb">
    <button onClick={() => { setClientId(null); setCaseId(null); }}>Cases</button>
    {currentClient && <><span aria-hidden="true">›</span>{currentCase ? <button onClick={() => openClient(currentClient.id)}>{currentClient.name}</button> : <strong>{currentClient.name}</strong>}</>}
    {currentCase && <><span aria-hidden="true">›</span><strong>{currentCase.title}</strong></>}
  </nav>;
  const header = (title: string, description: string) => <div className="ph">
    <div className="t">{breadcrumb}<h1>{title}</h1><p>{description}</p></div>
    <div className="actions">
      {currentCase && <button className="btn" onClick={() => navigate('preInvoices', currentCase.id)}>Pre-invoice</button>}
      <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" small/>New case</button>
    </div>
  </div>;
  const metric = (label: string, value: string | number, detail: string) => <div className="stat" key={label}><span className="l">{label}</span><span className="v">{value}</span><span className="s">{detail}</span></div>;
  const stats = (items: [string, string | number, string][]) => <div className="stats">{items.map(([label, value, detail]) => metric(label, value, detail))}</div>;
  const caseCard = (item: Matter) => {
    const m = caseMetrics(s, core, item);
    return <button className="case-tile" key={item.id} onClick={() => openCase(item)}>
      <div className="case-tile-top"><span><strong>{item.title}</strong><MatterReference value={item.reference}/></span><span className={`st ${item.status === 'open' ? 'ok' : ''}`}><i/>{item.status === 'open' ? 'Open' : 'Closed'}</span></div>
      <p>{item.category}{item.opposing_party && item.opposing_party !== 'N/A' ? ` · v ${item.opposing_party}` : ''}</p>
      <dl className="case-tile-facts"><div><dt>Pricing</dt><dd>{item.mode === 'flat_fee' ? `Flat fee ${money(item.flat_fee_cents ?? 0)}` : formatRate(m.rate.rateCents)}</dd></div>
        <div><dt>Time</dt><dd>{formatRoundedMinutes(m.time)}</dd></div><div><dt>To bill</dt><dd>{money(m.toBill)}</dd></div>
        <div><dt>{item.mode === 'flat_fee' ? 'Flat fee used' : 'Budget'}</dt><dd>{m.budgetPercent === null ? '—' : percent(m.budgetPercent)}</dd></div></dl>
      {m.budgetPercent !== null && <div className="bar"><span style={{width:`${Math.min(m.budgetPercent, 100)}%`}}/></div>}
    </button>;
  };
  let body;
  if (!currentClient) {
    const allPeriods = core.periods.filter(period => !period.excluded && period.startedAt.slice(0,7) === '2026-10');
    const october = Math.ceil(allPeriods.reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0) / 60000);
    const clients = s.client.map(item => ({ item, metrics: clientMetrics(s, core, item.id) }));
    const toBill = clients.reduce((sum, row) => sum + row.metrics.toBill, 0);
    const attention = s.matter.map(item => ({ item, metrics: caseMetrics(s, core, item) }))
      .filter(row => (row.metrics.budgetPercent ?? 0) >= 85 || row.metrics.pending > 0);
    body = <>
      {header('Cases', `${s.client.length} clients · ${s.matter.filter(item => item.status === 'open').length} open cases`)}
      {stats([['Open cases', s.matter.filter(item => item.status === 'open').length, 'Across all clients'], ['Time in October', formatRoundedMinutes(october), 'Precise time, rounded once'], ['To bill', money(toBill), 'All cases · excl. VAT'], ['Needs attention', attention.length, 'Budget or time review']])}
      <div className="cases-dashboard cases-fill">
        <section className="card cases-clients"><div className="card-h"><div className="t"><h2>Clients</h2><p>{s.client.length} clients</p></div></div>
          <div className="case-scroll client-grid">{clients.map(({ item, metrics }) => <button className="client-tile" key={item.id} onClick={() => openClient(item.id)}>
            <div className="case-tile-top"><strong>{item.name}</strong><span className="ref">{item.code}</span></div>
            <p>{item.type} · {metrics.cases.length} cases</p>
            <dl className="case-tile-facts"><div><dt>Rate</dt><dd>{formatRate(item.rate_cents)}</dd></div><div><dt>To bill</dt><dd>{money(metrics.toBill)}</dd></div></dl>
            <small>Last activity {metrics.latest ? shortDate(metrics.latest) : '—'}</small>
          </button>)}</div>
        </section>
        <div className="cases-rail">
          <section className="card"><div className="card-h"><div className="t"><h2>To bill by client</h2><p>Open each client to review their cases</p></div></div>
            <div className="case-scroll bar-list">{clients.filter(row => row.metrics.toBill > 0).sort((a,b) => b.metrics.toBill-a.metrics.toBill).map(({item,metrics}) => <button key={item.id} onClick={() => openClient(item.id)}>
              <span><strong>{item.name}</strong><span>{money(metrics.toBill)} · {formatRoundedMinutes(metrics.time)}</span></span>
              <span className="bar"><span style={{width:`${toBill ? metrics.toBill*100/toBill : 0}%`}}/></span>
            </button>)}</div>
          </section>
          <section className="card"><div className="card-h"><div className="t"><h2>Needs attention</h2><p>Budget and validation</p></div></div>
            <div className="case-scroll attention-list">{attention.length ? attention.map(({item,metrics}) => <div key={item.id}><span><strong>{item.title}</strong><small>{metrics.pending ? `${metrics.pending} periods to validate` : `Budget ${percent(metrics.budgetPercent ?? 0)}`}</small></span><button className="btn sm" onClick={() => openCase(item)}>Open</button></div>) : <p>No cases need attention.</p>}</div>
          </section>
        </div>
      </div>
    </>;
  } else if (!currentCase) {
    const m = clientMetrics(s, core, currentClient.id);
    body = <>
      {header(currentClient.name, `${currentClient.code} · ${currentClient.type} · ${formatRate(currentClient.rate_cents)} · VAT ${currentClient.vat_applicable ? 'applicable' : 'not applicable'} · ${currentClient.billing_address}`)}
      {stats([['Open cases', m.cases.filter(item => item.status === 'open').length, `${m.cases.length} total`], ['Time recorded', formatRoundedMinutes(m.time), 'All cases'], ['To bill', money(m.toBill), 'Excl. VAT'], ['To validate', m.pending, 'Work periods']])}
      <section className="card cases-fill"><div className="card-h"><div className="t"><h2>Cases</h2><p>{m.cases.length} cases for {currentClient.name}</p></div></div><div className="case-scroll case-grid">{m.cases.map(caseCard)}</div></section>
    </>;
  } else {
    const m = caseMetrics(s, core, currentCase);
    const lines = [...m.periods].sort((a,b) => b.startedAt.localeCompare(a.startedAt));
    const markers = s.marker.filter(item => item.matter_id === currentCase.id);
    body = <>
      {header(currentCase.title, `${currentClient.name} · ${currentCase.category} · ${currentCase.reference}`)}
      {stats([['Time recorded', formatRoundedMinutes(m.time), `${lines.length} periods`], ['To bill', money(m.toBill), 'Excl. VAT'], ['Not billable', formatRoundedMinutes(m.nonBillable), 'Recorded time'], [currentCase.mode === 'flat_fee' ? 'Flat fee used' : 'Budget used', m.budgetPercent === null ? '—' : percent(m.budgetPercent), m.budget ? `${money(m.spent)} of ${money(m.budget)}` : 'No budget set']])}
      <section className="card case-facts-card"><dl className="facts case-facts"><div><dt>Pricing</dt><dd>{currentCase.mode === 'flat_fee' ? `Flat fee ${money(currentCase.flat_fee_cents ?? 0)}` : formatRate(m.rate.rateCents)}</dd></div>
        <div><dt>Opposing party</dt><dd>{currentCase.opposing_party || '—'}</dd></div><div><dt>Case number</dt><dd>{currentCase.case_number || '—'}</dd></div>
        <div><dt>Opened</dt><dd>{shortDate(currentCase.opened_on)} {currentCase.opened_on.slice(0,4)}</dd></div></dl>
        {m.budgetPercent !== null && <div className="card-b budget"><div className="row between"><span>{currentCase.mode === 'flat_fee' ? 'Flat fee used' : 'Budget used'}</span><span>{money(m.spent)} of {money(m.budget ?? 0)} · {percent(m.budgetPercent)}</span></div><div className="bar"><span style={{width:`${Math.min(m.budgetPercent,100)}%`}}/></div>{m.budgetPercent >= 85 && <span className="flag"><Icon name="alert" small/>Above 85%. Let the client know.</span>}</div>}
      </section>
      <section className="card cases-fill case-detail-list"><div className="toolbar"><div className="tabs" role="tablist" aria-label="Case sections"><button role="tab" aria-selected={tab === 'time'} onClick={() => setTab('time')}>Time ({lines.length})</button><button role="tab" aria-selected={tab === 'markers'} onClick={() => setTab('markers')}>Markers ({markers.length})</button></div></div>
        {tab === 'time' ? <div className="tbl"><table><thead><tr><th>Date</th><th>Work performed</th><th className="r">Duration</th><th className="r">Amount</th><th>Time</th><th>Billing</th></tr></thead><tbody>
          {lines.map(line => <tr key={line.id} className={core.sources.some(record => record.workPeriodId === line.id) ? 'click' : ''} onClick={() => {if(core.sources.some(record => record.workPeriodId === line.id)) source(line.id);}}>
            <td>{shortDate(line.startedAt)}</td><td className="wrap">{line.label}<span className="sub">{s.task.find(task => task.id === line.taskTypeId)?.label ?? 'Work period'}</span></td>
            <td className="r num">{formatPreciseDuration(effectiveMs(line))}</td><td className="r num">{line.billingStatus === 'billed' ? 'In invoice' : currentCase.mode === 'flat_fee' ? 'Flat fee' : line.billable && effectiveMs(line) !== null ? money(Math.round(effectiveMs(line)! * m.rate.rateCents / 3600000)) : '—'}</td>
            <td>{line.timeValidated ? 'Validated' : 'To validate'}</td><td>{line.billingStatus}</td>
          </tr>)}</tbody></table></div> : <><div className="card-b muted marker-intro">TimeKeeper looks for these markers in window titles, on screen and in calls. Each one found adds to the match score.</div><div className="tbl"><table><thead><tr><th>Marker</th><th>Type</th><th className="r">Weight</th><th>Origin</th><th className="r">Seen</th><th/></tr></thead><tbody>
            {markers.map(marker => <tr key={marker.id}><td>{marker.value}</td><td>{marker.type}</td><td className="r">{percent(marker.weight*100)}</td><td>{marker.learned ? 'Learned' : 'Set by you'}</td><td className="r">{marker.hits || '—'}</td><td><button className="iconbtn" aria-label={`Remove ${marker.value}`} onClick={() => action(api.DELETE('/api/markers/{id}', {params:{path:{id:marker.id}}}))}>×</button></td></tr>)}
          </tbody></table></div><div className="card-b row"><select className="field" aria-label="Marker type" value={markerType} onChange={event => setMarkerType(event.target.value as typeof markerType)}>{(['case_number','opposing_party','file','email','domain','keyword'] as const).map(type => <option key={type} value={type}>{type}</option>)}</select><input className="field grow" aria-label="New marker" placeholder="Name, file, keyword…" value={markerValue} onChange={event => setMarkerValue(event.target.value)}/><button className="btn sm" onClick={async () => {if(markerValue.trim()) {await action(api.POST('/api/markers',{body:{matter_id:currentCase.id,type:markerType,value:markerValue.trim()}}));setMarkerValue('');}}}>Add marker</button></div></>}
      </section>
    </>;
  }
  return <>{body}{adding && <div className="modal-back"><form className="modal glass pad col" onSubmit={async event => {event.preventDefault();const created = await action(api.POST('/api/matters',{body:{client_id:newClientId,title:name,opposing_party:adverse}}));if(created){setAdding(false);setName('');setAdverse('');openCase(created);}}}>
    <h2>New case</h2><label>Client <select className="field" value={newClientId} onChange={event => setNewClientId(Number(event.target.value))}>{s.client.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Title <input className="field" required value={name} onChange={event => setName(event.target.value)}/></label><label>Opposing party <input className="field" value={adverse} onChange={event => setAdverse(event.target.value)}/></label>
    <div className="row"><button className="btn primary">Create</button><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button></div>
  </form></div>}</>;
}
