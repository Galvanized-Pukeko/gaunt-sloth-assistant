/**
 * Simple in-memory artifact store shared across commands.
 * Allows middleware and modules to exchange structured data.
 */

const artifacts = new Map<string, unknown>();

export type ArtifactValue<T = unknown> = T;

/**
 * Store an artifact value by key.
 */
export function setArtifact<T>(key: string, value: ArtifactValue<T>): void {
  artifacts.set(key, value);
}

/**
 * Retrieve an artifact value by key.
 */
export function getArtifact<T>(key: string): ArtifactValue<T> | undefined {
  return artifacts.get(key) as ArtifactValue<T> | undefined;
}

/**
 * Remove an artifact by key.
 */
export function deleteArtifact(key: string): void {
  artifacts.delete(key);
}

/**
 * Clear all stored artifacts.
 */
export function clearArtifacts(): void {
  artifacts.clear();
}
