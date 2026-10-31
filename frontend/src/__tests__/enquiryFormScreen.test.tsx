import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ k: 'abc123' }) }));
jest.mock('../api', () => ({ API_BASE: 'https://api.example.test/api' }));

import EnquiryFormScreen from '../../app/enquiry-form-screen';

const mockFetch = jest.fn();
beforeEach(() => {
  mockFetch.mockReset();
  (global as any).fetch = mockFetch;
});

const info = (body: any) => mockFetch.mockResolvedValueOnce({ ok: true, json: async () => body });

describe('the hosted enquiry form page', () => {
  it('asks the server about the key first, and says when the form is not available', async () => {
    info({ available: false });
    await render(<EnquiryFormScreen />);
    await waitFor(() => expect(screen.getByTestId('enquiry-unavailable')).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.test/api/public/enquiries/abc123');
    expect(screen.queryByTestId('enq-submit')).toBeNull();
  });

  it('shows the school name on a live form, and will not send without the contact tick', async () => {
    info({ available: true, school_name: 'Sam Driving' });
    await render(<EnquiryFormScreen />);
    await waitFor(() => expect(screen.getByText('Enquire with Sam Driving')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('enq-name'), 'Alex');
    await fireEvent.changeText(screen.getByTestId('enq-phone'), '07700900123');
    await fireEvent.press(screen.getByTestId('enq-submit'));
    expect(screen.getByTestId('enq-error')).toHaveTextContent(/tick/);
    expect(mockFetch).toHaveBeenCalledTimes(1); // only the question about the key; nothing was posted
  });

  it('posts the enquiry as JSON and thanks the visitor', async () => {
    info({ available: true, school_name: 'Sam Driving' });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    await render(<EnquiryFormScreen />);
    await waitFor(() => expect(screen.getByTestId('enq-submit')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('enq-name'), 'Alex');
    await fireEvent.changeText(screen.getByTestId('enq-email'), 'alex@example.test');
    await fireEvent.press(screen.getByTestId('enq-theory-Passed'));
    await fireEvent.press(screen.getByTestId('enq-consent'));
    await fireEvent.press(screen.getByTestId('enq-submit'));
    await waitFor(() => expect(screen.getByTestId('enquiry-sent')).toBeTruthy());
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe('https://api.example.test/api/public/enquiries/abc123');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Alex', email: 'alex@example.test', theory_test: 'Passed', consent: 'Happy to be contacted', company_website: '' });
  });

  it("shows the server's reason when it refuses", async () => {
    info({ available: true, school_name: '' });
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ detail: 'Too many enquiries from here. Please try again later.' }) });
    await render(<EnquiryFormScreen />);
    await waitFor(() => expect(screen.getByTestId('enq-submit')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('enq-name'), 'Alex');
    await fireEvent.changeText(screen.getByTestId('enq-phone'), '07700900123');
    await fireEvent.press(screen.getByTestId('enq-consent'));
    await fireEvent.press(screen.getByTestId('enq-submit'));
    await waitFor(() => expect(screen.getByTestId('enq-error')).toHaveTextContent(/Too many enquiries/));
    expect(screen.queryByTestId('enquiry-sent')).toBeNull();
  });
});
