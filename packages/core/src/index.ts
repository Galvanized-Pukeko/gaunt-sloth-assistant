export * from '#src/constants.js';
export * from '#src/core/types.js';
export { gthLeanAgentFactory } from '#src/core/gthLeanAgentFactory.js';
export * from '#src/core/compaction.js';
// EXT-161 — the preventive compaction threshold and the window resolution behind it. Both are
// reachable from `GthAgentInterface.autocompact`, so an embedder that names the agent surface must
// be able to name these too.
export * from '#src/core/compactionThreshold.js';
export * from '#src/core/contextWindow.js';
export * from '#src/config.js';
export * from '#src/providers/modelDiscovery.js';
// EXT-161 — the models.dev catalog types, reachable from the context-window resolution options an
// embedder can now name.
export * from '#src/providers/modelCatalog.js';
export * from '#src/history/historyStore.js';
export * from '#src/history/recordSession.js';
export * from '#src/history/historyFormat.js';
// GS2-107 — the shapes the history formatters take as arguments. Re-exported as TYPES only: the
// retention functions themselves operate on an open `DatabaseSync` and are not part of the public
// surface, but an embedder that calls `formatStoreSizeLine` has to be able to name what it passes.
export type {
  CheckpointStoreStats,
  PrunableConversation,
  ReclaimSummary,
  ThreadUsage,
} from '#src/history/checkpointRetention.js';
