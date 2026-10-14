export {};

declare global {
  interface Window {
    customCards?: Array<{
      type: string;
      name: string;
      description: string;
      preview?: boolean;
    }>;
  }

  /** Injected at build time by Vite from package.json (see vite.config.ts). */
  const __APP_VERSION__: string;
}