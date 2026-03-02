/**
 * Dump Prompt Option Parser
 *
 * Parses the --dump-prompt CLI option value or DUMP_PROMPT environment variable
 */

/**
 * Parse the --dump-prompt option value
 *
 * Priority:
 * 1. CLI option value (if provided)
 * 2. DUMP_PROMPT environment variable
 * 3. Default: false
 *
 * @param value - The option value from commander
 * @returns boolean indicating if dump is enabled
 *
 * @example
 * parseDumpOption(undefined)  // checks DUMP_PROMPT env, then false
 * parseDumpOption(true)       // true
 * parseDumpOption("true")     // true
 * parseDumpOption("false")    // false
 *
 * @example Environment variable usage
 * DUMP_PROMPT=1 npm run dev
 * DUMP_PROMPT=true npm run dev
 */
export function parseDumpOption(value: string | boolean | undefined): boolean {
  // CLI option takes priority
  if (value !== undefined) {
    if (typeof value === "boolean") {
      return value
    }
    // String value - only "false" explicitly disables
    return value !== "false"
  }

  // Fall back to environment variable
  const envValue = process.env.DUMP_PROMPT
  if (envValue !== undefined) {
    const normalized = envValue.toLowerCase().trim()
    return normalized === "1" || normalized === "true" || normalized === "yes"
  }

  return false
}
