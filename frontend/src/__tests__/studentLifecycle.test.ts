import { manualStatusMoves, statusChangeMessage } from '../studentLifecycle';

describe('manualStatusMoves', () => {
  it('lets a New student be marked active or test ready', () => {
    expect(manualStatusMoves('New')).toEqual([
      { to: 'Active', label: 'Mark active' },
      { to: 'Test Ready', label: 'Mark test ready' },
    ]);
  });

  it('lets an Active student be marked test ready', () => {
    expect(manualStatusMoves('Active')).toEqual([{ to: 'Test Ready', label: 'Mark test ready' }]);
  });

  it('lets a Test Ready student go back to active', () => {
    expect(manualStatusMoves('Test Ready')).toEqual([{ to: 'Active', label: 'Back to active' }]);
  });

  it('offers nothing for Inactive, Waitlist and Passed (they have their own buttons, or are final)', () => {
    for (const s of ['Inactive', 'Waitlist', 'Passed', '', 'Nonsense', null, undefined]) {
      expect(manualStatusMoves(s as any)).toEqual([]);
    }
  });

  it('never offers the status the student is already in', () => {
    for (const s of ['New', 'Active', 'Test Ready']) {
      expect(manualStatusMoves(s).map((m) => m.to)).not.toContain(s);
    }
  });
});

describe('statusChangeMessage', () => {
  it('says reactivated only when coming back from Inactive or Waitlist', () => {
    expect(statusChangeMessage('Sam', 'Inactive', 'Active')).toBe('Sam reactivated.');
    expect(statusChangeMessage('Sam', 'Waitlist', 'Active')).toBe('Sam reactivated.');
    expect(statusChangeMessage('Sam', 'New', 'Active')).toBe('Sam marked as active.');
    expect(statusChangeMessage('Sam', 'Test Ready', 'Active')).toBe('Sam marked as active.');
  });

  it('has a line for each other status', () => {
    expect(statusChangeMessage('Sam', 'Active', 'Inactive')).toBe('Sam marked as inactive.');
    expect(statusChangeMessage('Sam', 'Active', 'Waitlist')).toBe('Sam moved to the waiting list.');
    expect(statusChangeMessage('Sam', 'Active', 'Test Ready')).toBe('Sam marked as test ready.');
    expect(statusChangeMessage('Sam', 'Active', 'Passed')).toBe('Sam is now Passed.');
  });
});
