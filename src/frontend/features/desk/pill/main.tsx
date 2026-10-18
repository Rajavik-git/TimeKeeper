import { AssignmentOrigin, QuestionStatus } from "../../../../contracts/states.generated";
import { loadApplication, useResource, refreshApplication } from "../../../api/queries";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../../../api/client";
import { performAction } from "../../../api/actions";
import { WorkPill } from "../components/WorkPill/WorkPill";
import { pillView } from "../lib/pillView";
import { restoreTheme } from "../../../shared/components/ThemeSwitch/ThemeSwitch";
import "./styles.css";

const tauri = "__TAURI_INTERNALS__" in window;
restoreTheme();
function Pill() {
  const application = useResource("pill", loadApplication, 5000);
  const state = application.data?.catalogState;
  const workspaceState = application.data?.workspaceState;
  const offline = application.isError;
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const refresh = refreshApplication;
  const view = pillView(state, workspaceState, offline);
  const current = view.current;
  const setting = state?.settings;
  const alwaysOnTop = setting?.pillAlwaysOnTop;
  useEffect(() => {
    if (tauri && alwaysOnTop !== undefined)
      void getCurrentWindow()
        .setAlwaysOnTop(alwaysOnTop)
        .catch(() => setError("Unable to apply pill position"));
  }, [alwaysOnTop]);
  const notice = dismissed ? null : view.notice;
  useEffect(() => {
    if (tauri)
      void invoke("set_pill_expanded", { expanded, notification: Boolean(notice && !expanded) });
  }, [expanded, notice]);
  const toggle = async () => {
    const next = !expanded;
    if (tauri)
      try {
        await invoke("set_pill_expanded", {
          expanded: next,
          notification: Boolean(notice && !next),
        });
      } catch {
        setError("Unable to resize the pill");
        return;
      }
    setExpanded(next);
  };
  const openDay = () => {
    if (tauri) void invoke("open_my_day").catch(() => setError("Unable to open TimeKeeper"));
    else window.open("/", "_blank");
  };
  const assign = async (caseId: string) => {
    if (!current) return;
    const targetQuestion = workspaceState?.questions.find(
      (q) => q.periodId === current.id && q.status === QuestionStatus.Pending,
    );
    const request = targetQuestion
      ? api.POST("/api/questions/answer", {
          body: {
            questionId: targetQuestion.questionId,
            sessionId: targetQuestion.sessionId,
            periodId: current.id,
            expectedAssignmentRevision: targetQuestion.expectedAssignmentRevision,
            caseId,
            responseCommandId: crypto.randomUUID(),
          },
        })
      : api.POST("/api/work-periods/{id}/assignment", {
          params: { path: { id: current.id } },
          body: {
            caseId,
            expectedAssignmentRevision: current.assignmentRevision,
            origin: AssignmentOrigin.Lawyer,
          },
        });
    setError("");
    await performAction<unknown>(request, refresh, setError);
  };
  return (
    <main className="pill-root">
      <WorkPill
        view={view}
        expanded={expanded}
        onToggle={() => void toggle()}
        onAssign={(caseId) => void assign(caseId)}
        onOpenDay={openDay}
        onDismiss={() => setDismissed(true)}
        notice={notice}
        error={error}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Pill />);
