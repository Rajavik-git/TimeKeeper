import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadApplication, refreshApplication, useResource } from "../../../api/queries";
import { useToday } from "../../../shared/hooks/useToday";
import { usePillPosition, tauri } from "../hooks/usePillPosition";
import { usePillCommands } from "../hooks/usePillCommands";
import { nativePillView } from "../lib/nativePillView";
export function usePillController() {
  const application = useResource("pill", loadApplication, 5000);
  const catalogState = application.data?.catalogState;
  const workspaceState = application.data?.workspaceState;
  const offline = application.isError;
  const today = useToday();
  const previousPeriodId = useRef<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [recent, setRecent] = useState<{ id: string; title: string } | null>(null);
  const [selectedCase, setSelectedCase] = useState("");
  const [dismissedQuestion, setDismissedQuestion] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      await refreshApplication();
    } catch {
      // The resource state reports the failure as offline.
    }
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

  const {
    active,
    current,
    caseById,
    caseItem,
    owner,
    setting,
    currency,
    pending,
    readyPending,
    question,
    questionPeriod,
    showQuestion,
    showQuestionNotice,
    periodMs,
    hourlyRate,
    amount,
    barValue,
    todayAmount,
  } = nativePillView(catalogState, workspaceState, today, dismissedQuestion);
  const { feedback, error, setError, busy, validate, assign, excludeQuestion, undo } =
    usePillCommands({
      workspaceState,
      today,
      question,
      questionPeriod,
      caseById,
      refresh,
      setExpanded,
      setRecent,
      setSelectedCase,
      setDismissedQuestion,
    });
  const notification = !!recent || (!expanded && showQuestionNotice);
  const { above, rootStyle, beginDrag, dragMove, endDrag, dragKey, moveBy } = usePillPosition({
    alwaysOnTop: setting?.pillAlwaysOnTop,
    expanded,
    recent,
    notification,
    error,
    setError,
  });

  // Polling reflects transitions accepted by JEV. The pill never produces transitions.
  useEffect(() => {
    if (!workspaceState) return;
    const id = current?.id;
    if (id && previousPeriodId.current && id !== previousPeriodId.current) {
      setRecent({ id, title: caseItem?.title ?? "Which case?" });
    }
    previousPeriodId.current = id;
  }, [workspaceState, current?.id, caseItem?.title]);
  const questionId = question?.questionId;
  const dismiss = useCallback(() => {
    setRecent(null);
    setExpanded(false);
    setSelectedCase("");
    if (questionId) setDismissedQuestion(questionId);
  }, [questionId]);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (recent || showQuestionNotice || expanded)) {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [recent, showQuestionNotice, expanded, dismiss]);

  const openDay = () => {
    if (tauri) void invoke("open_my_day").catch(() => setError("Unable to open TimeKeeper."));
    else window.open("/", "_blank");
  };
  const openCases = catalogState?.cases.filter((item) => item.status === "active") ?? [];
  const recentPeriod = workspaceState?.periods.find((period) => period.id === recent?.id);
  const togglePanel = () =>
    offline ? void refresh() : recent || showQuestionNotice ? dismiss() : setExpanded(!expanded);
  return {
    native: tauri,
    above,
    rootStyle,
    beginDrag,
    dragMove,
    endDrag,
    dragKey,
    moveBy,
    offline,
    togglePanel,
    expanded,
    active,
    feedback,
    owner,
    caseItem,
    setting,
    barValue,
    pending,
    busy,
    undo,
    hourlyRate,
    currency,
    current,
    periodMs,
    amount,
    todayAmount,
    readyPending,
    today,
    validate,
    showQuestion,
    questionPeriod,
    selectedCase,
    setSelectedCase,
    assign,
    error,
    excludeQuestion,
    openDay,
    openCases,
    recent,
    recentPeriod,
    dismiss,
    showQuestionNotice,
    caseById,
  };
}
