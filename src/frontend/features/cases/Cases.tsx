import { isBudgetWarning } from "../../calculations/case-budget";
import {
  ActionNotice,
  NOTICE_DURATION_MS,
} from "../../shared/components/ActionNotice/ActionNotice";
import { PageHeader } from "../../shared/components/PageHeader/PageHeader";
import { CaseStatus } from "../../../contracts/states.generated";
import { CasesOverview } from "./components/CasesOverview/CasesOverview";
import { CaseDetail } from "./components/CaseDetail/CaseDetail";
import { DownIcon, ChevronIcon } from "./components/CaseIcons/CaseIcons";
import { ClientDetail } from "./components/ClientDetail/ClientDetail";
import { validatePeriods as runValidation, validationMessage } from "../../api/validatePeriods";
import { useToday } from "../../shared/hooks/useToday";
import { sameId, type EntityId } from "../../api/client";
import { ClientEditorDialog } from "../clients/components/ClientEditorDialog/ClientEditorDialog";
import { NewCaseDialog } from "./components/NewCaseDialog/NewCaseDialog";
import { CaseSearch } from "./components/CaseSearch/CaseSearch";
import { useRecentCases } from "./hooks/useRecentCases";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ScreenProps, type Case } from "../../api/client";
import { summarizeWork } from "../../calculations/billing";
import { caseMetrics } from "../../calculations/cases";
import { Icon } from "../../shared/components/Icon/Icon";
import { SourcePackDialog } from "../../shared/components/SourcePackDialog/SourcePackDialog";

export type CasesNavigation = {
  clientId: EntityId | null;
  caseId: EntityId | null;
  tab: "time" | "markers";
};
type CasesProps = ScreenProps & {
  navigationState?: CasesNavigation;
  setNavigationState?: React.Dispatch<React.SetStateAction<CasesNavigation>>;
};

