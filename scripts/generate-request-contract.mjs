import { readFileSync, writeFileSync } from "node:fs";
const contract = JSON.parse(
  readFileSync(new URL("../src/contracts/openapi.yaml", import.meta.url), "utf8"),
);
const paths = {};
for (const [path, methods] of Object.entries(contract.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (operation.requestBody) {
      (paths[path] ??= {})[method] = { requestBody: operation.requestBody };
    }
  }
}
const schemas = {};
function includeReferences(value) {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string") {
    const name = value.$ref.split("/").at(-1);
    if (!schemas[name]) {
      schemas[name] = contract.components.schemas[name];
      includeReferences(schemas[name]);
    }
  }
  for (const child of Object.values(value)) includeReferences(child);
}
includeReferences(paths);
const output = new URL("../src/contracts/request-contract.generated.ts", import.meta.url);
writeFileSync(
  output,
  `// Generated from openapi.yaml. Run npm run contract:gen.\nexport const requestContract = ${JSON.stringify({ paths, components: { schemas } }, null, 2)} as const;\n`,
);
