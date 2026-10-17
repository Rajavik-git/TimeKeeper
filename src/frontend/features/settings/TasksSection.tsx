import { useState } from "react";
import type { components } from "../../../contracts/generated";
import { api } from "../../api/client";
import { AddButton, cardHead, useSettingsSort, type SectionProps } from "./shared";

export function TasksSection({ catalogState, action, saved, notify }: SectionProps) {
  const [add, setAdd] = useState(false);
  const [editTask, setEditTask] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const { head, sorted } = useSettingsSort("tasks", notify);
  const patchTask = (id: number, body: components["schemas"]["PatchCatalogTaskTypeRequest"]) =>
    saved(action(api.PATCH("/api/catalog/task-types/{id}", { params: { path: { id } }, body })));
  return (
    <section className="settings-card">
      {cardHead(
        "Tasks",
        "Types of work and how they are billed by default.",
        <AddButton open={add} onToggle={() => setAdd(!add)} label="Add task" />,
      )}
      <div className="settings-table">
        <table>
          <thead>
            <tr>
              {head(0, "Task")}
              {head(1, "Billable by default")}
              {head(2, "Off-screen")}
            </tr>
          </thead>
          <tbody>
            {catalogState.taskTypes.length === 0 && (
              <tr>
                <td className="settings-empty" colSpan={3}>
                  No tasks yet.{" "}
                  <button className="link" onClick={() => setAdd(true)}>
                    Add a task
                  </button>
                </td>
              </tr>
            )}
            {sorted(catalogState.taskTypes, (task) => [
              task.label,
              Number(task.billableByDefault),
              Number(task.offScreen),
            ]).map((task) => (
              <tr key={task.id} data-editing={editTask === task.id}>
                <td title={task.label}>
                  <button
                    className="settings-task-edit"
                    aria-expanded={editTask === task.id}
                    onClick={() => setEditTask(editTask === task.id ? null : task.id)}
                  >
                    {task.label}
                  </button>
                </td>
                <td>{task.billableByDefault ? "Yes" : <span className="muted">No</span>}</td>
                <td>{task.offScreen ? "Yes" : <span className="muted">No</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editTask && (
        <div className="settings-inline">
          <label className="check">
            <input
              type="checkbox"
              checked={
                catalogState.taskTypes.find((item) => item.id === editTask)?.billableByDefault ??
                false
              }
              onChange={(event) =>
                patchTask(editTask, {
                  billableByDefault: event.target.checked,
                })
              }
            />{" "}
            Billable by default
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={
                catalogState.taskTypes.find((item) => item.id === editTask)?.offScreen ?? false
              }
              onChange={(event) => patchTask(editTask, { offScreen: event.target.checked })}
            />{" "}
            Off-screen
          </label>
        </div>
      )}
      {add && (
        <form
          className="settings-inline"
          onSubmit={async (event) => {
            event.preventDefault();
            const success = await saved(
              action(
                api.POST("/api/catalog/task-types", {
                  body: { code: code.toUpperCase(), label: name },
                }),
              ),
            );
            if (success) {
              setCode("");
              setName("");
              setAdd(false);
            }
          }}
        >
          <input
            className="input"
            placeholder="CODE"
            aria-label="Task code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <input
            className="input"
            placeholder="Label"
            aria-label="Task label"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="btn primary">Add task</button>
        </form>
      )}
    </section>
  );
}
