import { calendarDay, calendarTime } from "../../../../shared/dates";
import type { components } from "../../../../contracts/generated";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../../../api/client";
import { loadApplication, refreshApplication, useResource } from "../../../api/queries";
import {
  configuredRate,
  dayFees,
  effectiveMs,
  formatPreciseDuration,
  type Period,
} from "../../../calculations/billing";
import { money, rate } from "../../../shared/format";
import { Logo } from "../../../shared/components/Logo/Logo";
import { rateOriginLabels } from "../../../shared/presentation/billing";
import { useToday } from "../../../shared/hooks/useToday";

const tauri = "__TAURI_INTERNALS__" in window;

/** Fictional demo documents offered by the browser simulator (not shown in the desktop app). */
export const demoDocuments = [
  "2025-031 Opposition Brief v3.docx",
  "[2025-031] Defendant's documents.eml",
  "2025-031 Engagement letter - Paul Dawson.pdf",
  "2025-031 Defendant exhibits 1-12 - index.pdf",
  "2025-031 Letter to client - defendant's position.docx",
  "Research - notice of appeal deadline for family court orders.docx",
  "2026-004 Petition for dissolution of marriage - Bennett.pdf",
  "2026-004 Hearing preparation notes.docx",
  "2026-009 Letter to landlord - rent proposal.docx",
  "2026-009 Lease renewal notice - Linden Street Properties.pdf",
  "2026-012 Lumen Bylaws draft v2.docx",
  "2026-015 Memo on right of first refusal.docx",
  "Meeting request - new matter.eml",
  "Program Manager",
];

type Recognition = components["schemas"]["WindowRecognition"];
type Notice = {
  windowTitle: string;
  appName: string;
  recognition: Recognition;
  seconds: number;
  at: string;
};
type Feedback = { id: string; text: string; undoToken: string | null; showText: boolean };
type PillPlacement = {
  anchorX: number;
  anchorY: number;
  above: boolean;
  width: number;
  height: number;
  barHeight: number;
};
type BrowserPosition = { x: number; y: number };

