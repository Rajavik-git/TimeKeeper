import type { Catalog } from '../domain/recognition.js';
import { recognize } from '../domain/recognition.js';

export type WindowCase = Catalog['matters'][number] & {
  title: string;
  status: string;
  opposing_party?: string | null;
};
export interface WindowCatalog extends Omit<Catalog, 'matters'> {
  matters: WindowCase[];
}
export interface CaseSuggestion {
  caseId: string;
  client: string;
  title: string;
  reference: string;
  reason: string;
}

export function recognizeWindow(windowTitle: string, appName: string, catalog: WindowCatalog): {
  suggestion: CaseSuggestion | null;
  alternatives: CaseSuggestion[];
  confidence: 'high' | 'low';
} {
  const open = catalog.matters.filter(m => m.status === 'open');
  const candidates = recognize({ app: appName, window_title: windowTitle }, {
    ...catalog,
    matters: open,
    markers: [...catalog.markers, ...open.filter(m => m.opposing_party).map(m => ({
      id: -m.id, matter_id: m.id, type: 'opposing_party' as const,
      value: m.opposing_party!, weight: 0.6,
    }))],
  });
  const mapped = candidates.map(candidate => {
    const matter = open.find(m => m.id === candidate.matter_id)!;
    const client = catalog.clients.find(c => c.id === matter.client_id);
    const first = candidate.found[0];
    return { caseId: String(matter.id), client: client?.name ?? '', title: matter.title,
      reference: matter.reference, reason: first ? `${first.type.replaceAll('_', ' ')}: ${first.value}` : '' };
  });
  const top = candidates[0];
  const tied = !!top && candidates.some(candidate => candidate !== top && candidate.score === top.score);
  return { suggestion: mapped[0] ?? null, alternatives: mapped.slice(1, 4),
    confidence: top && !tied && top.score >= 0.8 ? 'high' : 'low' };
}
