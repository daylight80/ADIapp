const mockSession = jest.fn();
const mockMaybe = jest.fn();
const mockRpc = jest.fn();
jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: () => mockSession() },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => mockMaybe() }) }) }),
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

import { draftSummary, approveSummary, withdrawSummary, fetchSavedSummary, fetchMySummaries } from '../lessonSummary';

const okJson = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let fetchMock: jest.Mock;

beforeEach(() => {
  mockSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  mockMaybe.mockReset();
  mockRpc.mockReset();
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});

describe('the summary calls', () => {
  it('asks the backend for a draft with the signed-in token and the dictation', async () => {
    fetchMock.mockResolvedValue(okJson({ summary: 'S', next_plan: 'P' }));
    await expect(draftSummary('les-1', 'spoken words')).resolves.toEqual({ summary: 'S', next_plan: 'P' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v2\/lessons\/les-1\/summary\/draft$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ dictation: 'spoken words' });
  });

  it('sends an empty plan as null, and approves with the edited text', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true, notified: 'push', updated: false }));
    await approveSummary('les-1', 'Edited', '   ');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ summary: 'Edited', next_plan: null });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v2\/lessons\/les-1\/summary$/);
  });

  it('withdraws with a DELETE and no body', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));
    await withdrawSummary('les-1');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it('turns the backend reason into the error shown to the instructor', async () => {
    fetchMock.mockResolvedValue(okJson({ detail: 'Lesson summaries are part of the Pro plan.' }, 403));
    await expect(draftSummary('les-1', 'spoken words')).rejects.toThrow('Lesson summaries are part of the Pro plan.');
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    await expect(draftSummary('les-1', 'spoken words')).rejects.toThrow(/HTTP 502/);
  });

  it('does not call out when signed out', async () => {
    mockSession.mockResolvedValue({ data: { session: null } });
    await expect(draftSummary('les-1', 'spoken words')).rejects.toThrow('Not signed in');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reading summaries', () => {
  it('reads the instructor’s saved summary for a lesson, or null', async () => {
    mockMaybe.mockResolvedValueOnce({ data: { summary: 'S', next_plan: null, approved_at: 'a', notified_at: null }, error: null });
    await expect(fetchSavedSummary('les-1')).resolves.toMatchObject({ summary: 'S' });
    mockMaybe.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchSavedSummary('les-1')).resolves.toBeNull();
  });

  it('reads the pupil’s summaries from the database function, and copes with nothing', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: 'a', summary: 'S' }], error: null });
    await expect(fetchMySummaries()).resolves.toEqual([{ id: 'a', summary: 'S' }]);
    expect(mockRpc).toHaveBeenCalledWith('my_lesson_summaries');
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchMySummaries()).resolves.toEqual([]);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchMySummaries()).rejects.toBeTruthy();
  });
});
