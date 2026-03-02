/**
 * Dump Prompt Option Parser
 *
 * Parses the --dump-prompt CLI option value
 */

/**
 * Parse the --dump-prompt option value
 *
 * @param value - The option value from commander
 * @returns boolean indicating if dump is enabled
 *
 * @example
 * parseDumpOption(undefined)  // false (option not provided)
 * parseDumpOption(true)       // true (--dump-prompt without value)
 * parseDumpOption(false)      // false
 * parseDumpOption("true")     // true
 * parseDumpOption("false")    // false
 */
export function parseDumpOption(value: string | boolean | undefined): boolean {
  if (value === undefined) {
    return false
  }

  if (typeof value === "boolean") {
    return value
  }

  // String value - only "false" explicitly disables
  return value !== "false"
}
