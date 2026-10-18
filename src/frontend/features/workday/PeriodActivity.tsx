import { useState, type ComponentProps } from "react";
import { PageHeader } from "../../shared/components/PageHeader/PageHeader";
import { ImportedSources } from "./components/ImportedSources/ImportedSources";
import { HistoryProposals } from "./components/HistoryProposals/HistoryProposals";
import { WorkPeriodActivity } from "./WorkPeriodActivity";

type Props = Omit<ComponentProps<typeof WorkPeriodActivity>, "viewControls">;
type ActivityView = "sources" | "periods" | "history";

/** Imported references remain visible even when detection has not created a work period. */
export function PeriodActivity(props: Props) {
  const [choice, setChoice] = useState<{ requestedPeriod: string; view: ActivityView } | null>(
    null,
  );
  const view =
    choice?.requestedPeriod === props.selected
      ? choice.view
      : props.selected
        ? "periods"
        : "sources";
  const controls = (
    <nav className="activity-views" aria-label="Activity views">
      <button
        type="button"
        className="btn"
        aria-pressed={view === "sources"}
        onClick={() => setChoice({ requestedPeriod: props.selected, view: "sources" })}
      >
        Imported sources <span aria-hidden="true">({props.workspaceState.sources.length})</span>
      </button>
      <button
        type="button"
        className="btn"
        aria-pressed={view === "periods"}
        onClick={() => setChoice({ requestedPeriod: props.selected, view: "periods" })}
      >
        Work periods
      </button>
      <button
        type="button"
        className="btn"
        aria-pressed={view === "history"}
        onClick={() => setChoice({ requestedPeriod: props.selected, view: "history" })}
      >
        History proposals
      </button>
    </nav>
  );
  if (view === "periods") return <WorkPeriodActivity {...props} viewControls={controls} />;
  return (
    <>
      <PageHeader
        title={<>Activity</>}
        description={
          <>Browse all saved source references, including those without a work period.</>
        }
      />
      {controls}
      {view === "history" ? (
        <HistoryProposals
          workspaceState={props.workspaceState}
          catalogState={props.catalogState}
          refresh={props.refresh}
        />
      ) : (
        <ImportedSources
          sources={props.workspaceState.sources}
          periods={props.workspaceState.periods}
          catalogState={props.catalogState}
        />
      )}
    </>
  );
}
