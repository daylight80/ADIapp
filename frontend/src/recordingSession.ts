import type { Dl25Faults } from './dl25Items';
import type { FaultEvent } from './faultEvents';

// What the Route Recorder shares with the mock test opened on top of it. Both live only in memory: the recording
// itself is also only in memory, so they come and go together.

export type LiveRecording = { routeId: string; bankedMs: number; runStartedAt: number | null };

let live: LiveRecording | null = null;
/** The recording in progress (null when none), so another screen can show its timer. */
export const setLiveRecording = (v: LiveRecording | null): void => { live = v; };
export const getLiveRecording = (): LiveRecording | null => live;

export type MockDraft = { faults: Dl25Faults; events: FaultEvent[] };

const drafts = new Map<string, MockDraft>();
/** Faults (and when each was marked) so far in a mock test run during a recording, kept if the instructor goes back to the recorder. */
export const getMockDraft = (routeId: string): MockDraft | undefined => drafts.get(routeId);
export const saveMockDraft = (routeId: string, draft: MockDraft): void => { drafts.set(routeId, draft); };
export const clearMockDraft = (routeId: string): void => { drafts.delete(routeId); };
