import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, client, matter, money, today, type CoreState, type Recognition, type ScreenProps, type State } from '../../api/client';
import { dayFees, effectiveMs, formatPreciseDuration, formatRoundedMinutes, hasCoverageGap, summarizeWork } from '../../calculations/billing';
import { MatterSelect } from '../../shared/components/MatterSelect';
import { Kpi } from '../../shared/components/Kpi';
import { Icon } from '../../shared/components/Icon';
import { MatterReference } from '../../shared/components/MatterReference';
import { longDate } from '../../shared/format';
import './MyDay.css';

type Filter = 'all' | 'review' | 'validated' | 'left';
type DayData = Pick<CoreState, 'periods' | 'coverageGaps' | 'questions'> & { date: string; state: State };
type SortDirection = 'ascending' | 'descending';
type SortState<Key extends string> = { key: Key; direction: SortDirection } | null;
type Period = CoreState['periods'][number];
type Gap = CoreState['coverageGaps'][number];
type MainRow = { kind: 'period'; period: Period } | { kind: 'gap'; gap: Gap };
type MainKey = 'period' | 'case' | 'work' | 'duration' | 'status';
type LeftKey = 'time' | 'application' | 'work' | 'duration';
let rememberedMainSort: SortState<MainKey> = null;
let rememberedLeftSort: SortState<LeftKey> = null;

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const compareText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
const dayDate = (date: string) => new Date(`${date}T12:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shiftDay = (date: string, amount: number) => { const next = dayDate(date); next.setUTCDate(next.getUTCDate() + amount); return iso(next); };
const shiftMonth = (month: string, amount: number) => { const next = dayDate(`${month}-01`); next.setUTCMonth(next.getUTCMonth() + amount); return iso(next).slice(0, 7); };
const monthEnd = (month: string) => { const next = dayDate(`${month}-01`); next.setUTCMonth(next.getUTCMonth() + 1, 0); return iso(next); };
const sortNext = <Key extends string>(current: SortState<Key>, key: Key, numeric: boolean): SortState<Key> => ({
  key, direction: current?.key === key && current.direction === 'ascending' ? 'descending' : current?.key === key && current.direction === 'descending' ? 'ascending' : numeric ? 'descending' : 'ascending',
});
const compareNullable = (a: number | null, b: number | null, direction: SortDirection) => {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return direction === 'ascending' ? a - b : b - a;
};

function DayCalendar({ selected, recorded, pending, onSelect, onMonthChange }: { selected: string; recorded: Set<string>; pending: Set<string>; onSelect: (date: string) => void; onMonthChange: (month: string) => void }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(selected.slice(0, 7));
  const wrapper = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMonth(selected.slice(0, 7)); }, [selected]);
  useEffect(() => { onMonthChange(month); }, [month, onMonthChange]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); wrapper.current?.querySelector<HTMLButtonElement>('.datebtn')?.focus(); } };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, [open]);
  useEffect(() => { if (open) selectedRef.current?.focus(); }, [open, month]);
  const choose = (date: string) => { onSelect(date); setOpen(false); wrapper.current?.querySelector<HTMLButtonElement>('.datebtn')?.focus(); };
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const target = shiftDay(date, step);
    if (target > today) return;
    if (target.slice(0, 7) !== month) setMonth(target.slice(0, 7));
    requestAnimationFrame(() => wrapper.current?.querySelector<HTMLButtonElement>(`[data-calendar-day="${target}"]`)?.focus());
  };
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const first = dayDate(`${month}-01`);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Number(monthEnd(month).slice(8, 10));
  const years = Array.from({ length: Number(today.slice(0, 4)) - Math.min(2020, year) + 1 }, (_, index) => Number(today.slice(0, 4)) - index);
  const nextMonth = shiftMonth(month, 1);
  const otherPendingDays = [...pending].filter(date => date !== selected).length;
  return <div className="daypick" role="group" aria-label="Choose a day">
    <button className="iconbtn" aria-label="Previous day" onClick={() => choose(shiftDay(selected, -1))}><span aria-hidden="true">‹</span></button>
    <div className="calwrap" ref={wrapper}>
      <button className="datebtn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>{shortDay.format(dayDate(selected))}<Icon name="day" small />{otherPendingDays > 0 && <span className="datebadge" title={`${otherPendingDays} other day${otherPendingDays === 1 ? '' : 's'} with periods to validate`}>{otherPendingDays}</span>}</button>
      {open && <div className="cal" role="dialog" aria-label="Choose a day">
        <div className="calhd">
          <button className="iconbtn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><span aria-hidden="true">‹</span></button>
          <select className="select sm" aria-label="Month" value={monthIndex} onChange={event => setMonth(`${year}-${String(Number(event.target.value) + 1).padStart(2, '0')}`)}>
            {months.map((name, index) => <option key={name} value={index} disabled={`${year}-${String(index + 1).padStart(2, '0')}` > today.slice(0, 7)}>{name}</option>)}
          </select>
          <select className="select sm" aria-label="Year" value={year} onChange={event => {
            const chosen = Number(event.target.value);
            const chosenMonth = chosen === Number(today.slice(0, 4)) ? Math.min(monthIndex, Number(today.slice(5, 7)) - 1) : monthIndex;
            setMonth(`${chosen}-${String(chosenMonth + 1).padStart(2, '0')}`);
          }}>{years.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <button className="iconbtn" aria-label="Next month" disabled={nextMonth > today.slice(0, 7)} onClick={() => setMonth(nextMonth)}><span aria-hidden="true">›</span></button>
        </div>
        <div className="calgrid" role="group" aria-label={`${months[monthIndex]} ${year}`}>
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(name => <span className="dow" key={name}>{name}</span>)}
          {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
          {Array.from({ length: days }, (_, index) => {
            const date = `${month}-${String(index + 1).padStart(2, '0')}`;
            const selectedDay = date === selected;
            const future = date > today;
            const noWork = !future && !recorded.has(date);
            return <button key={date} type="button" ref={selectedDay ? selectedRef : undefined} className={`cday${selectedDay ? ' sel' : ''}${date === today ? ' today' : ''}${noWork ? ' off' : ''}`}
              data-calendar-day={date} disabled={future} aria-label={`${longDate(date)}${pending.has(date) ? ', to validate' : recorded.has(date) ? ', validated' : noWork ? ', no work recorded' : ''}`} aria-current={selectedDay ? 'date' : undefined}
              onKeyDown={event => moveFocus(event, date)} onClick={() => choose(date)}>{index + 1}{pending.has(date) ? <i className="p" aria-hidden="true" /> : recorded.has(date) ? <i aria-hidden="true" /> : null}</button>;
          })}
        </div>
        <div className="calft"><div className="calkey"><span><i className="dotk" aria-hidden="true" />Validated</span><span><i className="dotk p" aria-hidden="true" />To validate</span><span>Grey: no work</span></div><button className="btn sm" onClick={() => choose(today)}>Today</button></div>
      </div>}
    </div>
    <button className="iconbtn" aria-label="Next day" disabled={selected >= today} onClick={() => choose(shiftDay(selected, 1))}><span aria-hidden="true">›</span></button>
    {selected !== today && <button className="btn sm" onClick={() => choose(today)}>Today</button>}
  </div>;
}

function SortHeader<Key extends string>({ label, sort, sortKey, numeric, onSort, className = '' }: {
  label: string; sort: SortState<Key>; sortKey: Key; numeric?: boolean; onSort: (key: Key, numeric: boolean) => void; className?: string;
}) {
  return <th scope="col" className={`sortable ${className}`} aria-sort={sort?.key === sortKey ? sort.direction : undefined}>
    <button className="day-sort" onClick={() => onSort(sortKey, !!numeric)}>{label}</button>
  </th>;
}

export function MyDay({ s, core, action, source, refresh }: ScreenProps) {
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [recorded, setRecorded] = useState<Set<string>>(new Set());
  const pendingDays = new Set(core.periods.filter(period => !period.excluded && !period.timeValidated && period.startedAt.slice(0, 10) <= today).map(period => period.startedAt.slice(0, 10)));
  const [dayData, setDayData] = useState<DayData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [mainSort, setMainSort] = useState<SortState<MainKey>>(rememberedMainSort);
  const [leftSort, setLeftSort] = useState<SortState<LeftKey>>(rememberedLeftSort);
  const [editing, setEditing] = useState<string | null>(null);
  const [minutes, setMinutes] = useState('');
  const [manual, setManual] = useState(false);
  const [manualCase, setManualCase] = useState(s.matter[0]?.id ?? 1);
  const [manualTask, setManualTask] = useState(s.task.find(task => task.off_screen)?.id ?? s.task[0]?.id ?? 1);
  const [manualMinutes, setManualMinutes] = useState('60');
  const [manualLabel, setManualLabel] = useState('Case management hearing');
  const [answerCase, setAnswerCase] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, Recognition>>({});
  const [notice, setNotice] = useState('');
  const [validating, setValidating] = useState(false);
  const changeMainSort = (key: MainKey, numeric: boolean) => setMainSort(current => { rememberedMainSort = sortNext(current, key, numeric); return rememberedMainSort; });
  const changeLeftSort = (key: LeftKey, numeric: boolean) => setLeftSort(current => { rememberedLeftSort = sortNext(current, key, numeric); return rememberedLeftSort; });
  useEffect(() => { setMonth(selectedDate.slice(0, 7)); setFilter('all'); }, [selectedDate]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const [state, periods, coverageGaps, questions] = await Promise.all([
        api.GET('/api/state', { params: { query: { date: selectedDate } } }),
        api.GET('/api/work-periods', { params: { query: { date: selectedDate } } }),
        api.GET('/api/coverage-gaps', { params: { query: { date: selectedDate } } }),
        api.GET('/api/questions', { params: { query: { date: selectedDate } } }),
      ]);
      if ([state, periods, coverageGaps, questions].some(result => result.error)) throw Error('Could not load this day.');
      if (live) { setDayData({ date: selectedDate, state: state.data ?? s, periods: periods.data ?? [], coverageGaps: coverageGaps.data ?? [], questions: questions.data ?? [] }); setLoadError(''); }
    };
    void load().catch(error => { if (live) setLoadError(String(error)); });
    return () => { live = false; };
  }, [selectedDate, core]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const result = await api.GET('/api/work-periods', { params: { query: { from: `${month}-01`, to: monthEnd(month) } } });
      if (live && !result.error) setRecorded(new Set((result.data ?? []).filter(period => !period.excluded).map(period => period.startedAt.slice(0, 10))));
    };
    void load();
    return () => { live = false; };
  }, [month, core]);
  const data = dayData?.date === selectedDate ? dayData : null;
  const periods = data?.periods ?? [];
  const included = periods.filter(period => !period.excluded);
  const excluded = periods.filter(period => period.excluded);
  const review = included.filter(period => !period.timeValidated || !period.caseId);
  const validated = included.filter(period => period.timeValidated && period.caseId);
  const shown = filter === 'review' ? review : filter === 'validated' ? validated : included;
  const coverageGaps = data?.coverageGaps ?? [];
  const summary = summarizeWork(included, core.sources);
  const fees = dayFees(s, core, included);
  const unresolved = included.filter(period => !period.caseId);
  const recognized = review.filter(period => period.caseId && period.demoApp);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3500);return()=>window.clearTimeout(timer)},[notice]);
  const notRecordedMs = coverageGaps.reduce((total, gap) => total + Math.max(0, Date.parse(gap.endedAt) - Date.parse(gap.startedAt)), 0);
  useEffect(() => {
    let live = true;
    const pending = (dayData?.date === selectedDate ? dayData.periods : []).filter(period => !period.excluded && !period.caseId);
    void Promise.all(pending.map(async period => {
      const old = dayData?.state.time_entry.find(entry => String(entry.id) === period.id);
      if (!old?.block_id) return null;
      const result = await api.GET('/api/blocks/{id}/recognition', { params: { path: { id: old.block_id } } });
      return result.data ? [period.id, result.data] as const : null;
    })).then(items => { if (live) setSuggestions(Object.fromEntries(items.filter(item => item !== null) as Array<readonly [string, Recognition]>)); });
    return () => { live = false; };
  }, [selectedDate, dayData]);
  const questionFor = (periodId: string) => data?.questions.find(question => question.periodId === periodId && question.status === 'pending');
  const assign = (periodId: string, caseId: number) => {
    const period = periods.find(item => item.id === periodId);
    if (!period) return;
    const question = questionFor(periodId);
    if (question) return action(api.POST('/api/questions/answer', { body: { questionId: question.questionId, sessionId: question.sessionId,
      periodId, expectedAssignmentRevision: question.expectedAssignmentRevision, caseId: String(caseId), responseCommandId: crypto.randomUUID() } }));
    if (!period.caseId) return;
    return action(api.POST('/api/work-periods/{id}/assignment', { params: { path: { id: periodId } }, body: {
      caseId: String(caseId), expectedAssignmentRevision: period.assignmentRevision, origin: 'lawyer' } }));
  };
  const saveDuration = (periodId: string) => {
    const parsed = Number(minutes);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    void action(api.POST('/api/work-periods/{id}/duration-override', { params: { path: { id: periodId } }, body: { durationMs: Math.round(parsed * 60000) } }));
    setEditing(null);
  };
  const validate = async (target: Period[]) => {
    if (validating || !target.length) return;
    setValidating(true);
    try {
      const results = await Promise.allSettled(target.map(period => api.POST('/api/work-periods/{id}/validate-time', { params: { path: { id: period.id } }, body: {} })));
      const successful = results.filter(result => result.status === 'fulfilled' && !result.value.error).length;
      if (successful) await refresh();
      setNotice(successful === target.length ? `${successful} ${successful === 1 ? 'period' : 'periods'} validated` : `${successful} of ${target.length} periods validated. Please retry the rest.`);
    } catch (error) { setNotice(String(error)); }
    finally { setValidating(false); }
  };
  const tabs: [Filter, string, number][] = [['all', 'All', included.length], ['review', 'To validate', review.length], ['validated', 'Validated', validated.length], ['left', 'Left out', excluded.length]];
  const mainRows: MainRow[] = [...shown.map(period => ({ kind: 'period' as const, period })), ...(filter === 'all' ? coverageGaps.map(gap => ({ kind: 'gap' as const, gap })) : [])];
  const comparePeriod = (a: Period, b: Period, key: MainKey | LeftKey, direction: SortDirection) => {
    if (key === 'duration') return compareNullable(effectiveMs(a), effectiveMs(b), direction);
    if (key === 'status') return compareText(a.timeValidated ? 'Validated' : 'To validate', b.timeValidated ? 'Validated' : 'To validate') * (direction === 'ascending' ? 1 : -1);
    const label = (period: Period) => {
      const item = matter(s, period.caseId ? Number(period.caseId) : null);
      const owner = client(s, period.caseId ? Number(period.caseId) : null);
      if (key === 'case') return `${owner?.name ?? ''} ${item?.title ?? ''}`;
      if (key === 'work') return period.label;
      if (key === 'application') return period.demoApp ?? '';
      return period.startedAt;
    };
    return compareText(label(a), label(b)) * (direction === 'ascending' ? 1 : -1);
  };
  mainRows.sort((a, b) => {
    if (a.kind === 'gap') return b.kind === 'gap' ? compareText(a.gap.startedAt, b.gap.startedAt) : 1;
    if (b.kind === 'gap') return -1;
    return comparePeriod(a.period, b.period, mainSort?.key ?? 'period', mainSort?.direction ?? 'ascending');
  });
  const leftRows = [...excluded].sort((a, b) => comparePeriod(a, b, leftSort?.key ?? 'time', leftSort?.direction ?? 'ascending'));
  return <>
    <div className="ph"><div className="t"><h1>My day</h1><p>{longDate(selectedDate)}{selectedDate === today ? ' · today' : ''}</p></div>
      <div className="actions"><DayCalendar selected={selectedDate} recorded={recorded} pending={pendingDays} onSelect={setSelectedDate} onMonthChange={setMonth} />
        <button className="btn" onClick={() => setManual(true)}><Icon name="plus" small />Add a hearing or meeting</button></div></div>
    {loadError && <p className="day-load-error" role="alert">{loadError}</p>}
    <div className="grid4">
      <Kpi title="Time today" value={formatRoundedMinutes(summary.roundedMinutes)} detail="Worked and recorded" />
      <Kpi title="Fees today" value={money(fees)} detail="Before expenses" />
      <Kpi title="Not recorded" value={formatRoundedMinutes(Math.ceil(notRecordedMs / 60000))} detail={coverageGaps.length ? `${coverageGaps[0]!.startedAt.slice(11, 16)}–${coverageGaps[0]!.endedAt.slice(11, 16)} · not counted` : 'No coverage gap'} />
      <Kpi title="To validate" value={review.length} detail="Periods" />
    </div>
    <div className="day-prompts">
      <section className="card day-ready"><div><h2>Your day is ready.</h2><p>{recognized.length ? `TimeKeeper recognized ${recognized.length} periods on their own. ${unresolved.length ? `${unresolved.length} needs one answer from you.` : 'Nothing needs your answer.'} Check them below, then validate in one click.` : 'All recognized periods are validated.'}</p></div>
        {recognized.length > 0 && <button className="btn attn" disabled={validating} onClick={() => void validate(recognized)}>Validate the {recognized.length} recognized periods</button>}
      </section>
      <section className="card day-question"><div><h2><Icon name="alert" small /> Which case was this?</h2>
        {unresolved[0] ? <p>{unresolved[0].startedAt.slice(11, 16)}–{unresolved[0].endedAt?.slice(11, 16)} · {unresolved[0].demoWindowTitle ?? unresolved[0].label}</p> : <p>Every period has a case. You can review the list below.</p>}</div>
        {unresolved[0] && <div className="row"><MatterSelect s={s} value={answerCase} allowEmpty onChange={setAnswerCase} /><button className="btn primary" disabled={!answerCase} onClick={() => { if (answerCase) void assign(unresolved[0]!.id, answerCase); }}>Answer</button>
          <button className="btn" onClick={() => void action(api.PATCH('/api/work-periods/{id}/details', { params: { path: { id: unresolved[0]!.id } }, body: { excluded: true } }))}>Not client work</button></div>}
      </section>
    </div>
    <section className="card day-periods"><div className="toolbar"><div className="seg" role="group" aria-label="Work periods filter">
      {tabs.map(([key, title, count]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{title}<span className="c">{count}</span></button>)}
    </div></div>
      {!data && !loadError ? <div className="empty" role="status"><b>Loading day…</b></div> : filter === 'left' ? <div className="tbl"><table><thead><tr>
        <SortHeader label="Time" sort={leftSort} sortKey="time" numeric onSort={changeLeftSort} />
        <SortHeader label="Application" sort={leftSort} sortKey="application" onSort={changeLeftSort} />
        <SortHeader label="Work observed" sort={leftSort} sortKey="work" onSort={changeLeftSort} />
        <SortHeader label="Duration" sort={leftSort} sortKey="duration" numeric className="r" onSort={changeLeftSort} /><th>Actions</th>
      </tr></thead><tbody>{leftRows.map(period => <tr key={period.id}><td className="num">{period.startedAt.slice(11, 16)}–{period.endedAt?.slice(11, 16) ?? '…'}</td><td>{period.demoApp ?? '—'}</td>
        <td>{period.demoWindowTitle ?? period.label}</td><td className="r num">{formatPreciseDuration(effectiveMs(period))}</td><td><button className="btn sm" onClick={() => void action(api.PATCH('/api/work-periods/{id}/details', { params: { path: { id: period.id } }, body: { excluded: false } }))}>Count as work</button></td></tr>)}</tbody></table>
        {!excluded.length && <div className="empty"><b>No periods left out</b></div>}</div>
      : <div className="tbl day-table"><table><thead><tr>
        <SortHeader label="Period" sort={mainSort} sortKey="period" numeric onSort={changeMainSort} />
        <SortHeader label="Client · case" sort={mainSort} sortKey="case" onSort={changeMainSort} />
        <SortHeader label="Work performed" sort={mainSort} sortKey="work" onSort={changeMainSort} />
        <SortHeader label="Duration" sort={mainSort} sortKey="duration" numeric className="r" onSort={changeMainSort} />
        <th>Actions</th>
      </tr></thead><tbody>{mainRows.map(row => {
        if (row.kind === 'gap') return <tr key={row.gap.id}><td className="num muted">{row.gap.startedAt.slice(11, 16)}–{row.gap.endedAt.slice(11, 16)}</td><td colSpan={4}><span className="flag"><Icon name="alert" small />Coverage gap</span> <span className="muted">· not recorded or counted as work.</span></td></tr>;
        const period = row.period;
        const caseId = period.caseId ? Number(period.caseId) : null;
        const item = matter(s, caseId), owner = client(s, caseId);
        const linked = core.sources.filter(record => record.workPeriodId === period.id);
        const validatedSources = linked.filter(record => record.validationStatus === 'validated').length;
        const candidate = suggestions[period.id]?.candidates[0], suggestion = candidate ? matter(s, candidate.matter_id) : undefined;
        return <tr key={period.id}>
          <td className="num">{period.startedAt.slice(11, 16)}–{period.endedAt?.slice(11, 16) ?? '…'}<span className="sub">{period.demoApp ?? 'Off-screen'}</span></td>
          <td>{item ? <>{owner?.name}<span className="sub">{item.title} · <MatterReference value={item.reference} /></span></> : <><span className="flag"><Icon name="alert" small />Unresolved</span><span className="sub">Answer above</span>{suggestion && <span className="sub suggest">Suggested: {suggestion.title} <button className="link" onClick={() => assign(period.id, suggestion.id)}>Assign</button></span>}</>}</td>
          <td className="wrap">{period.label}<span className="sub">{s.task.find(task => task.id === period.taskTypeId)?.label ?? 'Work period'} · {period.billable ? 'Billable' : period.nonbillableReason ?? 'Not billable'}</span></td>
          <td className="r num">{editing === period.id ? <span className="row"><input className="field" type="number" min="0" step="0.001" aria-label="Corrected minutes" value={minutes} onChange={event => setMinutes(event.target.value)} /><button className="btn sm primary" onClick={() => saveDuration(period.id)}>Save</button><button className="btn sm" onClick={() => setEditing(null)}>Cancel</button></span>
            : <button className="day-duration" disabled={period.billingStatus === 'billed'} aria-label={`Correct duration for ${period.label}`} title="Correct duration" onClick={() => { setEditing(period.id); setMinutes(String((effectiveMs(period) ?? 0) / 60000)); }}>{formatPreciseDuration(effectiveMs(period))}</button>}
            {period.durationOverrideMs !== null && <span className="sub">was {formatPreciseDuration(period.detectedDurationMs)}</span>}</td>
          <td><div className="day-actions">{period.timeValidated ? <span className="day-validated">✓ Validated</span> : period.caseId ? <button className="btn sm attn" disabled={validating} onClick={() => void validate([period])}>Validate</button> : null}
            <button className="btn sm" disabled={!linked.length} onClick={() => source(period.id)}>Sources</button></div></td>
        </tr>;
      })}</tbody></table>{!mainRows.length && <div className="empty"><b>{!included.length && !coverageGaps.length ? 'No work recorded' : 'Nothing waiting'}</b><p>{!included.length && !coverageGaps.length ? 'Nothing was recorded on this day.' : 'Every period of this day is validated.'}</p></div>}</div>}
    </section>
    {notice && <div className="day-toast" role="status" onClick={() => setNotice('')}>{notice} ×</div>}
    {manual && <div className="modal-back"><form className="modal glass pad col" onSubmit={event => {
      event.preventDefault(); if (!core.activeSession) return;
      const durationMs = Math.round(Number(manualMinutes) * 60000);
      if (!Number.isSafeInteger(durationMs) || durationMs < 0) return;
      const start = `${selectedDate}T17:${String(periods.filter(period => period.startedAt.startsWith(`${selectedDate}T17:`)).length).padStart(2, '0')}:00Z`;
      void action(api.POST('/api/work-periods/manual', { body: { sessionId: core.activeSession.id, caseId: String(manualCase), startedAt: start, durationMs, taskTypeId: manualTask, label: manualLabel } }));
      setManual(false);
    }}><h2>Add a hearing or meeting</h2><p>This creates a manual period without a source. Validate its time separately.</p>
      <label>Case <MatterSelect s={s} value={manualCase} onChange={id => { if (id) setManualCase(id); }} /></label>
      <label>Task <select className="field" value={manualTask} onChange={event => setManualTask(Number(event.target.value))}>{s.task.filter(task => task.off_screen).map(task => <option key={task.id} value={task.id}>{task.label}</option>)}</select></label>
      <label>Minutes <input className="field" type="number" min="0" step="0.001" value={manualMinutes} onChange={event => setManualMinutes(event.target.value)} /></label>
      <label>Label <input className="field" value={manualLabel} onChange={event => setManualLabel(event.target.value)} /></label>
      <div className="row"><button className="btn primary" disabled={!core.activeSession}>Add</button><button type="button" className="btn" onClick={() => setManual(false)}>Cancel</button></div>
    </form></div>}
  </>;
}
