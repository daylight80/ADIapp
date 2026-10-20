import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PickupPlacesCard } from '../PickupPlacesCard';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const mockSave = jest.fn();
const mockDelete = jest.fn();
let mockPlaces: any[] = [];
jest.mock('../supabaseDb', () => ({
  saveStudentPlace: (...a: any[]) => mockSave(...a),
  deleteStudentPlace: (...a: any[]) => mockDelete(...a),
}));
jest.mock('../useSupabaseData', () => ({
  useStudentPlaces: () => mockPlaces,
  bump: jest.fn(),
}));
jest.mock('../AddressSearch', () => {
  const R = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    AddressSearch: ({ onPick }: any) => R.createElement(TouchableOpacity, { testID: 'fake-pick', onPress: () => onPick({ address: '1 High St, Sutton', postcode: 'SM1 1AA' }) }, R.createElement(Text, null, 'pick')),
  };
});

beforeEach(() => { mockSave.mockReset(); mockDelete.mockReset(); mockPlaces = []; });

describe('PickupPlacesCard', () => {
  it('lists saved places with their address and postcode', async () => {
    mockPlaces = [{ id: 'a', student_id: 's', label: 'College', address: '1 High St', postcode: 'SM1 1AA' }];
    const { getByTestId } = await render(<PickupPlacesCard studentId="s" />);
    expect(getByTestId('place-a')).toHaveTextContent(/College/);
    expect(getByTestId('place-a')).toHaveTextContent(/1 High St, SM1 1AA/);
  });

  it('asks for a name before saving', async () => {
    const { getByTestId } = await render(<PickupPlacesCard studentId="s" />);
    await fireEvent.press(getByTestId('btn-add-place'));
    await fireEvent.press(getByTestId('fake-pick'));
    await fireEvent.press(getByTestId('btn-save-place'));
    expect(getByTestId('places-message')).toHaveTextContent(/short name/);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('fills the address from a search result and saves it for that pupil', async () => {
    mockSave.mockResolvedValue({});
    const { getByTestId } = await render(<PickupPlacesCard studentId="s" />);
    await fireEvent.press(getByTestId('btn-add-place'));
    await fireEvent.press(getByTestId('fake-pick'));
    await fireEvent.changeText(getByTestId('input-place-label'), 'College');
    await fireEvent.press(getByTestId('btn-save-place'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ label: 'College', address: '1 High St, Sutton', postcode: 'SM1 1AA', studentId: 's' }));
    await waitFor(() => expect(getByTestId('places-message')).toHaveTextContent(/Place saved/));
  });

  it('rejects a bad postcode without calling the server', async () => {
    const { getByTestId } = await render(<PickupPlacesCard />);
    await fireEvent.press(getByTestId('btn-add-place'));
    await fireEvent.changeText(getByTestId('input-place-label'), 'Work');
    await fireEvent.changeText(getByTestId('input-place-address'), '5 Mill Lane');
    await fireEvent.changeText(getByTestId('input-place-postcode'), 'nope');
    await fireEvent.press(getByTestId('btn-save-place'));
    expect(getByTestId('places-message')).toHaveTextContent(/postcode/);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('removes a place', async () => {
    mockPlaces = [{ id: 'a', student_id: 's', label: 'College', address: '1 High St', postcode: null }];
    mockDelete.mockResolvedValue(undefined);
    const { getByTestId } = await render(<PickupPlacesCard studentId="s" />);
    await fireEvent.press(getByTestId('btn-remove-place-a'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('a'));
  });
});
