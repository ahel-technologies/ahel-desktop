/**
 * Web-search settings page, browser half. Ahel Desktop ships no search
 * provider for this page to edit, so it registers nothing; the package stays
 * so profiles that name it still load.
 */

/** Required services (cordis fiber inject): none. */
export const inject: string[] = []

/** Client plugin body — no page to register. */
export function apply(): void {}
