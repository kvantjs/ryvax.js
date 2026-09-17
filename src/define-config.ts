import type { AppConfig } from './types.js';

/**
 * Preserves AppConfig inference in framework.config.ts without adding runtime behavior.
 */
export function defineConfig<const T extends AppConfig>(config: T): T {
  return config;
}
