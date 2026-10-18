/** Numeric settings are validated before they reach transport or workflow code. No files are read here. */
export function numberSetting(
  name: string,
  value: string | undefined,
  options: { defaultValue: number; min: number; max?: number; integer?: boolean },
): number {
  const number = value === undefined || value.trim() === "" ? options.defaultValue : Number(value);
  if (
    !Number.isFinite(number) ||
    number < options.min ||
    number > (options.max ?? Number.MAX_SAFE_INTEGER) ||
    (options.integer && !Number.isInteger(number))
  ) {
    throw new Error(
      `${name} must be a finite ${options.integer ? "integer" : "number"} between ${options.min} and ${options.max ?? Number.MAX_SAFE_INTEGER}.`,
    );
  }
  return number;
}

const DEFAULT_MCP_PORT = 3032;

export function mcpHttpConfig(
  env: Record<string, string | undefined> = process.env,
  portArgument?: string,
): { port: number; url: string } {
  const port = numberSetting("TIMEKEEPER_MCP_PORT", portArgument ?? env.TIMEKEEPER_MCP_PORT, {
    defaultValue: DEFAULT_MCP_PORT,
    min: 1,
    max: 65535,
    integer: true,
  });
  return { port, url: `http://127.0.0.1:${port}/mcp` };
}
