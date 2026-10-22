import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockStatus = jest.fn();
jest.mock('../calendarFeed', () => ({
  ...jest.requireActual('../calendarFeed'),
  calendarApi: { status: (...a: unknown[]) => mockStatus(...a), enable: jest.fn(), regenerate: jest.fn(), disable: jest.fn() },
}));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
const mockCopy = jest.fn().mockReturnValue(true);
jest.mock('../tools', () => ({ copyToClipboard: (...a: unknown[]) => mockCopy(...a) }));

import { CalendarFeedCard } from '../CalendarFeedCard';

describe('the calendar feed card', () => {
  beforeEach(() => {
    mockCopy.mockClear();
    mockStatus.mockReset().mockResolvedValue({ enabled: true, token: 'tok', feed_path: '/api/calendar/tok.ics' });
  });

  it('is honest that Google can take a day to refresh, and points to Add to Google Calendar for right now', async () => {
    await render(<CalendarFeedCard />);
    await waitFor(() => expect(screen.getByTestId('calendar-refresh-note')).toBeTruthy());
    expect(screen.getByTestId('calendar-refresh-note')).toHaveTextContent(/every 12 to 24 hours/);
    expect(screen.getByTestId('calendar-refresh-note')).toHaveTextContent(/Add to Google Calendar/);
  });

  it('shows the plain link, then the travel version when the box is ticked, and copies what is shown', async () => {
    await render(<CalendarFeedCard />);
    await waitFor(() => expect(screen.getByTestId('text-feed-url')).toBeTruthy());
    expect(screen.getByTestId('text-feed-url')).toHaveTextContent(/\/api\/calendar\/tok\.ics$/);

    await fireEvent.press(screen.getByTestId('toggle-feed-travel'));
    expect(screen.getByTestId('text-feed-url')).toHaveTextContent(/\/api\/calendar\/tok\.ics\?travel=1$/);
    await fireEvent.press(screen.getByTestId('btn-copy-feed'));
    expect(mockCopy).toHaveBeenCalledWith(expect.stringMatching(/tok\.ics\?travel=1$/));

    await fireEvent.press(screen.getByTestId('toggle-feed-travel'));
    expect(screen.getByTestId('text-feed-url')).toHaveTextContent(/tok\.ics$/);
  });

  it('describes what the feed contains when it is switched off', async () => {
    mockStatus.mockResolvedValue({ enabled: false, token: null, feed_path: null });
    await render(<CalendarFeedCard />);
    await waitFor(() => expect(screen.getByTestId('btn-calendar-enable')).toBeTruthy());
    expect(screen.getByText(/Practical Test details and your\s+blocked time/)).toBeTruthy();
    expect(screen.queryByText(/stays in sync/)).toBeNull();
  });
});
