import { readFileSync, writeFileSync } from "node:fs";
import { format, resolveConfig } from "prettier";
import { stateDefinitions, stateObjects } from "../src/backend/domain/states.js";

const path = new URL("../src/contracts/openapi.yaml", import.meta.url);
const contract = JSON.parse(readFileSync(path, "utf8"));

// Named vocabulary components are generated. Other API schemas remain contract-owned.
for (const [name, values] of Object.entries(stateDefinitions)) {
  contract.components.schemas[name] = {
    type: "string",
    enum: [...values],
    description: "Generated from backend/domain/states.ts. Run npm run contract:gen.",
  };
}

writeFileSync(
  path,
  await format(JSON.stringify(contract), {
    ...(await resolveConfig(path)),
    parser: "json",
  }),
);

const runtime = Object.entries(stateObjects)
  .map(
    ([name, definition]) =>
      `export const ${name} = ${JSON.stringify(definition)} as const;\n` +
      `export type ${name} = (typeof ${name})[keyof typeof ${name}];`,
  )
  .join("\n\n");
writeFileSync(
  new URL("../src/contracts/states.generated.ts", import.meta.url),
  await format(`// Generated from backend/domain/states. Run npm run contract:gen.\n${runtime}\n`, {
    ...(await resolveConfig(path)),
    parser: "typescript",
  }),
);
