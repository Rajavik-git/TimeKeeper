import { useCallback, useEffect, useState } from "react";
import { sameId, type EntityId } from "../../api/client";

const storageKey = "timekeeper-recent-cases";
const recentLimit = 3;

function storedRecent(): EntityId[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(ids)) return [];
    return ids
      .filter(
        (id): id is EntityId =>
          (typeof id === "string" && id.length > 0) || Number.isSafeInteger(id),
      )
      .slice(0, recentLimit);
  } catch {
    return [];
  }
}

export function useRecentCases() {
  const [recentIds, setRecentIds] = useState(storedRecent);
  const rememberCase = useCallback((id: EntityId) => {
    setRecentIds((previous) =>
      [id, ...previous.filter((prior) => !sameId(prior, id))].slice(0, recentLimit),
    );
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(recentIds));
    } catch {
      // Recent navigation remains available in memory when storage is unavailable.
    }
  }, [recentIds]);

  return { recentIds, rememberCase };
}
