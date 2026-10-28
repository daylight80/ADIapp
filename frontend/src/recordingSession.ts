import type { Dl25Faults } from './dl25Items';

// What the Route Recorder shares with the mock test opened on top of it. Both live only in memory: the recording
// itself is also only in memory, so they come and go together.

export type LiveRecording = { routeId: string; bankedMs: number; runStartedAt: number | null };

let live: LiveRecording | null = null;
/** The recording in progress (null when none), so another screen can show its timer. */
export const setLiveRecording = (v: LiveRecording | null): void => { live = v; };
export const getLiveRecording = (): LiveRecording | null => live;

const drafts = new Map<string, Dl25Faults>();
/** Faults marked so far in a mock test run during a recording, kept if the instructor goes back to the recorder. */
export const getMockDraft = (routeId: string): Dl25Faults | undefined => drafts.get(routeId);
export const saveMockDraft = (routeId: string, faults: Dl25Faults): void => { drafts.set(routeId, faults); };
export const clearMockDraft = (routeId: string): void => { drafts.delete(routeId); };
