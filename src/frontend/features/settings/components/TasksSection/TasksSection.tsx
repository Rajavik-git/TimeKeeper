import { useState } from "react";
import { TaskEditorDialog } from "../TaskEditorDialog/TaskEditorDialog";
import { AddButton } from "../AddButton/AddButton";
import { cardHead } from "../../lib/sectionPresentation";
import { useSettingsSort } from "../../hooks/useSettingsSort";
import { type SectionProps } from "../../types";

export function TasksSection({ catalogState, action, notify }: SectionProps) {
  const [add, setAdd] = useState(false);
  const [editTask, setEditTask] = useState<number | null>(null);
  const { head, sorted } = useSettingsSort("tasks", notify);
  const selectedTask = catalogState.taskTypes.find((task) => task.id === editTask);
  return (
    <section className="card settings-card">
      {cardHead(
        "Tasks",
        "Types of work and how they are billed by default.",
        <AddButton open={false} onToggle={() => setAdd(!add)} label="Add task" />,
      )}
      <div className="settings-table">
        <table className="data-table">
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
      {(add || selectedTask) && (
        <TaskEditorDialog
          task={selectedTask}
          action={action}
          notify={notify}
          close={() => {
            setAdd(false);
            setEditTask(null);
          }}
        />
      )}
    </section>
  );
}
