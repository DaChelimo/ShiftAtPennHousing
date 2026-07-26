// Wire protocol for the streaming AI generate endpoint (NDJSON, one JSON
// object per line). Pure types, shared by the route handler and the client
// consumer so both stay in lockstep.

import type { AiAssignment } from '@shift/core';

import type { AiProposalDto } from './proposal';

export type AiStreamEvent =
  // Keep-alive. A single model call can run 50s+ with nothing else to report,
  // and a connection that sends no bytes for that long is liable to be dropped
  // by an idle timeout somewhere between the route and the browser. The client
  // ignores these beyond noting that the run is still alive.
  | { t: 'ping' }
  // Coarse phase markers.
  | { t: 'phase'; phase: 'planning' | 'planned' | 'finalizing' }
  // A day's build began (dayIndex/dayCount drive the progress bar).
  | { t: 'day-start'; weekday: number; dayIndex: number; dayCount: number }
  // The model is fixing a rule violation on the current day.
  | { t: 'day-repair'; weekday: number; round: number }
  // A day settled: these shifts paint into the grid (blockId -> workerId).
  | { t: 'day-fill'; weekday: number; assignments: AiAssignment[] }
  // Terminal success: the full labeled proposal.
  | { t: 'result'; data: AiProposalDto }
  // Terminal failure with user-facing copy.
  | { t: 'error'; message: string };
