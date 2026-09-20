/** Public surface of the iCal module. Callers outside `src/lib/ics/**`
 *  should import from here rather than reaching into individual files. */
export { parseIcs } from './parse';
export { buildIcs } from './generate';
export type { IcsEvent } from './generate';
export { fetchIcsIntervals } from './fetch';
export type { FetchIcsOptions } from './fetch';
