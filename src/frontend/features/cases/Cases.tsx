import { useEffect, useRef, useState } from 'react';
import { api, today, type ScreenProps, type Matter, type Client } from '../../api/client';
import { effectiveMs, formatPreciseDuration, formatRoundedMinutes } from '../../calculations/billing';
import { caseMetrics, clientMetrics, previousMonthMetrics } from '../../calculations/cases';
import { money, percent, rate as formatRate, shortDate } from '../../shared/format';
import { Icon } from '../../shared/components/Icon';
import { MatterReference } from '../../shared/components/MatterReference';
import { SourcePackDialog } from '../../shared/components/SourcePackDialog';

type Suggestion = { kind: 'client'; client: Client; caption: string } | { kind: 'case'; item: Matter; caption: string };
const recentStorageKey = 'timekeeper-recent-cases';
function storedRecent(): number[] {
  try {
    const ids = JSON.parse(localStorage.getItem(recentStorageKey) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id)).slice(0, 3) : [];
  } catch { return []; }
}
function delta(current: number, previous: number, previousDay: string, increaseGood = true) {
  if (!previous) return null;
  const change = Math.round((current - previous) * 100 / previous);
  return <span className={`case-kpi-delta ${change === 0 ? 'flat' : (change > 0) === increaseGood ? 'up' : 'down'}`} title={`vs ${new Date(`${previousDay}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}`}>{change > 0 ? '+' : change < 0 ? '−' : ''}{Math.abs(change)}%</span>;
}

export function Cases({ s, core, action, navigate, source, selectedCase, refresh }: ScreenProps) {
  const [clientId, setClientId] = useState<number | null>(null);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [adverse, setAdverse] = useState('');
  const [newClientId, setNewClientId] = useState(s.client[0]?.id ?? 0);
  const [markerValue, setMarkerValue] = useState('');
  const [markerType, setMarkerType] = useState<'case_number'|'opposing_party'|'file'|'email'|'domain'|'keyword'>('keyword');
  const [tab, setTab] = useState<'time'|'markers'|'history'>('time');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClients, setSearchClients] = useState<Client[]>([]);
  const [searchCases, setSearchCases] = useState<Matter[]>([]);
  const [searchActive, setSearchActive] = useState(0);
  const [recentIds, setRecentIds] = useState(storedRecent);
  const [notice, setNotice] = useState('');
  const [sorts, setSorts] = useState<Record<string,{column:number; direction:1|-1}>>(() => {
    try { return JSON.parse(sessionStorage.getItem('timekeeper-case-sorts') ?? '{}'); } catch { return {}; }
  });
  const [pack, setPack] = useState(false);
  useEffect(() => { sessionStorage.setItem('timekeeper-case-sorts', JSON.stringify(sorts)); }, [sorts]);
  const searchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!query.trim()) { setSearchClients([]); setSearchCases([]); return; }
    let live = true;
    const timer = window.setTimeout(async () => {
      const response = await api.GET('/api/cases/search', {params:{query:{query:query.trim()}}});
      if (live && response.data) { setSearchClients(response.data.clients); setSearchCases(response.data.cases); setSearchActive(0); }
    }, 120);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query]);
  useEffect(() => {
    if (!searchOpen) return;
    const outside = (event: PointerEvent) => { if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [searchOpen]);
  useEffect(() => {
    if (selectedCase) {
      const target = s.matter.find(item => item.id === selectedCase);
      if (target) {
        setClientId(target.client_id); setCaseId(target.id);
        setRecentIds(previous => { const next = [target.id, ...previous.filter(id => id !== target.id)].slice(0,3); localStorage.setItem(recentStorageKey, JSON.stringify(next)); return next; });
      }
    }
  }, [selectedCase, s.matter]);
  const currentClient = s.client.find(item => item.id === clientId);
  const currentCase = s.matter.find(item => item.id === caseId);
  const openClient = (id: number) => { setClientId(id); setCaseId(null); };
  const openCase = (item: Matter) => {
    setClientId(item.client_id); setCaseId(item.id); setTab('time'); setQuery(''); setSearchOpen(false);
    setRecentIds(previous => { const next = [item.id, ...previous.filter(id => id !== item.id)].slice(0,3); localStorage.setItem(recentStorageKey, JSON.stringify(next)); return next; });
  };
  const validatePeriods = async (ids: string[]) => {
    let count = 0;
    for (const id of ids) {
      const response = await api.POST('/api/work-periods/{id}/validate-time', {params:{path:{id}},body:{}});
      if (!response.error) count++;
    }
    if (count) { await refresh(); setNotice(`${count} period${count === 1 ? '' : 's'} validated`); window.setTimeout(() => setNotice(''), 3500); }
  };
  const breadcrumb = currentClient && <nav className="case-breadcrumb" aria-label="Case breadcrumb">
    <button onClick={() => { setClientId(null); setCaseId(null); }}>Cases</button>
    {currentClient && <><span aria-hidden="true">›</span>{currentCase ? <button onClick={() => openClient(currentClient.id)}>{currentClient.name}</button> : <strong>{currentClient.name}</strong>}</>}
    {currentCase && <><span aria-hidden="true">›</span><strong>{currentCase.title}</strong></>}
  </nav>;
  const header = (title: string, description: string, overview = false) => <div className="ph">
    <div className="t">{breadcrumb}<h1>{title}</h1><p>{description}</p></div>
    <div className="actions">
      {overview && caseSearch()}
      {currentCase && <><button className="btn" onClick={() => setPack(true)}><Icon name="source" small/>Export source pack</button><button className="btn" onClick={() => navigate('preInvoices', currentCase.id)}>Billing</button></>}
      <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" small/>New case</button>
    </div>
  </div>;
  const metric = (label: string, value: string | number, detail: string, change?: React.ReactNode) => <div className="stat" key={label}><span className="l">{label}</span><span className="case-kpi-value"><span className="v">{value}</span>{change}</span><span className="s">{detail}</span></div>;
  const stats = (items: [string, string | number, string, React.ReactNode?][]) => <div className="stats">{items.map(([label, value, detail, change]) => metric(label, value, detail, change))}</div>;
  const reasons = (item: Matter, metrics: ReturnType<typeof caseMetrics>) => [
    (metrics.budgetPercent ?? 0) >= 85 ? `${item.mode === 'flat_fee' ? 'Flat fee' : 'Budget'} at ${percent(metrics.budgetPercent!)}` : null,
    metrics.pending ? `${metrics.pending} period${metrics.pending === 1 ? '' : 's'} to validate` : null,
  ].filter(Boolean).join(' · ');
  const attentionRows = s.matter.filter(item => item.status === 'open').map(item => ({item, metrics: caseMetrics(s, core, item)}))
    .filter(row => (row.metrics.budgetPercent ?? 0) >= 85 || row.metrics.pending > 0)
    .sort((a,b) => (b.metrics.budgetPercent ?? 0)-(a.metrics.budgetPercent ?? 0) || b.metrics.pending-a.metrics.pending);
  const recentSuggestions: Suggestion[] = (recentIds.length ? recentIds : [...s.matter].sort((a,b) => b.opened_on.localeCompare(a.opened_on)).slice(0,3).map(item => item.id))
    .map(id => s.matter.find(item => item.id === id)).filter((item): item is Matter => !!item)
    .map(item => ({kind:'case', item, caption:s.client.find(client => client.id === item.client_id)?.name ?? ''}));
  const attentionSuggestions: Suggestion[] = attentionRows.slice(0,3).map(({item,metrics}) => ({kind:'case', item, caption:reasons(item,metrics)}));
  const topSuggestions: Suggestion[] = s.client.map(client => ({kind:'client' as const,client,caption:money(clientMetrics(s,core,client.id).toBill),amount:clientMetrics(s,core,client.id).toBill}))
    .sort((a,b) => b.amount-a.amount).slice(0,3);
  const searchSuggestions: Suggestion[] = query.trim() ? [
    ...searchClients.map(client => ({kind:'client' as const, client, caption:`${s.matter.filter(item => item.client_id === client.id).length} cases`})),
    ...searchCases.map(item => ({kind:'case' as const, item, caption:s.client.find(client => client.id === item.client_id)?.name ?? ''})),
  ] : [...recentSuggestions, ...attentionSuggestions, ...topSuggestions];
  const chooseSuggestion = (suggestion: Suggestion) => {
    if (suggestion.kind === 'client') openClient(suggestion.client.id);
    else openCase(suggestion.item);
    setQuery(''); setSearchOpen(false);
  };
  const caseSearch = () => <div className="case-search" ref={searchRef}>
    <label className="case-search-box"><Icon name="search" small/><input type="search" value={query} placeholder="Search a client or a case"
      aria-label="Search a client or a case" aria-expanded={searchOpen} aria-controls="case-search-results"
      aria-activedescendant={searchOpen && searchSuggestions.length ? `case-search-option-${searchActive}` : undefined}
      onFocus={() => setSearchOpen(true)} onChange={event => {setQuery(event.target.value);setSearchClients([]);setSearchCases([]);setSearchOpen(true);setSearchActive(0)}}
      onKeyDown={event => {
        if (event.key === 'Escape') {setQuery('');setSearchOpen(false);event.currentTarget.blur();}
        if (event.key === 'ArrowDown') {event.preventDefault();setSearchOpen(true);setSearchActive(index => Math.min(index+1,Math.max(0,searchSuggestions.length-1)));}
        if (event.key === 'ArrowUp') {event.preventDefault();setSearchActive(index => Math.max(0,index-1));}
        if (event.key === 'Enter' && searchOpen && searchSuggestions[searchActive]) {event.preventDefault();chooseSuggestion(searchSuggestions[searchActive]);}
      }}/></label>
    {searchOpen && <div className="case-search-results" id="case-search-results" role="listbox" aria-label="Cases search suggestions">
      {!query.trim() && <><div className="case-search-group">Recently opened</div>{recentSuggestions.map((suggestion,index) => searchItem(suggestion,index))}
        {attentionSuggestions.length > 0 && <div className="case-search-group">Needs attention</div>}{attentionSuggestions.map((suggestion,index) => searchItem(suggestion,index+recentSuggestions.length))}
        <div className="case-search-group">Most to bill</div>{topSuggestions.map((suggestion,index) => searchItem(suggestion,index+recentSuggestions.length+attentionSuggestions.length))}
        <p className="case-search-help">Type a client, a case, a reference such as 2025-031, or an opposing party.</p></>}
      {query.trim() && <>{searchClients.length > 0 && <div className="case-search-group">Clients</div>}
        {searchSuggestions.slice(0,searchClients.length).map((suggestion,index) => searchItem(suggestion,index))}
        {searchCases.length > 0 && <div className="case-search-group">Cases</div>}
        {searchSuggestions.slice(searchClients.length).map((suggestion,index) => searchItem(suggestion,index+searchClients.length))}
        {!searchSuggestions.length && <p className="case-search-help">No client or case matches “{query}”.</p>}</>}
    </div>}
  </div>;
  function searchItem(suggestion: Suggestion, index: number) {
    return <button type="button" role="option" id={`case-search-option-${index}`} aria-selected={searchActive === index}
      className="case-search-item" key={`${suggestion.kind}-${suggestion.kind === 'case' ? suggestion.item.id : suggestion.client.id}-${index}`}
      onMouseEnter={() => setSearchActive(index)} onClick={() => chooseSuggestion(suggestion)}>
      <span>{suggestion.kind === 'case' ? <><strong>{s.client.find(client => client.id === suggestion.item.client_id)?.name}</strong> · {suggestion.item.title} <MatterReference value={suggestion.item.reference}/></> : <strong>{suggestion.client.name}</strong>}</span>
      <small>{suggestion.caption}</small>
    </button>;
  }
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
    const allPeriods = core.periods.filter(period => !period.excluded && period.startedAt.slice(0,7) === today.slice(0,7) && period.startedAt.slice(0,10) <= today);
    const october = Math.ceil(allPeriods.reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0) / 60000);
    const clients = s.client.map(item => ({ item, metrics: clientMetrics(s, core, item.id) }));
    const toBill = clients.reduce((sum, row) => sum + row.metrics.toBill, 0);
    const maxToBill = Math.max(1, ...clients.map(row => row.metrics.toBill));
    const budgetAlerts = attentionRows.filter(row => (row.metrics.budgetPercent ?? 0) >= 85);
    const pendingAlerts = attentionRows.reduce((sum, row) => sum + row.metrics.pending, 0);
    const attentionCount = budgetAlerts.length + pendingAlerts;
    const prior = previousMonthMetrics(s, core, today);
    const openCases = s.matter.filter(item => item.status === 'open').length;
    body = <>
      {header('Cases', `An overview of your practice. Changes in % compare with the same period last month (${new Date(`${prior.previousDay}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',timeZone:'UTC'})} 1–${Number(prior.previousDay.slice(8))}).`, true)}
      {stats([['Needs attention', attentionCount, `${budgetAlerts.length} budget${budgetAlerts.length === 1 ? '' : 's'} · ${pendingAlerts} periods to validate`],
        ['To bill', money(toBill), 'All cases', delta(toBill, prior.previousToBill, prior.previousDay, false)],
        ['Cases', s.matter.length, `${s.client.length} clients · ${openCases} open`, delta(s.matter.length, prior.previousCases, prior.previousDay)],
        ['Time in October', formatRoundedMinutes(october), 'All cases', delta(october, prior.previousMinutes, prior.previousDay)]])}
      <div className="cases-dashboard cases-fill">
        <section className="card cases-clients"><div className="card-h"><div className="t"><h2>Clients</h2><p>{s.client.length} clients</p></div></div>
          <div className="case-scroll client-grid">{clients.map(({ item, metrics }) => <button className="client-tile" key={item.id} onClick={() => openClient(item.id)}>
            <div className="case-tile-top"><strong>{item.name}</strong><span className="muted">{item.type === 'company' ? 'Company' : 'Individual'}</span></div>
            <dl className="case-tile-facts"><div><dt>Cases</dt><dd>{metrics.cases.length}</dd></div><div><dt>Rate</dt><dd>{formatRate(item.rate_cents)}</dd></div><div><dt>To bill</dt><dd>{money(metrics.toBill)}</dd></div><div><dt>Last activity</dt><dd>{metrics.latest ? shortDate(metrics.latest) : '—'}</dd></div></dl>
          </button>)}</div>
        </section>
        <div className="cases-rail">
          <section className="card"><div className="card-h"><div className="t"><h2>Needs attention</h2><p>Do these first.</p></div></div>
            <div className="case-scroll attention-list">{attentionRows.length ? attentionRows.map(({item,metrics}) => {
              const client = s.client.find(owner => owner.id === item.client_id);
              const pendingIds = metrics.periods.filter(period => !period.timeValidated).map(period => period.id);
              return <div key={item.id}><span><strong>{client?.name} · {item.title} <MatterReference value={item.reference}/></strong><small>{reasons(item,metrics)}</small>
                {(metrics.budgetPercent ?? 0) >= 85 && <span className="bar"><span style={{width:`${Math.min(metrics.budgetPercent ?? 0,100)}%`}}/></span>}</span>
                <span className="case-attention-actions">{pendingIds.length > 0 && <button className="btn sm attn" onClick={() => void validatePeriods(pendingIds)}>Validate {pendingIds.length}</button>}<button className="btn sm" onClick={() => openCase(item)}>Open</button></span></div>;
            }) : <p>No cases need attention.</p>}</div>
          </section>
          <section className="card"><div className="card-h"><div className="t"><h2>To bill by client</h2><p>Open each client to review their cases</p></div></div>
            <div className="case-scroll bar-list">{[...clients].sort((a,b) => b.metrics.toBill-a.metrics.toBill).map(({item,metrics}) => <button key={item.id} onClick={() => openClient(item.id)}>
              <strong className="bar-client-name">{item.name}</strong>
              <span className="bar"><span style={{width:`${metrics.toBill*100/maxToBill}%`}}/></span>
              <span className="bar-amount">{money(metrics.toBill)}</span>
              <span className="bar-time">{formatRoundedMinutes(metrics.time)}</span>
            </button>)}</div>
          </section>
        </div>
      </div>
    </>;
  } else if (!currentCase) {
    const m = clientMetrics(s, core, currentClient.id);
    body = <>
      {header(currentClient.name, `${currentClient.type === 'company' ? 'Company' : 'Individual'} · ${formatRate(currentClient.rate_cents)} · billing address ${currentClient.billing_address}`)}
      {stats([['Cases', m.cases.length, `${m.cases.filter(item => item.status === 'open').length} open`], ['Time recorded', formatRoundedMinutes(m.time), 'All cases'], ['To bill', money(m.toBill), 'Before expenses'], ['To validate', m.pending, 'Work periods']])}
      <section className="card cases-fill"><div className="card-h"><div className="t"><h2>Cases</h2><p>{m.cases.length} cases for {currentClient.name}</p></div></div><div className="case-scroll case-grid">{m.cases.map(caseCard)}</div></section>
    </>;
  } else {
    const m = caseMetrics(s, core, currentCase);
    const sortKey = `${currentCase.id}:${tab}`;
    const sorting = sorts[sortKey];
    const changeSort = (column: number, numeric: boolean) => setSorts(old => ({...old,[sortKey]:{column,direction:old[sortKey]?.column === column ? old[sortKey]!.direction === 1 ? -1 : 1 : numeric ? -1 : 1}}));
    const sortedHeading = (label: string, column: number, numeric = false, right = false) => <th className={`${right ? 'r ' : ''}case-sortable`} scope="col"
      aria-sort={sorting?.column === column ? sorting.direction === 1 ? 'ascending' : 'descending' : undefined}>
      <button type="button" onClick={() => changeSort(column,numeric)}>{label}{sorting?.column === column ? sorting.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th>;
    const amountFor = (line: typeof m.periods[number]) => line.billingStatus === 'billed' || currentCase.mode === 'flat_fee' || !line.billable || effectiveMs(line) === null
      ? null : Math.round(effectiveMs(line)! * m.rate.rateCents / 3600000);
    const lines = [...m.periods].sort((a,b) => {
      if (!sorting) return b.startedAt.localeCompare(a.startedAt);
      const value = (line: typeof a) => [line.startedAt,line.label,effectiveMs(line),amountFor(line),line.timeValidated ? 'Validated' : 'To validate',line.billingStatus][sorting.column];
      const av = value(a), bv = value(b);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return sorting.direction * (typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av).localeCompare(String(bv)));
    });
    const markers = s.marker.filter(item => item.matter_id === currentCase.id && item.type !== 'client_name')
      .sort((a,b) => sorting && tab === 'markers' ? sorting.direction * (sorting.column === 1 ? a.type.localeCompare(b.type) : a.value.localeCompare(b.value)) : a.value.localeCompare(b.value));
    const exports = s.source_export.filter(item => {
      try { const ids = JSON.parse(item.time_entry_ids) as unknown; return Array.isArray(ids) && ids.some(id => s.time_entry.some(entry => String(entry.id) === String(id) && entry.matter_id === currentCase.id)); }
      catch { return false; }
    }).sort((a,b) => b.created_at.localeCompare(a.created_at));
    body = <>
      {header(currentCase.title, `${currentClient.name} · ${currentCase.category} · ${currentCase.reference}`)}
      {stats([['Time recorded', formatRoundedMinutes(m.time), `${lines.length} periods`], ['To bill', money(m.toBill), 'Before expenses'], ['Not billable', formatRoundedMinutes(m.nonBillable), 'Recorded time'], [currentCase.mode === 'flat_fee' ? 'Flat fee used' : 'Budget used', m.budgetPercent === null ? '—' : percent(m.budgetPercent), m.budget ? `${money(m.spent)} of ${money(m.budget)}` : 'No budget set']])}
      <section className="card case-facts-card"><dl className="facts case-facts"><div><dt>Pricing</dt><dd>{currentCase.mode === 'flat_fee' ? `Flat fee ${money(currentCase.flat_fee_cents ?? 0)}` : formatRate(m.rate.rateCents)}</dd></div>
        <div><dt>Opposing party</dt><dd>{currentCase.opposing_party || '—'}</dd></div><div><dt>Case number</dt><dd>{currentCase.case_number || '—'}</dd></div>
        <div><dt>Opened</dt><dd>{shortDate(currentCase.opened_on)} {currentCase.opened_on.slice(0,4)}</dd></div></dl>
        {m.budgetPercent !== null && <div className="card-b budget"><div className="row between"><span>{currentCase.mode === 'flat_fee' ? 'Flat fee used' : 'Budget used'}</span><span>{money(m.spent)} of {money(m.budget ?? 0)} · {percent(m.budgetPercent)}</span></div><div className="bar"><span style={{width:`${Math.min(m.budgetPercent,100)}%`}}/></div>{m.budgetPercent >= 85 && <span className="flag"><Icon name="alert" small/>Above 85%. Let the client know.</span>}</div>}
      </section>
      <section className="card cases-fill case-detail-list"><div className="toolbar"><div className="tabs" role="tablist" aria-label="Case sections"><button role="tab" aria-selected={tab === 'time'} onClick={() => setTab('time')}>Time ({lines.length})</button><button role="tab" aria-selected={tab === 'markers'} onClick={() => setTab('markers')}>Markers ({markers.length})</button><button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>Source packs ({exports.length})</button></div>
        {tab === 'time' && m.pending > 0 && <button className="btn sm attn" onClick={() => void validatePeriods(m.periods.filter(period => !period.timeValidated).map(period => period.id))}>Validate all ({m.pending})</button>}</div>
        {tab === 'time' ? <div className="tbl"><table><thead><tr>{sortedHeading('Date',0,true)}{sortedHeading('Work performed',1)}{sortedHeading('Duration',2,true,true)}{sortedHeading('Amount',3,true,true)}{sortedHeading('Time',4)}{sortedHeading('Billing',5)}<th scope="col">Actions</th></tr></thead><tbody>
          {lines.map(line => <tr key={line.id} className={core.sources.some(record => record.workPeriodId === line.id) ? 'click' : ''} onClick={() => {if(core.sources.some(record => record.workPeriodId === line.id)) source(line.id);}}>
            <td>{shortDate(line.startedAt)}</td><td className="wrap">{line.label}<span className="sub">{s.task.find(task => task.id === line.taskTypeId)?.label ?? 'Work period'}</span></td>
            <td className="r num">{formatPreciseDuration(effectiveMs(line))}</td><td className="r num">{line.billingStatus === 'billed' ? 'In invoice' : currentCase.mode === 'flat_fee' ? 'Flat fee' : line.billable && effectiveMs(line) !== null ? money(Math.round(effectiveMs(line)! * m.rate.rateCents / 3600000)) : '—'}</td>
            <td>{line.timeValidated ? <span className="st ok"><i/>Validated</span> : <span className="st warn"><i/>To validate</span>}</td><td>{line.billable ? line.billingStatus === 'billed' ? 'Billed' : 'Unbilled' : 'Not billable'}</td>
            <td>{!line.timeValidated && <button className="btn sm attn" onClick={event => {event.stopPropagation();void validatePeriods([line.id]);}}>Validate</button>}</td>
          </tr>)}</tbody></table></div> : tab === 'markers' ? <><div className="card-b muted marker-intro">Names, files and words that tell TimeKeeper this work belongs to this case.</div><div className="tbl"><table><thead><tr>{sortedHeading('Marker',0)}{sortedHeading('Type',1)}<th scope="col">Actions</th></tr></thead><tbody>
            {markers.map(marker => <tr key={marker.id}><td>{marker.value}</td><td>{marker.type.replace(/_/g,' ')}{marker.learned ? ' · learned from you' : ''}</td><td><button className="btn sm" aria-label={`Remove ${marker.value}`} onClick={() => action(api.DELETE('/api/markers/{id}', {params:{path:{id:marker.id}}}))}>Remove</button></td></tr>)}
          </tbody></table></div><div className="card-b row"><select className="field" aria-label="Marker type" value={markerType} onChange={event => setMarkerType(event.target.value as typeof markerType)}>{(['case_number','opposing_party','file','email','domain','keyword'] as const).map(type => <option key={type} value={type}>{type}</option>)}</select><input className="field grow" aria-label="New marker" placeholder="Name, file, keyword…" value={markerValue} onChange={event => setMarkerValue(event.target.value)}/><button className="btn sm" onClick={async () => {if(markerValue.trim()) {await action(api.POST('/api/markers',{body:{matter_id:currentCase.id,type:markerType,value:markerValue.trim()}}));setMarkerValue('');}}}>Add marker</button></div></> : <div className="case-scroll card-b">{exports.length ? exports.map(item => <p key={item.id}>Source pack created {shortDate(item.created_at)} · SHA-256 {item.sha256}</p>) : <p>No source packs yet.</p>}</div>}
      </section>
    </>;
  }
  return <>{body}{notice && <div role="status" className="toast">{notice}</div>}{pack && currentCase && <SourcePackDialog s={s} matterId={currentCase.id} action={action} close={() => setPack(false)}/>}{adding && <div className="modal-back"><form className="modal glass pad col" onSubmit={async event => {event.preventDefault();const created = await action(api.POST('/api/matters',{body:{client_id:newClientId,title:name,opposing_party:adverse}}));if(created){setAdding(false);setName('');setAdverse('');openCase(created);}}}>
    <h2>New case</h2><label>Client <select className="field" value={newClientId} onChange={event => setNewClientId(Number(event.target.value))}>{s.client.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Title <input className="field" required value={name} onChange={event => setName(event.target.value)}/></label><label>Opposing party <input className="field" value={adverse} onChange={event => setAdverse(event.target.value)}/></label>
    <div className="row"><button className="btn primary">Create</button><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button></div>
  </form></div>}</>;
}
