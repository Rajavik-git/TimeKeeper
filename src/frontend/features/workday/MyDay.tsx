import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, client, matter, money, today, type CoreState, type ScreenProps, type State } from '../../api/client';
import { dayFees, effectiveMs, formatPreciseDuration, formatRoundedMinutes, hasCoverageGap, summarizeWork } from '../../calculations/billing';
import { MatterSelect } from '../../shared/components/MatterSelect';
import { Kpi } from '../../shared/components/Kpi';
import { Icon } from '../../shared/components/Icon';
import { MatterReference } from '../../shared/components/MatterReference';
import { showToast } from '../../shared/components/Toast';
import { longDate, shortDate } from '../../shared/format';
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
const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
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
    <button className="iconbtn previous-day" aria-label="Previous day" onClick={() => choose(shiftDay(selected, -1))}><Icon name="chev" small /></button>
    <div className="calwrap" ref={wrapper}>
      <button className="datebtn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>{shortDay.format(dayDate(selected))}<Icon name="day" small />{otherPendingDays > 0 && <span className="datebadge" title={`${otherPendingDays} other day${otherPendingDays === 1 ? '' : 's'} with periods to validate (${[...pending].filter(date => date !== selected).map(shortDate).join(', ')})`}>{otherPendingDays}</span>}</button>
      {open && <div className="cal" role="dialog" aria-label="Choose a day">
        <div className="calhd">
          <button className="iconbtn previous-month" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="chev" small /></button>
          <select className="select sm" aria-label="Month" value={monthIndex} onChange={event => setMonth(`${year}-${String(Number(event.target.value) + 1).padStart(2, '0')}`)}>
            {months.map((name, index) => <option key={name} value={index} disabled={`${year}-${String(index + 1).padStart(2, '0')}` > today.slice(0, 7)}>{name}</option>)}
          </select>
          <select className="select sm" aria-label="Year" value={year} onChange={event => {
            const chosen = Number(event.target.value);
            const chosenMonth = chosen === Number(today.slice(0, 4)) ? Math.min(monthIndex, Number(today.slice(5, 7)) - 1) : monthIndex;
            setMonth(`${chosen}-${String(chosenMonth + 1).padStart(2, '0')}`);
          }}>{years.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <button className="iconbtn" aria-label="Next month" disabled={nextMonth > today.slice(0, 7)} onClick={() => setMonth(nextMonth)}><Icon name="chev" small /></button>
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
        <div className="calft"><div className="calkey"><span><i className="dotk" aria-hidden="true" />Validated</span><span><i className="dotk p" aria-hidden="true" />To validate</span><span>Hatched: no recording</span></div><button className="btn sm" onClick={() => choose(today)}>Today</button></div>
      </div>}
    </div>
    <button className="iconbtn" aria-label="Next day" title={selected >= today ? 'No later days' : 'Next day'} disabled={selected >= today} onClick={() => choose(shiftDay(selected, 1))}><Icon name="chev" small /></button>
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

export function MyDay({ s, core, action, source, refresh, navigate, returnFocusId, onFocusReturned }: ScreenProps & { returnFocusId?: string | null; onFocusReturned?: () => void }) {
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
  const [manualSaving, setManualSaving] = useState(false);
  const [durationSaving, setDurationSaving] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const [recentlyAssigned, setRecentlyAssigned] = useState<string | null>(null);
  const manualDialog = useRef<HTMLFormElement>(null);
  const manualOpener = useRef<HTMLElement | null>(null);
  const openManual = (opener: HTMLElement) => { manualOpener.current = opener; setManual(true); };
  const closeManual = () => { setManual(false); requestAnimationFrame(() => manualOpener.current?.focus()); };
  const [filterOpen, setFilterOpen] = useState(false);
  const [clientFilter, setClientFilter] = useState('');
  const [caseFilter, setCaseFilter] = useState('');
  const filterWrap = useRef<HTMLDivElement>(null);
  const [manualCase, setManualCase] = useState(s.matter[0]?.id ?? 1);
  const [manualTask, setManualTask] = useState(s.task.find(task => task.off_screen)?.id ?? s.task[0]?.id ?? 1);
  const [manualMinutes, setManualMinutes] = useState('60');
  const [manualLabel, setManualLabel] = useState('Case management hearing');
  const [answerCase, setAnswerCase] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [focusQuestionAfterValidation, setFocusQuestionAfterValidation] = useState(false);
  const [answering, setAnswering] = useState(false);
  const questionCard = useRef<HTMLElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [hasMoreRows, setHasMoreRows] = useState(false);
  useEffect(() => {
    if (!validating && focusQuestionAfterValidation) {
      questionCard.current?.focus();
      setFocusQuestionAfterValidation(false);
    }
  }, [validating, focusQuestionAfterValidation]);
  useEffect(() => { if (manual) manualDialog.current?.querySelector<HTMLElement>('select, input')?.focus(); }, [manual]);
  useEffect(() => {
    if (!manual) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [manual]);
  useEffect(() => {
    if (!filterOpen) return;
    const close = (event: PointerEvent) => { if (!filterWrap.current?.contains(event.target as Node)) setFilterOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setFilterOpen(false); filterWrap.current?.querySelector<HTMLButtonElement>('.day-filter-toggle')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [filterOpen]);
  const changeMainSort = (key: MainKey, numeric: boolean) => { setMainSort(current => { rememberedMainSort = sortNext(current, key, numeric); return rememberedMainSort; }); };
  const changeLeftSort = (key: LeftKey, numeric: boolean) => { setLeftSort(current => { rememberedLeftSort = sortNext(current, key, numeric); return rememberedLeftSort; }); };
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
  useEffect(() => {
    if (!data || !returnFocusId) return;
    const button = document.querySelector<HTMLButtonElement>(`[data-source-period-id="${CSS.escape(returnFocusId)}"]`);
    button?.focus();
    onFocusReturned?.();
  }, [data, returnFocusId, onFocusReturned]);
  const periods = data?.periods ?? [];
  const included = periods.filter(period => !period.excluded);
  const excluded = periods.filter(period => period.excluded);
  const review = included.filter(period => !period.timeValidated || !period.caseId);
  const validated = included.filter(period => period.timeValidated && period.caseId);
  const statusShown = filter === 'review' ? review : filter === 'validated' ? validated : filter === 'left' ? excluded : included;
  const shown = statusShown.filter(period => {
    if (caseFilter && period.caseId !== caseFilter) return false;
    if (clientFilter && client(s, Number(period.caseId))?.id !== Number(clientFilter)) return false;
    return true;
  });
  const coverageGaps = data?.coverageGaps ?? [];
  const summary = summarizeWork(included, core.sources);
  const fees = dayFees(s, core, included);
  const unresolved = included.filter(period => !period.caseId);
  const recognized = review.filter(period => period.caseId && period.demoApp);
  const notRecordedMs = coverageGaps.reduce((total, gap) => total + Math.max(0, Date.parse(gap.endedAt) - Date.parse(gap.startedAt)), 0);
  const questionFor = (periodId: string) => data?.questions.find(question => question.periodId === periodId && question.status === 'pending');
  const assign = (periodId: string, caseId: number) => {
    const period = periods.find(item => item.id === periodId);
    if (!period) return;
    const question = questionFor(periodId);
    if (question) return action(api.POST('/api/questions/answer', { body: { questionId: question.questionId, sessionId: question.sessionId,
      periodId, expectedAssignmentRevision: question.expectedAssignmentRevision, caseId: String(caseId), responseCommandId: crypto.randomUUID() } }));
    return action(api.POST('/api/work-periods/{id}/assignment', { params: { path: { id: periodId } }, body: {
      caseId: String(caseId), expectedAssignmentRevision: period.assignmentRevision, origin: 'lawyer' } }));
  };
  const saveDuration = async (periodId: string) => {
    const parsed = Number(minutes);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setDurationSaving(true);
    const result = await action(api.POST('/api/work-periods/{id}/duration-override', { params: { path: { id: periodId } }, body: { durationMs: Math.round(parsed * 60000) } }));
    setDurationSaving(false);
    if (result) setEditing(null);
  };
  const validate = async (target: Period[], focusQuestion = false) => {
    if (validating || !target.length) return;
    setValidating(true);
    showToast(`Validating ${target.length} ${target.length === 1 ? 'period' : 'periods'}…`);
    try {
      const results = await Promise.allSettled(target.map(period => api.POST('/api/work-periods/{id}/validate-time', { params: { path: { id: period.id } }, body: {} })));
      const successful = results.filter(result => result.status === 'fulfilled' && !result.value.error).length;
      if (successful) await refresh();
      showToast(successful === target.length ? `${successful} ${successful === 1 ? 'period' : 'periods'} validated` : `${successful} of ${target.length} periods validated. Please retry the rest.`);
      if (focusQuestion && successful) setFocusQuestionAfterValidation(true);
    } catch (error) { showToast(String(error)); }
    finally { setValidating(false); }
  };
  const tabs: [Filter, string, number][] = [['all', 'All', included.length], ['review', 'To validate', review.length], ['validated', 'Validated', validated.length], ['left', 'Left out', excluded.length]];
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
  const sortedPeriods = [...shown].sort((a, b) => comparePeriod(a, b, mainSort?.key ?? 'period', mainSort?.direction ?? 'ascending'));
  const mainRows: MainRow[] = sortedPeriods.map(period => ({ kind: 'period', period }));
  if (filter === 'all' && !clientFilter && !caseFilter && (!mainSort || mainSort.key === 'period')) {
    mainRows.push(...coverageGaps.map(gap => ({ kind: 'gap' as const, gap })));
    mainRows.sort((a, b) => compareText(a.kind === 'gap' ? a.gap.startedAt : a.period.startedAt, b.kind === 'gap' ? b.gap.startedAt : b.period.startedAt) * (mainSort?.direction === 'descending' ? -1 : 1));
  }
  const leftRows = [...shown].sort((a, b) => comparePeriod(a, b, leftSort?.key ?? 'time', leftSort?.direction ?? 'ascending'));
  const exportedPeriods = filter === 'left' ? leftRows : mainRows.flatMap(row => row.kind === 'period' ? [row.period] : []);
  useEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    const update = () => setHasMoreRows(element.scrollTop + element.clientHeight < element.scrollHeight - 2);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    requestAnimationFrame(update);
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [filter, data, included.length, excluded.length]);
  const caseRate = (caseId: number | null) => {
    if (!caseId) return `base rate ${money(s.firm[0]?.base_rate_cents ?? 0).replace(/\.00$/, '')}/h`;
    const item = matter(s, caseId);
    const owner = client(s, caseId);
    if (item?.mode === 'flat_fee') return 'flat fee';
    const rate = item?.own_rate_cents ?? owner?.rate_cents ?? s.firm[0]?.base_rate_cents ?? 0;
    return `${item?.own_rate_cents != null ? 'case rate' : 'client rate'} ${money(rate).replace(/\.00$/, '')}/h`;
  };
  return <>
    <div className="ph"><div className="t"><h1>My day</h1><p>{longDate(selectedDate).replace(' ', ', ')}{selectedDate === today ? ' · today' : ''}</p></div>
      <div className="actions"><DayCalendar selected={selectedDate} recorded={recorded} pending={pendingDays} onSelect={setSelectedDate} onMonthChange={setMonth} />
        <button className="btn" onClick={event => openManual(event.currentTarget)}><Icon name="plus" small />Add a hearing or meeting</button></div></div>
    {loadError && <p className="day-load-error" role="alert">{loadError}</p>}
    <div className="grid4">
      <Kpi title="Time today" value={summary.roundedMinutes ? formatRoundedMinutes(summary.roundedMinutes) : <span className="zero">—</span>} detail="Worked and recorded, after corrections" />
      <Kpi title="Fees today" value={fees ? money(fees) : <span className="zero">—</span>} detail="Before expenses" />
      <Kpi title="Not recorded" value={notRecordedMs ? formatRoundedMinutes(Math.ceil(notRecordedMs / 60000)) : <span className="zero">—</span>} detail={coverageGaps.length ? `${coverageGaps[0]!.startedAt.slice(11, 16)}–${coverageGaps[0]!.endedAt.slice(11, 16)}, not counted` : 'No coverage gap'} />
      <Kpi title="To validate" value={review.length || <span className="zero">—</span>} detail="Periods" />
    </div>
    <div className={`day-prompts${unresolved.length ? '' : ' day-prompts-single'}`}>
      <section className="card day-ready"><div><h2>{!included.length ? 'No work recorded' : review.length ? 'Your day is ready.' : 'Day validated'}</h2><p>{!included.length ? 'Choose another day to review recorded work.' : review.length ? recognized.length ? `TimeKeeper recognized ${recognized.length} ${recognized.length === 1 ? 'period' : 'periods'} on their own. ${unresolved.length ? `${unresolved.length} needs one answer from you.` : 'Nothing needs your answer.'} Check them below, then validate in one click.` : 'Review the periods below and answer any open case question.' : `${included.length} periods · ${formatRoundedMinutes(summary.roundedMinutes)} · ${money(fees)}`}</p></div>
        {recognized.length > 0 ? <button className="btn attn" disabled={validating} aria-busy={validating} onClick={() => void validate(recognized, true)}>{validating ? 'Validating…' : recognized.length === 1 ? 'Validate the recognized period' : `Validate the ${recognized.length} recognized periods`}</button> : included.length > 0 && !review.length ? <button className="btn ghost sm" onClick={() => navigate('preInvoices')}>View in Billing</button> : null}
      </section>
      {unresolved.length > 0 && <section className="card day-question" ref={questionCard} tabIndex={-1}><div><h2><Icon name="alert" small /> Which case was this?</h2>
        {unresolved[0] ? <p>{unresolved[0].startedAt.slice(11, 16)}–{unresolved[0].endedAt?.slice(11, 16)} · {unresolved[0].demoWindowTitle ?? unresolved[0].label}</p> : <p>Every period has a case. You can review the list below.</p>}</div>
        {unresolved[0] && <div className="row"><MatterSelect s={s} value={answerCase} allowEmpty onChange={setAnswerCase} /><button className="btn primary" aria-disabled={!answerCase} disabled={answering} aria-busy={answering} onClick={async () => { if (!answerCase) { showToast('Choose a case first'); return; } setAnswering(true); showToast('Assigning case…'); const periodId = unresolved[0]!.id; const result = await assign(periodId, answerCase); setAnswering(false); if (result) { showToast(`Assigned to ${matter(s, answerCase)?.title ?? 'case'}`); setRecentlyAssigned(periodId); window.setTimeout(() => setRecentlyAssigned(current => current === periodId ? null : current), 600); } else showToast('Could not assign this case'); }}>{answering ? 'Answering…' : 'Answer'}</button>
          <button className="btn" disabled={excluding} aria-busy={excluding} onClick={async () => { const periodId = unresolved[0]!.id; setExcluding(true); const result = await action(api.PATCH('/api/work-periods/{id}/details', { params: { path: { id: periodId } }, body: { excluded: true } })); setExcluding(false); if (result) showToast('Period left out', 'Undo', () => void action(api.PATCH('/api/work-periods/{id}/details', { params: { path: { id: periodId } }, body: { excluded: false } }))); }}>Not client work</button></div>}
      </section>}
    </div>
    <section className="card day-periods"><div className="toolbar"><div className="seg" role="group" aria-label="Work periods filter">
      {tabs.map(([key, title, count]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{title}<span className="c">{count}</span></button>)}
    </div><div className="right"><div className="day-filter-wrap" ref={filterWrap}><button className="btn ghost sm day-filter-toggle" aria-expanded={filterOpen} aria-controls="day-filter-popover" onClick={() => setFilterOpen(value => !value)}><Icon name="filter" small />Filter{(clientFilter || caseFilter) && <><span className="day-filter-dot" aria-hidden="true" /><span className="sr-only">Filters active</span></>}</button>
      {filterOpen && <div id="day-filter-popover" className="day-filter-popover" role="group" aria-label="Filter work periods">
        <label>Client<select className="select sm" value={clientFilter} onChange={event => { setClientFilter(event.target.value); setCaseFilter(''); }}><option value="">All clients</option>{s.client.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Case<select className="select sm" value={caseFilter} onChange={event => setCaseFilter(event.target.value)}><option value="">All cases</option>{s.matter.filter(item => !clientFilter || String(item.client_id) === clientFilter).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <button className="btn sm" disabled={!clientFilter && !caseFilter} onClick={() => { setClientFilter(''); setCaseFilter(''); }}>Clear filters</button>
      </div>}</div><button className="btn ghost sm" onClick={() => {
      const rows = exportedPeriods.map(period => [selectedDate, `${period.startedAt.slice(11, 16)}–${period.endedAt?.slice(11, 16) ?? '…'}`, client(s, Number(period.caseId))?.name ?? '', matter(s, Number(period.caseId))?.title ?? '', period.label, formatPreciseDuration(effectiveMs(period)), period.excluded ? 'Left out' : period.timeValidated ? 'Validated' : 'To validate']);
      const csv = '\uFEFF' + [['Date', 'Period', 'Client', 'Case', 'Work performed', 'Duration', 'Status'], ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `timekeeper-${selectedDate}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); showToast('Day exported');
    }}><Icon name="down" small />Export</button></div></div>
      {!data && !loadError ? <div className="empty" role="status"><b>Loading day…</b></div> : filter === 'left' ? <div className="tbl" ref={tableRef} data-has-more={hasMoreRows}><table><thead><tr>
        <SortHeader label="Time" sort={leftSort} sortKey="time" numeric onSort={changeLeftSort} />
        <SortHeader label="Application" sort={leftSort} sortKey="application" onSort={changeLeftSort} />
        <SortHeader label="Work observed" sort={leftSort} sortKey="work" onSort={changeLeftSort} />
        <SortHeader label="Duration" sort={leftSort} sortKey="duration" numeric className="r" onSort={changeLeftSort} /><th scope="col" className="r">Actions</th>
      </tr></thead><tbody>{leftRows.map(period => <tr key={period.id}><td className="num">{period.startedAt.slice(11, 16)}–{period.endedAt?.slice(11, 16) ?? '…'}</td><td>{period.demoApp ?? '—'}</td>
        <td>{period.demoWindowTitle ?? period.label}</td><td className="r num">{formatPreciseDuration(effectiveMs(period))}</td><td><button className="btn sm" onClick={() => void action(api.PATCH('/api/work-periods/{id}/details', { params: { path: { id: period.id } }, body: { excluded: false } }))}>Count as work</button></td></tr>)}</tbody></table>
        {!leftRows.length && <div className="empty"><b>No matching periods left out</b><button className="btn sm" onClick={() => { setFilter('all'); setClientFilter(''); setCaseFilter(''); }}>Show all periods</button></div>}</div>
      : <div className="tbl day-table" ref={tableRef} data-has-more={hasMoreRows}><table><thead><tr>
        <SortHeader label="Period" sort={mainSort} sortKey="period" numeric onSort={changeMainSort} />
        <SortHeader label="Client · case" sort={mainSort} sortKey="case" onSort={changeMainSort} />
        <SortHeader label="Work performed" sort={mainSort} sortKey="work" onSort={changeMainSort} />
        <SortHeader label="Duration" sort={mainSort} sortKey="duration" numeric className="r" onSort={changeMainSort} />
        <th scope="col" className="r">Actions</th>
      </tr></thead><tbody>{mainRows.map(row => {
        if (row.kind === 'gap') return <tr className="gap-row" key={row.gap.id}><td className="num muted">{row.gap.startedAt.slice(11, 16)}–{row.gap.endedAt.slice(11, 16)}</td><td colSpan={4}><span className="flag"><Icon name="alert" small />Coverage gap</span> <span className="muted">· no recording for {Math.round((Date.parse(row.gap.endedAt) - Date.parse(row.gap.startedAt)) / 60000)} min. Not counted as work, not counted as idle.</span><button className="btn sm gap-add" onClick={event => openManual(event.currentTarget)}>Add time</button></td></tr>;
        const period = row.period;
        const caseId = period.caseId ? Number(period.caseId) : null;
        const item = matter(s, caseId), owner = client(s, caseId);
        const linked = core.sources.filter(record => record.workPeriodId === period.id);
        return <tr key={period.id} className={recentlyAssigned === period.id ? 'recently-assigned' : undefined}>
          <td className="num">{period.startedAt.slice(11, 16)}–{period.endedAt?.slice(11, 16) ?? '…'}<span className="sub">{period.demoApp ?? 'Off-screen'}</span></td>
          <td>{item ? <><span className="day-client" title={owner?.name}>{owner?.name}</span><span className="sub" title={`${item.title} · ${item.reference}`}>{item.title} · <MatterReference value={item.reference} /></span></> : <><span className="flag"><Icon name="alert" small />Unresolved</span><span className="sub">Waiting for your answer above</span></>}</td>
          <td className="wrap">{period.label}<span className="sub">{s.task.find(task => task.id === period.taskTypeId)?.label ?? 'Work period'} · {caseRate(caseId)}</span></td>
          <td className="r num">{editing === period.id ? <span className="row"><input className="field" type="number" min="0" step="0.001" aria-label="Corrected minutes" value={minutes} onChange={event => setMinutes(event.target.value)} /><button className="btn sm primary" disabled={durationSaving} aria-busy={durationSaving} onClick={() => void saveDuration(period.id)}>Save</button><button className="btn sm" disabled={durationSaving} onClick={() => setEditing(null)}>Cancel</button></span>
            : <button className={`day-duration${period.durationOverrideMs !== null ? ' corrected' : ''}`} disabled={period.billingStatus === 'billed'} aria-label={`Correct duration for ${period.label}`} title="Correct duration" onClick={() => { setEditing(period.id); setMinutes(String((effectiveMs(period) ?? 0) / 60000)); }}>{formatPreciseDuration(effectiveMs(period))}<Icon name="edit" small /></button>}
            {period.durationOverrideMs !== null && <span className="sub">was {formatPreciseDuration(period.detectedDurationMs)}</span>}</td>
          <td><div className="day-actions">{period.timeValidated ? <span className="day-validated">✓ Validated</span> : period.caseId ? <button className="btn sm attn" disabled={validating} aria-busy={validating} onClick={() => void validate([period])}>Validate</button> : null}
            <button className="btn sm" data-source-period-id={period.id} disabled={!linked.length} onClick={() => source(period.id)}>Sources</button></div></td>
        </tr>;
      })}</tbody></table>{!mainRows.length && <div className="empty"><b>{!included.length && !coverageGaps.length ? 'No work recorded' : 'No matching periods'}</b><p>{!included.length && !coverageGaps.length ? 'Nothing was recorded on this day.' : 'Adjust the filters or choose another day.'}</p>{included.length > 0 && <button className="btn sm" onClick={event => openManual(event.currentTarget)}>Add a hearing or meeting</button>}</div>}</div>}
    </section>
    {manual && <div className="modal-back" onMouseDown={event => { if (event.target === event.currentTarget) closeManual(); }}><form className="modal glass pad col" role="dialog" aria-modal="true" aria-labelledby="manual-dialog-title" ref={manualDialog} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); closeManual(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),input:not([disabled])')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onSubmit={async event => {
      event.preventDefault(); if (!core.activeSession) return;
      const durationMs = Math.round(Number(manualMinutes) * 60000);
      if (!Number.isSafeInteger(durationMs) || durationMs < 0) return;
      const start = `${selectedDate}T17:${String(periods.filter(period => period.startedAt.startsWith(`${selectedDate}T17:`)).length).padStart(2, '0')}:00Z`;
      setManualSaving(true);
      const result = await action(api.POST('/api/work-periods/manual', { body: { sessionId: core.activeSession.id, caseId: String(manualCase), startedAt: start, durationMs, taskTypeId: manualTask, label: manualLabel } }));
      setManualSaving(false);
      if (result) closeManual();
    }}><h2 id="manual-dialog-title">Add a hearing or meeting</h2><p>This creates a manual period without a source. Validate its time separately.</p>
      <label>Case <MatterSelect s={s} value={manualCase} onChange={id => { if (id) setManualCase(id); }} /></label>
      <label>Task <select className="field" value={manualTask} onChange={event => setManualTask(Number(event.target.value))}>{s.task.filter(task => task.off_screen).map(task => <option key={task.id} value={task.id}>{task.label}</option>)}</select></label>
      <label>Minutes <input className="field" type="number" min="0" step="0.001" value={manualMinutes} onChange={event => setManualMinutes(event.target.value)} /></label>
      <label>Label <input className="field" value={manualLabel} onChange={event => setManualLabel(event.target.value)} /></label>
      <div className="row"><button className="btn primary" disabled={!core.activeSession || manualSaving} aria-busy={manualSaving}>Add</button><button type="button" className="btn" disabled={manualSaving} onClick={closeManual}>Cancel</button></div>
    </form></div>}
  </>;
}
