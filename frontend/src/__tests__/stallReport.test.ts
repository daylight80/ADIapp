const mockNote = jest.fn();
const mockError = jest.fn();
jest.mock('../errorReporting', () => ({
  reportNote: (...a: unknown[]) => mockNote(...a),
  reportError: (...a: unknown[]) => mockError(...a),
}));

import {
  reportLoadFailure, reportResumeProblem, noteReturnFromBackground, describeRecentContext, shouldReport,
  resetStallReportForTests, REPORT_COOLDOWN_MS,
} from '../stallReport';
import { TimeoutError } from '../withTimeout';

beforeEach(() => { mockNote.mockReset(); mockError.mockReset(); resetStallReportForTests(); });

describe('load stall reporting', () => {
  it('reports a timeout as a note with how long it waited and what came just before', () => {
    noteReturnFromBackground(120_000, 1_000_000);
    reportLoadFailure('students', new TimeoutError(15000), 15000, 1_030_000);
    expect(mockNote).toHaveBeenCalledTimes(1);
    const [message, area] = mockNote.mock.calls[0];
    expect(message).toBe('students did not load within 15s; returned from background 30s ago after 120s away');
    expect(area).toBe('load-stall:students');
    expect(mockError).not.toHaveBeenCalled();
  });

  it('says so when there was no recent return from the background', () => {
    expect(describeRecentContext()).toBe('no recent return from background');
    reportLoadFailure('diary', new TimeoutError(15000), 15000);
    expect(mockNote.mock.calls[0][0]).toContain('no recent return from background');
  });

  it('reports any other failure as an error, tagged with the screen', () => {
    const err = new Error('permission denied');
    reportLoadFailure('diary', err, 800);
    expect(mockError).toHaveBeenCalledWith(err, 'load-failure:diary');
    expect(mockNote).not.toHaveBeenCalled();
  });

  it('does not flood Sentry: one report per screen per five minutes', () => {
    reportLoadFailure('students', new TimeoutError(15000), 15000, 0);
    reportLoadFailure('students', new TimeoutError(15000), 15000, 60_000);
    expect(mockNote).toHaveBeenCalledTimes(1);
    reportLoadFailure('diary', new TimeoutError(15000), 15000, 60_000); // a different screen still reports
    expect(mockNote).toHaveBeenCalledTimes(2);
    reportLoadFailure('students', new TimeoutError(15000), 15000, REPORT_COOLDOWN_MS + 1);
    expect(mockNote).toHaveBeenCalledTimes(3);
    expect(shouldReport('students', REPORT_COOLDOWN_MS + 2)).toBe(false);
  });

  it('reports a login renewal problem on return', () => {
    reportResumeProblem(new TimeoutError(8000), 5_000_000);
    expect(mockNote).toHaveBeenCalledTimes(1);
    expect(mockNote.mock.calls[0][1]).toBe('auth-resume');
    mockNote.mockReset();
    reportResumeProblem(new Error('network'), 6_000_000);
    expect(mockError).toHaveBeenCalledWith(expect.any(Error), 'auth-resume');
  });

  it('never throws, even if reporting itself fails', () => {
    mockNote.mockImplementation(() => { throw new Error('sentry down'); });
    expect(() => reportLoadFailure('students', new TimeoutError(15000), 15000)).not.toThrow();
  });
});
