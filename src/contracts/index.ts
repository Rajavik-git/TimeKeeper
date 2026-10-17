// Shared transport types, derived from the generated contract so there is one source of truth (docs/API.md E11).
// Change src/contracts/openapi.yaml, run `npm run contract:gen`, and these follow.
import type { components, paths } from './generated.js';

type Schemas = components['schemas'];
type JsonBody<P extends keyof paths> = paths[P] extends { post: { requestBody: { content: { 'application/json': infer B } } } } ? B : never;

export type Id = string;
export type Revision = number;
export type ApiError = Schemas['Error'];
export type ErrorCode = ApiError['error'];
export type StartCommand = JsonBody<'/api/commands/start'>;
export type EndCommand = JsonBody<'/api/commands/end'>;
export type QuestionAnswer = JsonBody<'/api/questions/answer'>;
export type CommandOutcome = Schemas['CommandOutcome'];
/** A work period as returned by the API; `clientId` is added where the client is derived. */
export type PeriodView = Omit<Schemas['WorkPeriod'], 'clientId'>;
