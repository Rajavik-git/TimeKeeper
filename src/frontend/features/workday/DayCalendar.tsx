import { shiftCalendarDay, shiftCalendarMonth, monthBounds } from "../../../shared/dates";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useToday } from "../../shared/hooks/useToday";
import { Icon } from "../../shared/components/Icon";
import { longDate, shortDate } from "../../shared/format";
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const shortDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dayDate = (date: string) => new Date(`${date}T12:00:00Z`);
export const shiftDay = shiftCalendarDay;
const shiftMonth = (month: string, amount: number) =>
  shiftCalendarMonth(`${month}-01`, amount).slice(0, 7);
export const monthEnd = (month: string) => monthBounds(`${month}-01`).to;
export function DayCalendar({
  selected,
  recorded,
  pending,
  onSelect,
  onMonthChange,
}: {
  selected: string;
  recorded: Set<string>;
  pending: Set<string>;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
}) {
  const today = useToday();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(selected.slice(0, 7));
  const wrapper = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setMonth(selected.slice(0, 7));
  }, [selected]);
  useEffect(() => {
    onMonthChange(month);
  }, [month, onMonthChange]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        wrapper.current?.querySelector<HTMLButtonElement>(".datebtn")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);
  useEffect(() => {
    if (open) selectedRef.current?.focus();
  }, [open, month]);
  const choose = (date: string) => {
    onSelect(date);
    setOpen(false);
    wrapper.current?.querySelector<HTMLButtonElement>(".datebtn")?.focus();
  };
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const target = shiftDay(date, step);
    if (target > today) return;
    if (target.slice(0, 7) !== month) setMonth(target.slice(0, 7));
    requestAnimationFrame(() =>
      wrapper.current?.querySelector<HTMLButtonElement>(`[data-calendar-day="${target}"]`)?.focus(),
    );
  };
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const first = dayDate(`${month}-01`);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Number(monthEnd(month).slice(8, 10));
  const years = Array.from(
    { length: Number(today.slice(0, 4)) - Math.min(2020, year) + 1 },
    (_, index) => Number(today.slice(0, 4)) - index,
  );
  const nextMonth = shiftMonth(month, 1);
  const otherPendingDays = [...pending].filter((date) => date !== selected).length;
  return (
    <div className="daypick" role="group" aria-label="Choose a day">
      <button
        className="iconbtn previous-day"
        aria-label="Previous day"
        onClick={() => choose(shiftDay(selected, -1))}
      >
        <Icon name="chev" small />
      </button>
      <div className="calwrap" ref={wrapper}>
        <button
          className="datebtn"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {shortDay.format(dayDate(selected))}
          <Icon name="day" small />
          {otherPendingDays > 0 && (
            <span
              className="datebadge"
              title={`${otherPendingDays} other day${otherPendingDays === 1 ? "" : "s"} with periods to validate (${[
                ...pending,
              ]
                .filter((date) => date !== selected)
                .map(shortDate)
                .join(", ")})`}
            >
              {otherPendingDays}
            </span>
          )}
        </button>
        {open && (
          <div className="cal" role="dialog" aria-label="Choose a day">
            <div className="calhd">
              <button
                className="iconbtn previous-month"
                aria-label="Previous month"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <Icon name="chev" small />
              </button>
              <select
                className="select sm"
                aria-label="Month"
                value={monthIndex}
                onChange={(event) =>
                  setMonth(`${year}-${String(Number(event.target.value) + 1).padStart(2, "0")}`)
                }
              >
                {months.map((name, index) => (
                  <option
                    key={name}
                    value={index}
                    disabled={`${year}-${String(index + 1).padStart(2, "0")}` > today.slice(0, 7)}
                  >
                    {name}
                  </option>
                ))}
              </select>
              <select
                className="select sm"
                aria-label="Year"
                value={year}
                onChange={(event) => {
                  const chosen = Number(event.target.value);
                  const chosenMonth =
                    chosen === Number(today.slice(0, 4))
                      ? Math.min(monthIndex, Number(today.slice(5, 7)) - 1)
                      : monthIndex;
                  setMonth(`${chosen}-${String(chosenMonth + 1).padStart(2, "0")}`);
                }}
              >
                {years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <button
                className="iconbtn"
                aria-label="Next month"
                disabled={nextMonth > today.slice(0, 7)}
                onClick={() => setMonth(nextMonth)}
              >
                <Icon name="chev" small />
              </button>
            </div>
            <div className="calgrid" role="group" aria-label={`${months[monthIndex]} ${year}`}>
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((name) => (
                <span className="dow" key={name}>
                  {name}
                </span>
              ))}
              {Array.from({ length: offset }, (_, index) => (
                <span key={`empty-${index}`} />
              ))}
              {Array.from({ length: days }, (_, index) => {
                const date = `${month}-${String(index + 1).padStart(2, "0")}`;
                const selectedDay = date === selected;
                const future = date > today;
                const noWork = !future && !recorded.has(date);
                return (
                  <button
                    key={date}
                    type="button"
                    ref={selectedDay ? selectedRef : undefined}
                    className={`cday${selectedDay ? " sel" : ""}${date === today ? " today" : ""}${noWork ? " off" : ""}`}
                    data-calendar-day={date}
                    disabled={future}
                    aria-label={`${longDate(date)}${pending.has(date) ? ", to validate" : recorded.has(date) ? ", validated" : noWork ? ", no work recorded" : ""}`}
                    aria-current={selectedDay ? "date" : undefined}
                    onKeyDown={(event) => moveFocus(event, date)}
                    onClick={() => choose(date)}
                  >
                    {index + 1}
                    {pending.has(date) ? (
                      <i className="p" aria-hidden="true" />
                    ) : recorded.has(date) ? (
                      <i aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="calft">
              <div className="calkey">
                <span>
                  <i className="dotk" aria-hidden="true" />
                  Validated
                </span>
                <span>
                  <i className="dotk p" aria-hidden="true" />
                  To validate
                </span>
                <span>Hatched: no recording</span>
              </div>
              <button className="btn sm" onClick={() => choose(today)}>
                Today
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        className="iconbtn"
        aria-label="Next day"
        title={selected >= today ? "No later days" : "Next day"}
        disabled={selected >= today}
        onClick={() => choose(shiftDay(selected, 1))}
      >
        <Icon name="chev" small />
      </button>
      {selected !== today && (
        <button className="btn sm" onClick={() => choose(today)}>
          Today
        </button>
      )}
    </div>
  );
}
