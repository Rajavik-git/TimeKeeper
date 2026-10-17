import { useEffect, useState } from "react";
import type { ScreenProps } from "../../api/client";
import "./Settings.css";
import { ClientsSection } from "./ClientsSection";
import { RatesSection } from "./RatesSection";
import { TasksSection } from "./TasksSection";
import { RulesSection } from "./RulesSection";
import { PillSection } from "./PillSection";
import { PreferencesSection } from "./PreferencesSection";

type Tab = "clients" | "rates" | "tasks" | "rules" | "prefs" | "pill";
const tabs: [Tab, string][] = [
  ["clients", "Clients"],
  ["rates", "Rates"],
  ["tasks", "Tasks"],
  ["rules", "Client rules"],
  ["prefs", "Capture and invoices"],
  ["pill", "Desk pill"],
];
export function Settings({ catalogState, workspaceState, action, navigate }: ScreenProps) {
  const [tab, setTab] = useState<Tab>("clients");
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const saved = async (operation: Promise<unknown>) => {
    setToast("Saving…");
    const success = (await operation) !== undefined;
    setToast(success ? "Saved" : "");
    return success;
  };
  const sectionProps = { catalogState, workspaceState, action, navigate, saved, notify: setToast };
  return (
    <>
      {toast && (
        <div className="settings-toast" role="status">
          {toast}
        </div>
      )}
      <div className="settings-crumbs">
        Settings{" "}
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m5 3 4 4-4 4" />
        </svg>{" "}
        <b>{tabs.find((item) => item[0] === tab)?.[1]}</b>
      </div>
      <div className="ph settings-head">
        <div className="t">
          <h1>Settings</h1>
          <p>Rates, tasks, client rules and capture preferences.</p>
        </div>
      </div>
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
        {tab === "clients" && <ClientsSection {...sectionProps} />}
        {tab === "rates" && <RatesSection {...sectionProps} />}
        {tab === "tasks" && <TasksSection {...sectionProps} />}
        {tab === "rules" && <RulesSection {...sectionProps} />}
        {tab === "pill" && <PillSection {...sectionProps} />}
        {tab === "prefs" && <PreferencesSection {...sectionProps} />}
      </div>
    </>
  );
}
