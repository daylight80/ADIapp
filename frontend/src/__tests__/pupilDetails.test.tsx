import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../useSupabaseData', () => ({ bump: jest.fn() }));
jest.mock('../supabaseDb', () => ({ updateMyStudentDetails: jest.fn() }));

import * as db from '../supabaseDb';
import { validatePupilDetails, normaliseLicence } from '../pupilDetails';
import { StudentDetailsCard } from '../StudentDetailsCard';

const update = db.updateMyStudentDetails as jest.Mock;
const good = { phone: '07700 900123', address: '5 High Street, Sutton', postcode: 'sm1 4ls', licence: 'abcde 123456 78901' };

describe('validatePupilDetails', () => {
  it('accepts good details and tidies them (upper-case postcode and licence, no spaces in the licence)', () => {
    const r = validatePupilDetails(good);
    expect(r).toEqual({
      ok: true,
      values: { phone: '07700 900123', address: '5 High Street, Sutton', postcode: 'SM1 4LS', licence: 'ABCDE12345678901' },
    });
  });

  it.each(['', 'abc', '12345', '0770090012345678901234'])('rejects the mobile number "%s"', (phone) => {
    expect(validatePupilDetails({ ...good, phone }).ok).toBe(false);
  });

  it('accepts +44 and bracketed numbers', () => {
    expect(validatePupilDetails({ ...good, phone: '+44 (0)7700 900123' }).ok).toBe(true);
  });

  it('rejects a licence that is not 16 letters and numbers', () => {
    for (const licence of ['', 'SHORT', 'ABCDE1234567890123', 'ABCDE-12345678901']) {
      const r = validatePupilDetails({ ...good, licence });
      expect(r.ok).toBe(false);
    }
  });

  it('rejects an address over 200 characters and a postcode over 10', () => {
    expect(validatePupilDetails({ ...good, address: 'x'.repeat(201) }).ok).toBe(false);
    expect(validatePupilDetails({ ...good, postcode: 'SM1 4LS 12345' }).ok).toBe(false);
  });

  it('allows a blank address (it is optional)', () => {
    expect(validatePupilDetails({ ...good, address: '' }).ok).toBe(true);
  });

  it('normaliseLicence strips spaces and upper-cases', () => {
    expect(normaliseLicence(' abcde 1234 ')).toBe('ABCDE1234');
  });
});

describe('pupil My details card', () => {
  const student = { email: 'pupil@x.co', phone: '07700 900123', address: '5 High Street', postcode: 'SM1 4LS', provisional_licence: 'ABCDE12345678901' };

  beforeEach(() => update.mockReset());

  it('shows the pupil their details, with email read-only', async () => {
    await render(<StudentDetailsCard student={student} />);
    expect(screen.getByTestId('input-pupil-phone').props.value).toBe('07700 900123');
    expect(screen.getByTestId('input-pupil-licence').props.value).toBe('ABCDE12345678901');
    expect(screen.getByTestId('pupil-email')).toHaveTextContent('pupil@x.co');
    expect(screen.queryByTestId('input-pupil-email')).toBeNull();
    expect(screen.getByText('To change your email, ask your instructor.')).toBeTruthy();
  });

  it('saves and says so on the card', async () => {
    update.mockResolvedValue({ phone: '07700 900999', address: '5 High Street', postcode: 'SM1 4LS', provisional_licence: 'ABCDE12345678901' });
    await render(<StudentDetailsCard student={student} />);
    await fireEvent.changeText(screen.getByTestId('input-pupil-phone'), '07700 900999');
    await fireEvent.press(screen.getByTestId('btn-save-pupil-details'));
    expect(update).toHaveBeenCalledWith({
      phone: '07700 900999', address: '5 High Street', postcode: 'SM1 4LS', licence: 'ABCDE12345678901',
    });
    expect(await screen.findByTestId('pupil-details-message')).toHaveTextContent('Your details have been saved.');
  });

  it('does not send anything when a rule is broken, and says why', async () => {
    await render(<StudentDetailsCard student={student} />);
    await fireEvent.changeText(screen.getByTestId('input-pupil-licence'), 'SHORT');
    await fireEvent.press(screen.getByTestId('btn-save-pupil-details'));
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByTestId('pupil-details-message')).toHaveTextContent(/16 letters and numbers/);
  });

  it('shows the error when the save fails', async () => {
    update.mockRejectedValue(new Error('No student record is linked to this login'));
    await render(<StudentDetailsCard student={student} />);
    await fireEvent.press(screen.getByTestId('btn-save-pupil-details'));
    expect(await screen.findByTestId('pupil-details-message')).toHaveTextContent(/No student record is linked/);
  });
});
