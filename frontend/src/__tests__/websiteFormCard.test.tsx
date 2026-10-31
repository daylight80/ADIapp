import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../api', () => ({ API_BASE: 'https://api.example.test/api' }));
const mockCall = jest.fn();
jest.mock('../backendCall', () => ({ callBackend: (...a: any[]) => mockCall(...a) }));
const mockCopy = jest.fn((_t: string) => true);
jest.mock('../tools', () => ({ copyToClipboard: (t: string) => mockCopy(t) }));

import { WebsiteFormCard } from '../WebsiteFormCard';

const KEY = 'sample-form-key'; // an obviously fake sample, not a real key
const live = { available: true, enabled: true, key: KEY, form_path: `/api/public/enquiries/${KEY}` };

beforeEach(() => { mockCall.mockReset(); mockCopy.mockClear(); });

describe('the Website form card', () => {
  it('tells a Starter school it is part of DC Pro and Franchise, with no addresses', async () => {
    mockCall.mockResolvedValue({ available: false, enabled: false, key: null, form_path: null });
    await render(<WebsiteFormCard />);
    await waitFor(() => expect(screen.getByTestId('website-form-upgrade')).toBeTruthy());
    expect(screen.queryByTestId('website-form-webhook')).toBeNull();
  });

  it("shows the server's reason to someone who is not the school owner", async () => {
    mockCall.mockRejectedValue(new Error('Only the school owner can manage the website form.'));
    await render(<WebsiteFormCard />);
    await waitFor(() => expect(screen.getByTestId('website-form-error')).toHaveTextContent(/school owner/));
  });

  it('shows the form page, embed and Elementor addresses built from the key, and copies one', async () => {
    mockCall.mockResolvedValue(live);
    await render(<WebsiteFormCard />);
    await waitFor(() => expect(screen.getByTestId('website-form-webhook')).toBeTruthy());
    expect(screen.getByTestId('website-form-webhook')).toHaveTextContent(`https://api.example.test/api/public/enquiries/${KEY}`);
    expect(screen.getByTestId('website-form-page')).toHaveTextContent(`https://webapp.drivingschoolsolutions.co.uk/enquiry-form-screen?k=${KEY}`);
    expect(screen.getByTestId('website-form-iframe')).toHaveTextContent(/<iframe/);
    await fireEvent.press(screen.getByTestId('website-form-copy-webhook'));
    expect(mockCopy).toHaveBeenCalledWith(`https://api.example.test/api/public/enquiries/${KEY}`);
  });

  it('switches the form off and on', async () => {
    mockCall.mockResolvedValueOnce(live).mockResolvedValueOnce({ ...live, enabled: false });
    await render(<WebsiteFormCard />);
    await waitFor(() => expect(screen.getByTestId('website-form-status')).toHaveTextContent('On'));
    await fireEvent.press(screen.getByTestId('website-form-toggle'));
    await waitFor(() => expect(screen.getByTestId('website-form-status')).toHaveTextContent('Off'));
    expect(mockCall).toHaveBeenLastCalledWith('/v2/enquiry-form/enabled', 'POST', { enabled: false });
  });

  it('makes a new key only after the owner agrees, then shows the new addresses', async () => {
    const NEW = 'sample-new-key'; // an obviously fake sample, not a real key
    mockCall.mockResolvedValueOnce(live).mockResolvedValueOnce({ ...live, key: NEW });
    // The phone asks with an Alert: the first time they cancel, the second they agree.
    let asked = 0;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons: any) => {
      asked += 1;
      buttons[asked === 1 ? 0 : 1].onPress();
    });
    await render(<WebsiteFormCard />);
    await waitFor(() => expect(screen.getByTestId('website-form-new-key')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('website-form-new-key'));
    expect(mockCall).toHaveBeenCalledTimes(1); // said no: nothing changed
    await fireEvent.press(screen.getByTestId('website-form-new-key'));
    await waitFor(() => expect(screen.getByTestId('website-form-webhook')).toHaveTextContent(`https://api.example.test/api/public/enquiries/${NEW}`));
    expect(mockCall).toHaveBeenLastCalledWith('/v2/enquiry-form/regenerate', 'POST', undefined);
    alertSpy.mockRestore();
  });
});
