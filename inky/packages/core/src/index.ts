/**
 * @inky/core public surface. Other workspace packages (the Phase 6 db, worker,
 * and dashboard) import from here rather than reaching into individual modules.
 *
 * Light modules only (config + domain types) are re-exported from the barrel so
 * importing it doesn't drag in the heavy adapters (octokit, discord.js). The
 * pipeline entrypoints live behind their own subpaths (e.g. `@inky/core/standup`)
 * for callers that actually run a standup.
 */
export * from './config.js';
export * from './types.js';
