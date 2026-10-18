import { useState, type Ref } from "react";
import {
  api,
  caseById,
  type CoreState,
  type EntityId,
  type ScreenProps,
} from "../../../../api/client";
import { calendarTime } from "../../../../../shared/dates";
import { CaseSelect } from "../../../../shared/components/CaseSelect/CaseSelect";
import { Icon } from "../../../../shared/components/Icon/Icon";
import { showToast } from "../../../../shared/components/Toast/Toast";
type Props = Pick<ScreenProps, "catalogState" | "action"> & {
  period: CoreState["periods"][number];
  sectionRef: Ref<HTMLElement>;
  assign: (periodId: string, caseId: EntityId) => Promise<unknown> | undefined;
  onAssigned: (periodId: string) => void;
};
export function DayCaseQuestion({
  period,
  sectionRef,
  catalogState,
  action,
  assign,
  onAssigned,
}: Props) {
  const [answerCase, setAnswerCase] = useState<EntityId | null>(null);
  const [answering, setAnswering] = useState(false);
  const [excluding, setExcluding] = useState(false);
  return (
    <section className="card day-question" ref={sectionRef} tabIndex={-1}>
      <div>
        <h2>
          <Icon name="alert" small /> Which case was this?
        </h2>
        <p>
          {calendarTime(period.startedAt)}–
          {period.endedAt ? calendarTime(period.endedAt) : "Open period"} ·{" "}
          {period.observedWindowTitle ?? period.label}
        </p>
      </div>
      <div className="row">
        <CaseSelect
          catalogState={catalogState}
          value={answerCase}
          allowEmpty
          onChange={setAnswerCase}
        />
        <button
          className="btn primary"
          aria-disabled={!answerCase}
          disabled={answering}
          aria-busy={answering}
          onClick={async () => {
            if (!answerCase) {
              showToast("Choose a case first");
              return;
            }
            setAnswering(true);
            showToast("Assigning case…");
            const periodId = period.id;
            const result = await assign(periodId, answerCase);
            setAnswering(false);
            if (result) {
              showToast(`Assigned to ${caseById(catalogState, answerCase)?.title ?? "case"}`);
              onAssigned(periodId);
            } else showToast("Could not assign this case");
          }}
        >
          {answering ? "Answering…" : "Answer"}
        </button>
        <button
          className="btn"
          disabled={excluding}
          aria-busy={excluding}
          onClick={async () => {
            const periodId = period.id;
            setExcluding(true);
            const result = await action(
              api.PATCH("/api/work-periods/{id}/details", {
                params: { path: { id: periodId } },
                body: { excluded: true, expectedRevision: period.revision },
              }),
            );
            setExcluding(false);
            if (result)
              showToast(
                "Period excluded from totals",
                "Undo",
                () =>
                  void action(
                    api.PATCH("/api/work-periods/{id}/details", {
                      params: { path: { id: periodId } },
                      body: { excluded: false, expectedRevision: result.revision },
                    }),
                  ),
              );
          }}
        >
          Exclude from totals
        </button>
      </div>
    </section>
  );
}
