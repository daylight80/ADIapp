import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../supabaseDb', () => ({ getMySchoolProfile: jest.fn(), updateMySchoolProfile: jest.fn() }));

import * as db from '../supabaseDb';
import { ShareVehicleSwitch } from '../ShareVehicleSwitch';

const mdb = db as unknown as Record<string, jest.Mock>;

beforeEach(() => { mdb.getMySchoolProfile.mockReset(); mdb.updateMySchoolProfile.mockReset(); });

describe('Show my car to my pupils', () => {
  it('is on by default for the school owner', async () => {
    mdb.getMySchoolProfile.mockResolvedValue({ share_vehicle_with_pupils: true });
    await render(<ShareVehicleSwitch />);
    expect((await screen.findByTestId('switch-share-vehicle')).props.value).toBe(true);
  });

  it('is not shown to someone who does not own the school', async () => {
    mdb.getMySchoolProfile.mockResolvedValue(null);
    await render(<ShareVehicleSwitch />);
    await waitFor(() => expect(mdb.getMySchoolProfile).toHaveBeenCalled());
    expect(screen.queryByTestId('share-vehicle-card')).toBeNull();
  });

  it('saves when switched off', async () => {
    mdb.getMySchoolProfile.mockResolvedValue({ share_vehicle_with_pupils: true });
    mdb.updateMySchoolProfile.mockResolvedValue(undefined);
    await render(<ShareVehicleSwitch />);
    await fireEvent(await screen.findByTestId('switch-share-vehicle'), 'valueChange', false);
    expect(mdb.updateMySchoolProfile).toHaveBeenCalledWith({ share_vehicle_with_pupils: false });
    await waitFor(() => expect(screen.getByTestId('switch-share-vehicle').props.value).toBe(false));
  });

  it('puts the switch back and says so when the save fails', async () => {
    mdb.getMySchoolProfile.mockResolvedValue({ share_vehicle_with_pupils: true });
    mdb.updateMySchoolProfile.mockRejectedValue(new Error('network down'));
    await render(<ShareVehicleSwitch />);
    await fireEvent(await screen.findByTestId('switch-share-vehicle'), 'valueChange', false);
    expect(await screen.findByTestId('share-vehicle-error')).toHaveTextContent(/network down/);
    expect(screen.getByTestId('switch-share-vehicle').props.value).toBe(true);
  });
});
