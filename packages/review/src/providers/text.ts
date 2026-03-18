import type { ProviderConfig } from './types.js';

/**
 * Returns the provided text as is
 * @param _ config (unused in this provider)
 * @param text Text to return
 * @returns The provided text
 */
export async function get(
  _: ProviderConfig | null,
  text: string | undefined
): Promise<string | null> {
  return text ?? null;
}
