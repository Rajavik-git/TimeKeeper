import { SourcePackOption, SourcePackScope } from "../../src/contracts/states.generated";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import {
  defaultSourcePackOptions,
  selectableSourcePackOptions,
  sourcePackOptionLabels,
  sourcePackScopeLabels,
} from "../../src/frontend/shared/presentation/source-pack";
import { requestContract } from "../../src/contracts/request-contract.generated";
import { SourceExportService } from "../../src/backend/application/source-export";
import type { SourceExportRequest, SourceExportPort } from "../../src/backend/ports/source-export";

it("keeps the request validator aligned with all canonical scope and option values", () => {
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile({
    ...requestContract.components.schemas.CanonicalSourcePackRequest,
    components: requestContract.components,
  });
  for (const scope of Object.values(SourcePackScope))
    expect(validate({ scope, options: Object.values(SourcePackOption) }), scope).toBe(true);
  expect(validate({ scope: "whole-case", options: [] })).toBe(false);
  expect(validate({ scope: SourcePackScope.Case, options: ["media"] })).toBe(false);
});

it("rejects unsupported vocabulary before touching persistence, including direct service calls", () => {
  const service = new SourceExportService({} as SourceExportPort);
  for (const request of [
    { scope: "whole-case", options: [] },
    { scope: SourcePackScope.Case, options: ["media"] },
  ])
    expect(() => service.exportCase("case", request as SourceExportRequest)).toThrow(
      /invalid source pack/,
    );
});

it("keeps both dialogs' labels, option order and default contents consistent", () => {
  expect(Object.keys(sourcePackScopeLabels)).toEqual(Object.values(SourcePackScope));
  expect(Object.keys(sourcePackOptionLabels)).toEqual(Object.values(SourcePackOption));
  expect(selectableSourcePackOptions).toEqual([
    SourcePackOption.Personal,
    SourcePackOption.Audio,
    SourcePackOption.Audit,
  ]);
  expect(defaultSourcePackOptions).toEqual([
    SourcePackOption.Blur,
    SourcePackOption.Personal,
    SourcePackOption.Audit,
  ]);
});
