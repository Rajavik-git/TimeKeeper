export type AssignmentRow = Record<string, unknown>;

export interface AssignmentPort {
  transaction<T>(work: () => T): T;
  timeEntry(id: number): AssignmentRow | undefined;
  block(id: number): AssignmentRow | undefined;
  markers(): AssignmentRow[];
  updateTimeEntry(id: number, values: AssignmentRow): AssignmentRow;
  updateBlock(id: number, values: AssignmentRow): AssignmentRow;
  addMarker(values: AssignmentRow): AssignmentRow;
  reprice(): void;
  audit(action: string, before: string, after: string, entryId: number, blockId: number | null, actor?: string): void;
}