const positionKey = "timekeeper:pill-position";
const pauseKey = (sessionId: string) => `timekeeper:pill-paused:${sessionId}`;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Position and pause preferences are conveniences; the pill works without storage.
  }
}
function savedPosition(): BrowserPosition {
  try {
    const value = JSON.parse(readStorage(positionKey) ?? "null");
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: value.x, y: value.y }
      : { x: 0, y: 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}
/** The pause is local to the pill: it only stops file-switch detection and freezes the clock. */
function storedPause(sessionId: string | undefined): number | null {
  if (!sessionId) return null;
  const value = Number(readStorage(pauseKey(sessionId)));
  return Number.isFinite(value) && value > 0 ? value : null;
}
function message(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return fallback;
}
type DecisionResult = components["schemas"]["PillDecisionResult"];
/** A 202 reply means the case or duration is still missing; only 200 carries an undo token. */
function decisionResult(
  response: { data?: unknown; error?: unknown },
  fallback: string,
): DecisionResult {
  const data = response.data as Partial<DecisionResult> | undefined;
  if (response.error || !data?.period || typeof data.undoToken !== "string")
    throw Error(message(response.error ?? response.data, fallback));
  return data as DecisionResult;
}

export function Pill() {
  const application = useResource("pill", loadApplication, 5000);
  const catalogState = application.data?.catalogState;
  const workspaceState = application.data?.workspaceState;
  const offline = application.isError;
  const today = useToday();
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [closingSwitch, setClosingSwitch] = useState(false);
  const [recent, setRecent] = useState<{ id: string; title: string } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selectedCase, setSelectedCase] = useState("");
  const [dismissedQuestion, setDismissedQuestion] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [browserPosition, setBrowserPosition] = useState<BrowserPosition>(savedPosition);
  const [above, setAbove] = useState(false);
  const [popupHeight, setPopupHeight] = useState(0);
  const [placementVersion, setPlacementVersion] = useState(0);
  const nativePlacement = useRef<PillPlacement | null>(null);
  const ignoreNativeMoveUntil = useRef(0);
  const dragStart = useRef<{ x: number; y: number; origin: BrowserPosition } | null>(null);
  const debounce = useRef<number | undefined>(undefined);
  const switching = useRef(false);
  const previous = useRef("");
  const dismissedSwitch = useRef(new Set<string>());
  const workspaceRef = useRef(workspaceState);
  workspaceRef.current = workspaceState;
  const catalogRef = useRef(catalogState);
  catalogRef.current = catalogState;
  if (tauri && !nativePlacement.current && readStorage(positionKey)) {
    const saved = savedPosition();
    nativePlacement.current = {
      anchorX: saved.x,
      anchorY: saved.y,
      above: false,
      width: 0,
      height: 0,
      barHeight: 38,
    };
  }

  const refresh = useCallback(async () => {
    try {
      await refreshApplication();
    } catch {
      // The resource state reports the failure as offline.
    }
  }, []);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(clock);
  }, []);
  useEffect(() => {
    if (!recent) return;
    const id = recent.id;
    const timer = window.setTimeout(
      () => setRecent((value) => (value?.id === id ? null : value)),
      5000,
    );
    return () => window.clearTimeout(timer);
  }, [recent]);
  const feedbackId = feedback?.id;
  const feedbackUndo = feedback?.undoToken ?? null;
  useEffect(() => {
    if (!feedbackId) return;
    const textTimer = window.setTimeout(
      () =>
        setFeedback((value) => (value?.id === feedbackId ? { ...value, showText: false } : value)),
      2000,
    );
    const undoTimer = window.setTimeout(
      () => setFeedback((value) => (value?.id === feedbackId ? null : value)),
      feedbackUndo ? 5000 : 2000,
    );
    return () => {
      window.clearTimeout(textTimer);
      window.clearTimeout(undoTimer);
    };
  }, [feedbackId, feedbackUndo]);
  const confirmInline = (text: string, undoToken: string | null) =>
    setFeedback({ id: crypto.randomUUID(), text, undoToken, showText: true });

  const active = workspaceState?.activeSession ?? null;
  const activeId = active?.id;
  useEffect(() => setPausedAt(storedPause(activeId)), [activeId]);
  const paused = !!active && pausedAt !== null;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const current = workspaceState?.periods.find(
    (p) => p.sessionId === active?.id && p.endedAt === null,
  );
  const caseById = (id: string | null | undefined) =>
    catalogState?.cases.find((item) => item.id === id);
  const caseItem = caseById(current?.caseId);
  const owner = catalogState?.clients.find((client) => client.id === caseItem?.clientId);
  const setting = catalogState?.settings;
  const currency = setting?.currency ?? "USD";
  const pending = (
    workspaceState?.periods.filter(
      (p) =>
        p.sessionId === active?.id &&
        calendarDay(p.startedAt) === today &&
        !p.excluded &&
        (!p.timeValidated || !p.caseId),
    ) ?? []
  ).sort((a, b) => {
    const readyA = !!a.caseId && effectiveMs(a) !== null;
    const readyB = !!b.caseId && effectiveMs(b) !== null;
    return (
      Number(readyB) - Number(readyA) ||
      (readyA && readyB
        ? effectiveMs(a)! - effectiveMs(b)!
        : a.startedAt.localeCompare(b.startedAt))
    );
  });
  const readyPending = pending.filter((p) => p.caseId && effectiveMs(p) !== null);
  const question = workspaceState?.questions.find(
    (q) => q.sessionId === active?.id && q.status === "pending",
  );
  const questionPeriod = workspaceState?.periods.find((p) => p.id === question?.periodId);
  const showQuestion = !!question && !!questionPeriod && !questionPeriod.excluded;
  const duringCall = /call|phone|video/i.test(current?.label ?? "");
  const showQuestionNotice =
    showQuestion &&
    !!setting?.notifications &&
    question?.questionId !== dismissedQuestion &&
    !(setting.pillWithholdCalls && duringCall);
  const clockNow = paused ? pausedAt! : now;
  const liveElapsed = current ? Math.max(0, clockNow - Date.parse(current.startedAt)) : null;
  const periodMs = current ? (effectiveMs(current) ?? liveElapsed) : null;
  const hourlyRate = catalogState && caseItem ? configuredRate(catalogState, caseItem.id) : null;
  const amount =
    periodMs !== null && hourlyRate && hourlyRate.origin !== "flat_fee"
      ? money(Math.round((periodMs * hourlyRate.rateCents) / 3600000), currency)
      : "—";
  const barValue =
    setting?.pillDisplay === "time" ? (current ? formatPreciseDuration(periodMs) : "—") : amount;
  const day =
    workspaceState?.periods.filter((p) => calendarDay(p.startedAt) === today && !p.excluded) ?? [];
  const pricedDay = day.map((period) =>
    period.id === current?.id && periodMs !== null
      ? { ...period, durationOverrideMs: periodMs }
      : period,
  );
  const todayFees =
    catalogState && workspaceState
      ? dayFees(catalogState, { ...workspaceState, auditEvents: [] }, pricedDay)
      : null;
  const todayAmount =
    todayFees?.cents != null && todayFees.currency
      ? money(todayFees.cents, todayFees.currency)
      : "—";

  const alwaysOnTop = setting?.pillAlwaysOnTop;
  useEffect(() => {
    if (tauri && alwaysOnTop !== undefined)
      void getCurrentWindow()
        .setAlwaysOnTop(alwaysOnTop)
        .catch(() => setError("Unable to set pill position."));
  }, [alwaysOnTop]);
  const loaded = !!catalogState;
  useEffect(() => {
    if (tauri && loaded)
      void invoke("set_watch_enabled", { enabled: !paused }).catch(() =>
        setError("Unable to apply file-switch pause."),
      );
  }, [loaded, paused, activeId]);
  useEffect(() => {
    if (!tauri) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    let timer = 0;
    void getCurrentWindow()
      .onMoved(({ payload }) => {
        if (Date.now() < ignoreNativeMoveUntil.current) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const placement = nativePlacement.current;
          if (!placement || !placement.width) return;
          const next = {
            ...placement,
            anchorX: payload.x + placement.width / 2,
            anchorY: payload.y + (placement.above ? placement.height - placement.barHeight : 0),
          };
          nativePlacement.current = next;
          writeStorage(positionKey, JSON.stringify({ x: next.anchorX, y: next.anchorY }));
          setPlacementVersion((value) => value + 1);
        }, 220);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });
    return () => {
      cancelled = true;
      stop?.();
      window.clearTimeout(timer);
    };
  }, []);
  const notification = !!notice || !!recent || (!expanded && showQuestionNotice);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".pill-bar");
    const content = [
      ...document.querySelectorAll<HTMLElement>(".pill-panel,.pill-notice,.pill-error"),
    ];
    let frame = 0;
    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const popup = content.find((element) => element.matches(".pill-panel,.pill-notice"));
        const popupSize = popup?.offsetHeight ?? 0;
        setPopupHeight(popupSize);
        const contentWidth = Math.ceil(
          Math.max(bar?.offsetWidth ?? 0, ...content.map((element) => element.offsetWidth)),
        );
        const contentHeight = Math.ceil(
          Math.max(bar?.offsetHeight ?? 0, ...content.map((element) => 46 + element.offsetHeight)),
        );
        if (tauri) {
          const anchor = nativePlacement.current;
          ignoreNativeMoveUntil.current = Date.now() + 400;
          void invoke<PillPlacement>("set_pill_expanded", {
            expanded,
            notification,
            contentWidth,
            contentHeight,
            anchorX: anchor?.anchorX ?? null,
            anchorY: anchor?.anchorY ?? null,
          })
            .then((position) => {
              nativePlacement.current = position;
              setAbove(position.above);
              writeStorage(
                positionKey,
                JSON.stringify({ x: position.anchorX, y: position.anchorY }),
              );
            })
            .catch(() => setError("Unable to resize the pill."));
        } else
          setAbove(
            !!popup &&
              browserPosition.y + 46 + popupSize > window.innerHeight &&
              browserPosition.y >= popupSize + 8,
          );
      });
    };
    const observer = new ResizeObserver(resize);
    if (bar) observer.observe(bar);
    content.forEach((element) => observer.observe(element));
    resize();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [
    expanded,
    notice,
    recent,
    notification,
    error,
    placementVersion,
    browserPosition.x,
    browserPosition.y,
  ]);

  const showSwitch = useCallback(async (windowTitle: string, appName: string) => {
    if (
      pausedRef.current ||
      !workspaceRef.current?.activeSession ||
      !windowTitle.trim() ||
      !appName.trim() ||
      previous.current === `${appName}:${windowTitle}`
    )
      return;
    previous.current = `${appName}:${windowTitle}`;
    const at = new Date().toISOString();
    try {
      const result = await api.POST("/api/recognize", { body: { windowTitle, appName } });
      if (result.error || !result.data)
        throw Error(message(result.error, "Unable to recognize this file."));
      // Without a suggestion, only document-like titles ask the lawyer.
      if (!result.data.suggestion && !/\.[a-z0-9]{1,8}(?=\s|$|[-—])/i.test(windowTitle)) return;
      setNotice({ windowTitle, appName, recognition: result.data, seconds: 20, at });
      setRecent(null);
      setSelectedCase("");
      setExpanded(false);
      setClosingSwitch(false);
      setError("");
    } catch (cause) {
      previous.current = "";
      setError(message(cause, "Unable to recognize this file."));
    }
  }, []);
  const questionId = question?.questionId;
  const dismiss = useCallback(() => {
    if (notice && switching.current)
      dismissedSwitch.current.add(`${notice.appName}:${notice.windowTitle}:${notice.at}`);
    setNotice(null);
    setRecent(null);
    setExpanded(false);
    setSelectedCase("");
    // Keep a pending question in the panel and My day without reopening its popup at once.
    if (questionId) setDismissedQuestion(questionId);
  }, [notice, questionId]);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (notice || recent || showQuestionNotice || expanded)) {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [notice, recent, showQuestionNotice, expanded, dismiss]);
  useEffect(() => {
    if (!tauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<{ windowTitle: string; appName: string }>("active-window-changed", (event) => {
      window.clearTimeout(debounce.current);
      debounce.current = window.setTimeout(
        () => void showSwitch(event.payload.windowTitle, event.payload.appName),
        3000,
      );
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      window.clearTimeout(debounce.current);
    };
  }, [showSwitch]);

  const switchTo = useCallback(
    async (target: Notice, caseId: string | null, automatic = false) => {
      if (switching.current) return;
      switching.current = true;
      const key = `${target.appName}:${target.windowTitle}:${target.at}`;
      setBusy(true);
      try {
        const response = await api.POST("/api/pill/decision", {
          body: {
            kind: "switch",
            caseId,
            windowTitle: target.windowTitle,
            appName: target.appName,
            at: target.at,
          },
        });
        const decided = decisionResult(response, "Unable to record the file switch.");
        const acceptedTitle =
          caseId === null
            ? "Not client work"
            : (catalogRef.current?.cases.find((item) => item.id === caseId)?.title ??
              target.recognition.suggestion?.title ??
              "Which case?");
        if (!dismissedSwitch.current.has(key)) {
          setFeedback({
            id: crypto.randomUUID(),
            text: caseId === null ? "Marked as not client work" : `Assigned to ${acceptedTitle}`,
            undoToken: decided.undoToken,
            showText: true,
          });
          setRecent(automatic ? { id: decided.period.id, title: acceptedTitle } : null);
        }
        setClosingSwitch(true);
        window.setTimeout(() => {
          setNotice((value) => (value?.at === target.at ? null : value));
          setClosingSwitch(false);
        }, 140);
        setSelectedCase("");
        await refresh();
      } catch (cause) {
        setError(message(cause, "Unable to record the file switch."));
      } finally {
        dismissedSwitch.current.delete(key);
        switching.current = false;
        setBusy(false);
      }
    },
    [refresh],
  );
  const countdown =
    !!notice &&
    !closingSwitch &&
    notice.recognition.confidence === "high" &&
    !!notice.recognition.suggestion &&
    !selectedCase;
  const noticeAt = notice?.at;
  useEffect(() => {
    if (!countdown) return;
    const timer = window.setInterval(
      () =>
        setNotice((value) =>
          value ? { ...value, seconds: Math.max(0, value.seconds - 1) } : null,
        ),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [countdown, noticeAt]);
  useEffect(() => {
    if (countdown && notice?.seconds === 0)
      void switchTo(notice, notice.recognition.suggestion!.caseId, true);
  }, [countdown, notice, switchTo]);

  const validate = async (periods: Period[]) => {
    setBusy(true);
    try {
      const ready = periods.filter((p) => p.caseId);
      const response = await api.POST("/api/pill/decision", {
        body: {
          kind: "validate",
          periodIds: ready.map((p) => p.id),
          expectedEffectiveRevisions: Object.fromEntries(
            ready.map((period) => [period.id, period.effectiveRevision]),
          ),
        },
      });
      const decided = decisionResult(
        response,
        "A case and duration are required before validation.",
      );
      setExpanded(false);
      setRecent(null);
      confirmInline(
        ready.length === 1 ? "Period validated" : `${ready.length} periods validated`,
        decided.undoToken,
      );
      await refresh();
    } catch (cause) {
      setError(message(cause, "Unable to validate."));
    } finally {
      setBusy(false);
    }
  };
  const assign = async (periodId: string, caseId: string) => {
    const period = workspaceState?.periods.find((p) => p.id === periodId);
    if (!period) return;
    setBusy(true);
    try {
      const response = await api.POST("/api/pill/decision", {
        body: {
          kind: "assign",
          periodId,
          caseId,
          expectedAssignmentRevision: period.assignmentRevision,
        },
      });
      const decided = decisionResult(response, "Unable to assign this case.");
      setSelectedCase("");
      setExpanded(false);
      setRecent(null);
      setNotice(null);
      if (question?.periodId === periodId) setDismissedQuestion(question.questionId);
      confirmInline(`Assigned to ${caseById(caseId)?.title ?? "case"}`, decided.undoToken);
      await refresh();
    } catch (cause) {
      setError(message(cause, "Unable to assign this case."));
    } finally {
      setBusy(false);
    }
  };
  const excludeQuestion = async () => {
    if (!questionPeriod) return;
    setBusy(true);
    try {
      const response = await api.POST("/api/pill/decision", {
        body: {
          kind: "exclude",
          periodId: questionPeriod.id,
          expectedAssignmentRevision: questionPeriod.assignmentRevision,
          expectedEffectiveRevision: questionPeriod.effectiveRevision,
        },
      });
      const decided = decisionResult(response, "Unable to leave this period out.");
      setSelectedCase("");
      setExpanded(false);
      setRecent(null);
      setNotice(null);
      if (question?.questionId) setDismissedQuestion(question.questionId);
      confirmInline("Marked as not client work", decided.undoToken);
      await refresh();
    } catch (cause) {
      setError(message(cause, "Unable to leave this period out."));
    } finally {
      setBusy(false);
    }
  };
  const togglePause = () => {
    if (!active) return;
    const next = paused ? null : Date.now();
    writeStorage(pauseKey(active.id), next === null ? null : String(next));
    setPausedAt(next);
    setNow(Date.now());
  };
  const undo = async () => {
    if (!feedback?.undoToken || busy) return;
    setBusy(true);
    try {
      const response = await api.POST("/api/pill/undo", {
        body: { undoToken: feedback.undoToken },
      });
      if (response.error)
        throw Error(message(response.error, "This choice can no longer be undone."));
      setNotice(null);
      setRecent(null);
      setExpanded(false);
      confirmInline("Choice undone", null);
      await refresh();
    } catch (cause) {
      setError(message(cause, "This choice can no longer be undone."));
      setFeedback(null);
    } finally {
      setBusy(false);
    }
  };
  const openDay = () => {
    if (tauri) void invoke("open_my_day").catch(() => setError("Unable to open TimeKeeper."));
    else window.open("/", "_blank");
  };
  const openCases = catalogState?.cases.filter((item) => item.status === "active") ?? [];
  const recentPeriod = workspaceState?.periods.find((period) => period.id === recent?.id);
  const togglePanel = () =>
    offline
      ? void refresh()
      : notice || recent || showQuestionNotice
        ? dismiss()
        : setExpanded(!expanded);
  const clampBrowser = (value: BrowserPosition): BrowserPosition => {
    const margin = Math.max(0, (window.innerWidth - 360) / 2);
    let y = Math.max(0, Math.min(window.innerHeight - 38, value.y));
    if (popupHeight) {
      const belowMax = window.innerHeight - 46 - popupHeight;
      const aboveMin = popupHeight + 8;
      if (y > belowMax && y < aboveMin)
        y =
          y - belowMax < aboveMin - y
            ? Math.max(0, belowMax)
            : Math.min(window.innerHeight - 38, aboveMin);
    }
    return { x: Math.max(-margin, Math.min(margin, value.x)), y };
  };
  const moveBy = (dx: number, dy: number, reset = false) => {
    if (tauri) {
      if (reset) {
        nativePlacement.current = null;
        writeStorage(positionKey, null);
      } else if (nativePlacement.current)
        nativePlacement.current = {
          ...nativePlacement.current,
          anchorX: nativePlacement.current.anchorX + dx,
          anchorY: nativePlacement.current.anchorY + dy,
        };
      setPlacementVersion((value) => value + 1);
    } else {
      const next = reset
        ? { x: 0, y: 0 }
        : clampBrowser({ x: browserPosition.x + dx, y: browserPosition.y + dy });
      setBrowserPosition(next);
      writeStorage(positionKey, JSON.stringify(next));
    }
  };
  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (tauri) {
      void getCurrentWindow()
        .startDragging()
        .catch(() => setError("Unable to move the pill."));
      return;
    }
    dragStart.current = { x: event.clientX, y: event.clientY, origin: browserPosition };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start) return;
    setBrowserPosition(
      clampBrowser({
        x: start.origin.x + event.clientX - start.x,
        y: start.origin.y + event.clientY - start.y,
      }),
    );
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const next = clampBrowser({
      x: start.origin.x + event.clientX - start.x,
      y: start.origin.y + event.clientY - start.y,
    });
    setBrowserPosition(next);
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    writeStorage(positionKey, JSON.stringify(next));
  };
  const dragKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!event.altKey) return;
    const delta =
      event.key === "ArrowLeft"
        ? [-20, 0]
        : event.key === "ArrowRight"
          ? [20, 0]
          : event.key === "ArrowUp"
            ? [0, -20]
            : event.key === "ArrowDown"
              ? [0, 20]
              : null;
    if (event.key === "Home") {
      event.preventDefault();
      moveBy(0, 0, true);
    } else if (delta) {
      event.preventDefault();
      moveBy(delta[0], delta[1]);
    }
  };
  const rootStyle = (tauri
    ? { "--pill-popup-height": `${popupHeight}px` }
    : {
        transform: `translate(${browserPosition.x}px,${browserPosition.y}px)`,
        "--pill-popup-height": `${popupHeight}px`,
      }) as unknown as CSSProperties;
  const time = (value: string | null | undefined) => (value ? calendarTime(value) : "…");
  const caseOptions = openCases.map((item) => (
    <option key={item.id} value={item.id}>
      {item.title}
    </option>
  ));
  const questionSelect = (
    <select
      aria-label="Choose a case for this period"
      value={selectedCase}
      disabled={busy}
      onChange={(event) => {
        setSelectedCase(event.target.value);
        if (event.target.value) void assign(questionPeriod!.id, event.target.value);
      }}
    >
      <option value="">Choose a case</option>
      {caseOptions}
    </select>
  );
  const barLabel = feedback?.showText
    ? feedback.text
    : paused
      ? "Paused"
      : (caseItem?.title ?? (active ? "Which case?" : "No active session"));

  return (
    <main
      className={"pill-root" + (above ? (tauri ? " native-above" : " browser-above") : "")}
      style={rootStyle}
    >
      <div className={"pill-bar" + (offline ? " offline" : "") + (paused ? " is-paused" : "")}>
        <span
          className="pill-drag"
          role="button"
          tabIndex={0}
          aria-label="Move pill"
          title="Drag to move · double-click to reset · Alt+arrows to move"
          onPointerDown={beginDrag}
          onPointerMove={dragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => moveBy(0, 0, true)}
          onKeyDown={dragKey}
        >
          <span className="pill-mark">
            <Logo compact wordmark={false} />
          </span>
        </span>
        <button
          className="pill-main"
          onClick={togglePanel}
          aria-expanded={expanded}
          aria-label={offline ? "TimeKeeper disconnected, retry" : "TimeKeeper, toggle panel"}
        >
          {offline ? (
            <>
              <span className="pill-who">TimeKeeper is not running</span>
              <span className="pill-retry">Retry</span>
            </>
          ) : (
            <>
              <span className={"pill-rec" + (paused || !active ? " paused" : "")} />
              <span
                className={"pill-who" + (feedback?.showText ? " confirming" : "")}
                title={
                  feedback?.showText
                    ? feedback.text
                    : owner && caseItem
                      ? `${owner.name} · ${caseItem.title}`
                      : undefined
                }
              >
                {barLabel}
              </span>
              {!feedback?.showText && setting?.pillDisplay !== "case" && barValue !== "—" && (
                <strong className="pill-amount">{barValue}</strong>
              )}
              {!feedback?.showText && pending.length > 0 && (
                <span className="pill-badge" aria-label={`${pending.length} periods to validate`}>
                  {pending.length}
                </span>
              )}
            </>
          )}
        </button>
        {feedback?.undoToken && (
          <button
            className="pill-undo"
            disabled={busy}
            onClick={() => void undo()}
            aria-label="Undo last choice"
            title="Undo last choice"
          >
            Undo
          </button>
        )}
        {!offline && active && (
          <button
            className="pill-pause"
            disabled={busy}
            onClick={togglePause}
            aria-label={paused ? "Resume file-switch detection" : "Pause file-switch detection"}
            title={
              paused
                ? "Resume file-switch detection"
                : "Pause file-switch detection (Screenpipe keeps recording)"
            }
          >
            {paused ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 9 6-9 6z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 6v12M16 6v12" />
              </svg>
            )}
          </button>
        )}
        {!offline && (
          <button
            className="pill-chevron"
            onClick={togglePanel}
            aria-label="Toggle pill panel"
            title="Toggle panel"
          >
            ⌄
          </button>
        )}
      </div>
      {expanded && !offline && (
        <section className="pill-panel" aria-label="TimeKeeper panel">
          <header>
            <div className="pill-heading">
              <strong>{caseItem?.title ?? (active ? "Which case?" : "No active session")}</strong>
              <span>{caseItem?.reference ?? ""}</span>
            </div>
            <small>
              {owner?.name ?? "Unassigned"}
              {hourlyRate && hourlyRate.origin !== "flat_fee"
                ? ` · ${rateOriginLabels[hourlyRate.origin]} ${rate(hourlyRate.rateCents, currency)}`
                : ""}
            </small>
            <small>
              Session since {active ? calendarTime(active.startedAt) : "—"} · this period since{" "}
              {current ? calendarTime(current.startedAt) : "—"}
            </small>
          </header>
          <div className="pill-kpis">
            <div>
              <small>This period</small>
              <strong>{formatPreciseDuration(periodMs)}</strong>
            </div>
            <div>
              <small>Amount</small>
              <strong>{amount}</strong>
            </div>
            <div>
              <small>Today</small>
              <strong>{todayAmount}</strong>
            </div>
          </div>
          <div className="pill-review">
            <div className="pill-row">
              <small>To validate · {pending.length}</small>
            </div>
            {pending.slice(0, 2).map((period) => (
              <div className="pill-row" key={period.id}>
                <div>
                  <strong>{period.label || caseById(period.caseId)?.title || "Which case?"}</strong>
                  <small>
                    {time(period.startedAt)}–{time(period.endedAt)} ·{" "}
                    {formatPreciseDuration(effectiveMs(period))}
                  </small>
                </div>
                {period.caseId && (
                  <button
                    className="pill-button action"
                    disabled={busy || effectiveMs(period) === null}
                    title={
                      effectiveMs(period) === null
                        ? "Add a duration in My day before validation"
                        : undefined
                    }
                    onClick={() => void validate([period])}
                  >
                    Validate
                  </button>
                )}
              </div>
            ))}
            {(pending.length > 2 || readyPending.length > 0) && (
              <div className="pill-row">
                <small>
                  {pending.length > 2
                    ? `+ ${pending.length - 2} more`
                    : pending.length - readyPending.length > 0
                      ? `${pending.length - readyPending.length} need case or duration`
                      : ""}
                </small>
                {readyPending.length > 0 && (
                  <button
                    className="pill-button action"
                    disabled={busy}
                    title={
                      pending.length > readyPending.length
                        ? `${pending.length - readyPending.length} periods still need a case or duration`
                        : undefined
                    }
                    onClick={() => void validate(readyPending)}
                  >
                    Validate all {readyPending.length}
                  </button>
                )}
              </div>
            )}
          </div>
          {showQuestion && (
            <div className="pill-question">
              <strong>Which case was this? · {questionPeriod?.label}</strong>
              {questionSelect}
              <button
                className="pill-button"
                disabled={busy}
                onClick={() => void excludeQuestion()}
              >
                Not client work
              </button>
            </div>
          )}
          <footer>
            <button className="pill-button" disabled={!active || busy} onClick={togglePause}>
              {paused ? "Resume" : "Pause"}
            </button>
            <select
              aria-label="Change case"
              value=""
              disabled={!current || busy}
              onChange={(event) => void assign(current!.id, event.target.value)}
            >
              <option value="">Change case</option>
              {caseOptions}
            </select>
            <button className="pill-button" onClick={openDay}>
              Open TimeKeeper
            </button>
          </footer>
        </section>
      )}
      {notice && !offline && (
        <section
          className={"pill-notice" + (closingSwitch ? " closing" : "")}
          role="status"
          aria-label="File switch suggestion"
        >
          <button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>
            ×
          </button>
          <span className="pill-note-icon">!</span>
          <div className="pill-note-body">
            <strong>Switched to {notice.windowTitle}</strong>
            <small>
              {notice.recognition.suggestion
                ? `${notice.recognition.suggestion.title}? · ${notice.recognition.suggestion.reason}`
                : "Which case is this?"}
            </small>
            <div className="pill-note-actions">
              <button
                className="pill-button action"
                disabled={!notice.recognition.suggestion || busy}
                onClick={() => void switchTo(notice, notice.recognition.suggestion?.caseId ?? null)}
              >
                Confirm
                {notice.recognition.confidence === "high" ? ` · ${notice.seconds}s` : ""}
              </button>
              <select
                aria-label="Other case"
                value={selectedCase}
                disabled={busy}
                onChange={(event) => {
                  setSelectedCase(event.target.value);
                  if (event.target.value) void switchTo(notice, event.target.value);
                }}
              >
                <option value="">Choose a case…</option>
                {[
                  ...notice.recognition.alternatives,
                  ...openCases
                    .filter(
                      (item) =>
                        !notice.recognition.alternatives.some((alt) => alt.caseId === item.id),
                    )
                    .map((item) => ({ caseId: item.id, title: item.title })),
                ].map((item) => (
                  <option key={item.caseId} value={item.caseId}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="pill-note-actions">
              <button
                className="pill-button text"
                disabled={busy}
                onClick={() => void switchTo(notice, null)}
              >
                Not client work
              </button>
              <button className="pill-button text" onClick={dismiss}>
                Later
              </button>
            </div>
          </div>
        </section>
      )}
      {recent && !notice && !expanded && !offline && (
        <section className="pill-notice" role="status" aria-label="New work period">
          <button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>
            ×
          </button>
          <span className="pill-note-icon">
            <Logo compact wordmark={false} />
          </span>
          <div className="pill-note-body">
            <strong>New period recognized</strong>
            <small>{recent.title} · review the new period in My day</small>
            <div className="pill-note-actions">
              <button
                className="pill-button action"
                disabled={
                  !recentPeriod?.caseId ||
                  !recentPeriod ||
                  effectiveMs(recentPeriod) === null ||
                  busy
                }
                title={
                  !recentPeriod || effectiveMs(recentPeriod) === null
                    ? "Add a duration in My day first"
                    : undefined
                }
                onClick={() => recentPeriod && void validate([recentPeriod])}
              >
                Validate
              </button>
              <select
                aria-label="Change new period case"
                value=""
                disabled={!recentPeriod || busy}
                onChange={(event) => {
                  if (event.target.value) void assign(recent.id, event.target.value);
                }}
              >
                <option value="">Change case…</option>
                {caseOptions}
              </select>
            </div>
            <div className="pill-note-actions">
              <button className="pill-button text" onClick={openDay}>
                Open TimeKeeper
              </button>
              <button className="pill-button text" onClick={dismiss}>
                Later
              </button>
            </div>
          </div>
        </section>
      )}
      {showQuestionNotice && !notice && !recent && !expanded && !offline && (
        <section className="pill-notice" role="status" aria-label="Which case">
          <button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>
            ×
          </button>
          <span className="pill-note-icon">!</span>
          <div className="pill-note-body">
            <strong>Which case was this?</strong>
            <small>
              {time(questionPeriod?.startedAt)}–{time(questionPeriod?.endedAt)} ·{" "}
              {questionPeriod?.label}
            </small>
            <div className="pill-note-actions">{questionSelect}</div>
            <div className="pill-note-actions">
              <button
                className="pill-button text"
                disabled={busy}
                onClick={() => void excludeQuestion()}
              >
                Not client work
              </button>
              <button className="pill-button text" onClick={dismiss}>
                Later
              </button>
            </div>
          </div>
        </section>
      )}
      {!tauri && (
        <label className="pill-simulate">
          Simulate file switch
          <select
            aria-label="Simulate file switch"
            value=""
            disabled={paused}
            title={paused ? "File-switch detection is paused" : undefined}
            onChange={(event) => void showSwitch(event.target.value, "Demo documents")}
          >
            <option value="">Choose a demo document</option>
            {demoDocuments.map((file) => (
              <option key={file} value={file}>
                {file === "Program Manager" ? "Program Manager (non-document)" : file}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="pill-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
