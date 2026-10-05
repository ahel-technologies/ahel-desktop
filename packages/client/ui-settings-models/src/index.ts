/**
 * Models settings surface, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half owns the Models
 * section through exports["./client"]. Every
 * provider section the page edits is owned by the Host plugin that
 * registered it, so this package registers no namespace of its own.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
