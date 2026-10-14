/**
 * App version for the startup banner. Injected by Vite from `package.json`
 * (see vite.config.ts) so there is a single source of truth; CI can override
 * it per build via the `APP_VERSION` environment variable.
 */
export const VERSION: string = __APP_VERSION__;