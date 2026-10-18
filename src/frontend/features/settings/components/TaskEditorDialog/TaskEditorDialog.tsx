import { SystemTaskCode } from "../../../../../contracts/states.generated";
import { useState } from "react";
import { api, type State } from "../../../../api/client";
import { Modal } from "../../../../shared/components/Modal/Modal";
import { DraftActions } from "../../../../shared/components/DraftActions/DraftActions";
import { useDraftDialog } from "../../../../shared/hooks/useDraftDialog";
import type { SectionProps } from "../../types";

type Task = State["taskTypes"][number];
export function TaskEditorDialog({
  task,
  action,
  close,
  notify,
}: Pick<SectionProps, "action" | "notify"> & { task?: Task; close: () => void }) {
  const systemTask =
    task !== undefined && Object.values(SystemTaskCode).some((code) => code === task.code);
  const initial = {
    code: task?.code ?? "",
    label: task?.label ?? "",
    billableByDefault: task?.billableByDefault ?? true,
    offScreen: task?.offScreen ?? false,
  };
  const [draft, setDraft] = useState(initial);
  const form = useDraftDialog(close, JSON.stringify(initial) !== JSON.stringify(draft));
  const title = task ? `Edit ${task.label}` : "Add task";
  return (
    <Modal label={title} close={form.requestClose}>
      <form
        className="modal col catalog-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit(async () => {
            if (!draft.label.trim() || !draft.code.trim()) {
              form.setError("Enter a task code and label.");
              return;
            }
            const body = {
              ...draft,
              code: systemTask ? task.code : draft.code.trim().toUpperCase(),
              label: draft.label.trim(),
            };
            const result = await action(
              task
                ? api.PATCH("/api/catalog/task-types/{id}", {
                    params: { path: { id: task.id } },
                    body,
                  })
                : api.POST("/api/catalog/task-types", { body }),
              form.setError,
            );
            if (result) {
              close();
              notify("Task saved");
            } else
              form.setError(
                (current) => current || "Could not save task. Your changes are kept. Try again.",
              );
          });
        }}
      >
        <h2>{title}</h2>
        <fieldset className="catalog-editor-fields" disabled={form.pending}>
          <label>
            Task code
            <input
              className="field"
              required
              autoFocus={!systemTask}
              readOnly={systemTask}
              aria-describedby={systemTask ? "system-task-code" : undefined}
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
            />
          </label>
          {systemTask && (
            <p id="system-task-code" className="muted">
              Built-in task codes are fixed so billing rules stay valid. You can rename the label.
            </p>
          )}
          <label>
            Task label
            <input
              className="field"
              required
              autoFocus={systemTask}
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.billableByDefault}
              onChange={(e) => setDraft({ ...draft, billableByDefault: e.target.checked })}
            />
            Billable by default
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.offScreen}
              onChange={(e) => setDraft({ ...draft, offScreen: e.target.checked })}
            />
            Off-screen
          </label>
        </fieldset>
        {form.error && (
          <p className="settings-error" role="alert">
            {form.error}
          </p>
        )}
        <DraftActions
          discarding={form.discarding}
          keepEditing={() => form.setDiscarding(false)}
          discard={close}
        />
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={form.pending} onClick={form.requestClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={form.pending}>
            {form.pending ? "Saving…" : task ? "Save task" : "Add task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
