import { calendarDay, dayBounds, systemTimeZone } from "../../../shared/dates";
import { useEffect, useState } from "react";

export function localToday(date = new Date()): string {
  return calendarDay(date, systemTimeZone());
}

/** Follow the local calendar even after sleep or a timezone change. */
export function useToday(): string {
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    let timer: number;
    const update = () => {
      window.clearTimeout(timer);
      const now = new Date();
      setToday(localToday(now));
      const { endAt } = dayBounds(localToday(now), systemTimeZone());
      timer = window.setTimeout(update, Date.parse(endAt) - now.getTime());
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}
