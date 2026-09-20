/** Barrel for the scheduling engine. Pure module: no React, no DB, no fetch. */

export { normalize, union, intersect, subtract, totalDuration } from './intervals';
export { sleepIntervals, offHoursIntervals, workIntervals, hardBusy } from './availability';
export { suggest, PENALTY } from './suggest';

export type {
  Interval,
  LocalMinutes,
  Member,
  CostReason,
  MemberCost,
  Slot,
  SuggestResult,
  SuggestOptions,
} from './types';
