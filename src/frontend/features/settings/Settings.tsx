import {
  ActionNotice,
  NOTICE_DURATION_MS,
} from "../../shared/components/ActionNotice/ActionNotice";
import { PageHeader } from "../../shared/components/PageHeader/PageHeader";
import { useEffect, useState } from "react";
import type { ScreenProps } from "../../api/client";
import { ClientsSection } from "./components/ClientsSection/ClientsSection";
import { RatesSection } from "./components/RatesSection/RatesSection";
import { TasksSection } from "./components/TasksSection/TasksSection";
import { RulesSection } from "./components/RulesSection/RulesSection";
import { PillSection } from "./components/PillSection/PillSection";
import { PreferencesSection } from "./components/PreferencesSection/PreferencesSection";

type Tab = "clients" | "rates" | "tasks" | "rules" | "prefs" | "pill";
const tabs: [Tab, string][] = [
  ["clients", "Clients"],
  ["rates", "Rates"],
  ["tasks", "Tasks"],
  ["rules", "Client rules"],
  ["prefs", "Capture and invoices"],
  ["pill", "Desk pill"],
];
export function Settings({
  catalogState,
  action,
  navigate,
}: Pick<ScreenProps, "catalogState" | "action" | "navigate">) {
  const [tab, setTab] = useState<Tab>("clients");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(0);
  useEffect(() => {
    if (!toast || saving) return;
    const timer = window.setTimeout(() => setToast(""), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast, saving]);
  const saved = async (operation: Promise<unknown>) => {
    setSaving((current) => current + 1);
    setToast("Saving…");
    try {
      const success = (await operation) !== undefined;
      setToast(success ? "Saved" : "Could not save. Your changes are kept. Try again.");
      return success;
    } finally {
      setSaving((current) => current - 1);
    }
  };
  const sectionProps = { catalogState, action, navigate, saved, notify: setToast };
  return (
    <>
      {toast && <ActionNotice message={toast} dismiss={() => setToast("")} />}
      <div className="settings-crumbs">
        Settings{" "}
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m5 3 4 4-4 4" />
        </svg>{" "}
        <b>{tabs.find((item) => item[0] === tab)?.[1]}</b>
      </div>
      <PageHeader
        className="ph settings-head"
        title={<>Settings</>}
        description={<>Rates, tasks, client rules, invoices, and Desk pill preferences.</>}
      />
      <nav className="settings-nav" aria-label="Settings sections">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "true" : undefined}
            onClick={() => {
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <div hidden={tab !== "clients"}>
          <ClientsSection {...sectionProps} />
        </div>
        <div hidden={tab !== "rates"}>
          <RatesSection {...sectionProps} />
        </div>
        <div hidden={tab !== "tasks"}>
          <TasksSection {...sectionProps} />
        </div>
        <div hidden={tab !== "rules"}>
          <RulesSection {...sectionProps} />
        </div>
        <div hidden={tab !== "pill"}>
          <PillSection {...sectionProps} />
        </div>
        <div hidden={tab !== "prefs"}>
          <PreferencesSection {...sectionProps} />
        </div>
      </div>
    </>
  );
}
