// A phone that cannot register for push notifications (no permission, no token, Firebase not
// set up) must say why: the reason goes to Sentry, tagged "push-token", instead of being lost in
// a console.warn nobody sees.
const mockReportError = jest.fn();
const mockReportNote = jest.fn();
const mockUpsert = jest.fn();
const mockGetToken = jest.fn();
const mockPermissions = { existing: 'granted', requested: 'granted' };

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../errorReporting', () => ({
  reportError: (...a: unknown[]) => mockReportError(...a),
  reportNote: (...a: unknown[]) => mockReportNote(...a),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } } }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: async () => ({ status: mockPermissions.existing }),
  requestPermissionsAsync: async () => ({ status: mockPermissions.requested }),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetToken(...a),
  addNotificationResponseReceivedListener: jest.fn(),
}));
jest.mock('../supabaseDb', () => ({}));
jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: () => ({ upsert: (...a: unknown[]) => mockUpsert(...a) }),
  },
}));

function fresh() {
  // The module remembers the last token and which notes it has reported, so each test starts clean.
  let mod: typeof import('../notifications');
  jest.isolateModules(() => { mod = require('../notifications'); });
  return mod!;
}

beforeEach(() => {
  [mockReportError, mockReportNote, mockUpsert, mockGetToken].forEach((m) => m.mockReset());
  mockPermissions.existing = 'granted';
  mockPermissions.requested = 'granted';
  mockGetToken.mockResolvedValue({ data: 'ExpoPushToken[abc]' });
  mockUpsert.mockResolvedValue({ error: null });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('registering for push', () => {
  it('saves the token and reports nothing when all goes well', async () => {
    const { registerExpoPushToken } = fresh();
    expect(await registerExpoPushToken()).toBe('ExpoPushToken[abc]');
    expect(mockUpsert).toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
    expect(mockReportNote).not.toHaveBeenCalled();
  });

  it('reports the exact error when Expo cannot issue a token (for example Firebase is not set up)', async () => {
    const boom = new Error("Default FirebaseApp is not initialized in this process. Make sure to call FirebaseApp.initializeApp(Context) first.");
    mockGetToken.mockRejectedValue(boom);
    const { registerExpoPushToken } = fresh();
    expect(await registerExpoPushToken()).toBeNull();
    expect(mockReportError).toHaveBeenCalledWith(boom, 'push-token');
  });

  it('reports a note, once, when the pupil refuses notification permission', async () => {
    mockPermissions.existing = 'denied';
    mockPermissions.requested = 'denied';
    const { registerExpoPushToken } = fresh();
    expect(await registerExpoPushToken()).toBeNull();
    expect(await registerExpoPushToken()).toBeNull();
    expect(mockReportNote).toHaveBeenCalledTimes(1);
    expect(mockReportNote).toHaveBeenCalledWith('Push token not registered: notification permission not granted', 'push-token');
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('reports a note when Expo returns an empty token', async () => {
    mockGetToken.mockResolvedValue({ data: '' });
    const { registerExpoPushToken } = fresh();
    expect(await registerExpoPushToken()).toBeNull();
    expect(mockReportNote).toHaveBeenCalledWith('Push token not registered: Expo returned no token', 'push-token');
  });

  it('reports it when the token cannot be saved to the database', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'permission denied for table push_tokens' } });
    const { registerExpoPushToken } = fresh();
    await registerExpoPushToken();
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect((mockReportError.mock.calls[0][0] as Error).message).toBe('Could not save push token: permission denied for table push_tokens');
    expect(mockReportError.mock.calls[0][1]).toBe('push-token');
  });
});