export function Cases({
  catalogState,
  workspaceState,
  action,
  navigate,
  openPeriodActivity,
  openPeriodReview,
  selectedCase,
  refresh,
  navigationState,
  setNavigationState,
}: CasesProps) {
  const today = useToday();

  const [localNavigation, setLocalNavigation] = useState<CasesNavigation>({
    clientId: null,
    caseId: null,
    tab: "time",
  });
  const { clientId, caseId, tab } = navigationState ?? localNavigation;
  const setNavigation = setNavigationState ?? setLocalNavigation;
  const setClientId = useCallback(
    (value: EntityId | null) => setNavigation((current) => ({ ...current, clientId: value })),
    [setNavigation],
  );
  const setCaseId = useCallback(
    (value: EntityId | null) => setNavigation((current) => ({ ...current, caseId: value })),
    [setNavigation],
  );
  const setTab = (value: "time" | "markers") =>
    setNavigation((current) => ({ ...current, tab: value }));
  const [editingClient, setEditingClient] = useState(false);
  const [adding, setAdding] = useState(false);
  const { recentIds, rememberCase } = useRecentCases();
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null);
  const [validatingIds, setValidatingIds] = useState<string[]>([]);
  const validating = validatingIds.length > 0;
  const [pack, setPack] = useState(false);
  const appliedSelectedCase = useRef<string | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const showNotice = (message: string, undo?: () => void) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ message, undo });
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
  };
  useEffect(() => {
    const requestedId = selectedCase === undefined ? undefined : String(selectedCase);
    if (requestedId === appliedSelectedCase.current) return;
    if (requestedId === undefined) appliedSelectedCase.current = undefined;
    if (selectedCase !== undefined) {
      const target = catalogState.cases.find((item) => sameId(item.id, selectedCase));
      if (target) {
        appliedSelectedCase.current = requestedId;
        setClientId(target.clientId);
        setCaseId(target.id);
        rememberCase(target.id);
      }
    }
  }, [selectedCase, catalogState.cases, rememberCase, setClientId, setCaseId]);
  const currentClient = catalogState.clients.find((item) => sameId(item.id, clientId));
  const currentCase = catalogState.cases.find((item) => sameId(item.id, caseId));
  const openClient = (id: EntityId) => {
    setClientId(id);
    setCaseId(null);
  };
  const openCase = (item: Case) => {
    setClientId(item.clientId);
    setCaseId(item.id);
    setTab("time");
    rememberCase(item.id);
  };
  const validatePeriods = async (ids: string[]) => {
    if (validating || !ids.length) return;
    setValidatingIds(ids);
    showNotice(`Validating ${ids.length} period${ids.length === 1 ? "" : "s"}…`);
    try {
      const result = await runValidation(
        workspaceState.periods.filter((period) => ids.includes(period.id)),
        refresh,
      );
      showNotice(
        validationMessage(result.successful, ids.length, result.refreshFailed, result.stale),
      );
    } finally {
      setValidatingIds([]);
    }
  };
  const breadcrumb = currentClient && (
    <nav className="case-breadcrumb" aria-label="Case breadcrumb">
      <button
        onClick={() => {
          setClientId(null);
          setCaseId(null);
        }}
      >
        Cases
      </button>
      {currentClient && (
        <>
          <ChevronIcon />
          {currentCase ? (
            <button onClick={() => openClient(currentClient.id)}>{currentClient.name}</button>
          ) : (
            <strong>{currentClient.name}</strong>
          )}
        </>
      )}
      {currentCase && (
        <>
          <ChevronIcon />
          <strong>{currentCase.title}</strong>
        </>
      )}
    </nav>
  );
  const header = (title: string, description: string, overview = false) => (
    <>
      {breadcrumb}
      <PageHeader
        className="ph"
        title={<>{title}</>}
        description={<>{description}</>}
        actions={
          <div className="actions">
            {overview && (
              <CaseSearch
                catalogState={catalogState}
                workspaceState={workspaceState}
                recentIds={recentIds}
                attentionRows={attentionRows}
                onSelectClient={openClient}
                onSelectCase={openCase}
              />
            )}
            {currentCase && (
              <>
                <button className="btn" onClick={() => setPack(true)}>
                  <DownIcon />
                  Export source pack
                </button>
                <button className="btn" onClick={() => navigate("preInvoices", currentCase.id)}>
                  Billing
                </button>
              </>
            )}
            {currentClient && !currentCase && (
              <button className="btn" onClick={() => setEditingClient(true)}>
                Edit client
              </button>
            )}
            <button className="btn primary" onClick={() => setAdding(true)}>
              <Icon name="plus" small />
              New case
            </button>
          </div>
        }
      />
    </>
  );
  const attentionRows = catalogState.cases
    .filter((item) => item.status === CaseStatus.Active)
    .map((item) => ({ item, metrics: caseMetrics(catalogState, workspaceState, item) }))
    .filter((row) => isBudgetWarning(row.metrics.budgetPercent) || row.metrics.pending > 0)
    .sort(
      (a, b) =>
        (b.metrics.budgetPercent ?? 0) - (a.metrics.budgetPercent ?? 0) ||
        b.metrics.pending - a.metrics.pending,
    );
  let body;
  if (!currentClient) {
    body = (
      <CasesOverview
        catalogState={catalogState}
        workspaceState={workspaceState}
        today={today}
        validatingIds={validatingIds}
        validatePeriods={validatePeriods}
        header={header}
        openClient={openClient}
        openCase={openCase}
        attentionRows={attentionRows}
        showNotice={showNotice}
        navigate={navigate}
      />
    );
  } else if (!currentCase) {
    body = (
      <ClientDetail
        catalogState={catalogState}
        workspaceState={workspaceState}
        currentClient={currentClient}
        header={header}
        openCase={openCase}
        navigate={navigate}
        onNewCase={() => setAdding(true)}
      />
    );
  } else {
    body = (
      <CaseDetail
        catalogState={catalogState}
        workspaceState={workspaceState}
        currentCase={currentCase}
        currentClient={currentClient}
        breadcrumb={breadcrumb}
        tab={tab}
        setTab={setTab}
        showNotice={showNotice}
        validatingIds={validatingIds}
        validatePeriods={validatePeriods}
        onExport={() => setPack(true)}
        navigate={navigate}
        refresh={refresh}
        openPeriodActivity={openPeriodActivity}
        openPeriodReview={openPeriodReview}
      />
    );
  }
  return (
    <>
      {!summarizeWork(workspaceState.periods, workspaceState.sources).complete && (
        <p role="status">Partial totals · some durations or sources are unavailable.</p>
      )}
      {body}
      {notice && (
        <ActionNotice
          message={notice.message}
          dismiss={() => setNotice(null)}
          actionLabel={notice.undo ? "Undo" : undefined}
          onAction={() => {
            notice.undo?.();
            setNotice(null);
            window.clearTimeout(noticeTimer.current);
          }}
        />
      )}
      {pack && currentCase && (
        <SourcePackDialog
          catalogState={catalogState}
          workspaceState={workspaceState}
          caseId={currentCase.id}
          action={action}
          close={() => setPack(false)}
        />
      )}
      {editingClient && currentClient && (
        <ClientEditorDialog
          catalogState={catalogState}
          action={action}
          client={currentClient}
          close={() => setEditingClient(false)}
          onSaved={() => showNotice("Client saved")}
        />
      )}
      {adding && (
        <NewCaseDialog
          initialClientId={currentClient?.id}
          catalogState={catalogState}
          action={action}
          close={() => setAdding(false)}
          onCreated={openCase}
          showNotice={showNotice}
        />
      )}
    </>
  );
}
