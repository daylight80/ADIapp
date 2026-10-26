import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../useSupabaseData', () => ({ bump: jest.fn() }));
jest.mock('../supabaseDb', () => ({ updateMyStudentDetails: jest.fn() }));
// The real postcode shape checks, but no network: lookupPostcode is replaced.
jest.mock('../postcodeLookup', () => ({
  ...jest.requireActual('../postcodeLookup'),
  lookupPostcode: jest.fn(),
}));

import * as db from '../supabaseDb';
import { validatePupilDetails, normaliseLicence } from '../pupilDetails';
import { StudentDetailsCard } from '../StudentDetailsCard';
import * as postcodes from '../postcodeLookup';

const update = db.updateMyStudentDetails as jest.Mock;
const lookup = postcodes.lookupPostcode as jest.Mock;
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

  beforeEach(() => {
    update.mockReset();
    lookup.mockReset();
    lookup.mockResolvedValue({ status: 'found', postcode: 'SM1 4LS', area: 'Sutton, London' });
  });

  it('checks the postcode when the pupil leaves the field: tidies it and shows the area', async () => {
    await render(<StudentDetailsCard student={student} />);
    await fireEvent.changeText(screen.getByTestId('input-pupil-postcode'), 'sm14ls');
    await fireEvent(screen.getByTestId('input-pupil-postcode'), 'blur');
    expect(screen.getByTestId('input-pupil-postcode').props.value).toBe('SM1 4LS');
    expect(await screen.findByTestId('input-pupil-postcode-note')).toHaveTextContent('SM1 4LS: Sutton, London');
  });

  it('says so when the postcode is not found, and will not save it', async () => {
    lookup.mockResolvedValue({ status: 'not_found' });
    await render(<StudentDetailsCard student={student} />);
    await fireEvent.changeText(screen.getByTestId('input-pupil-postcode'), 'ZZ99 9ZZ');
    await fireEvent.press(screen.getByTestId('btn-save-pupil-details'));
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByTestId('input-pupil-postcode-note')).toHaveTextContent(/could not find that postcode/);
    expect(screen.getByTestId('pupil-details-message')).toHaveTextContent(/check your postcode/);
  });

  it('still saves when the postcode service cannot be reached', async () => {
    lookup.mockResolvedValue({ status: 'unavailable' });
    update.mockResolvedValue({ phone: '07700 900123', address: '5 High Street', postcode: 'SM1 4LS', provisional_licence: 'ABCDE12345678901' });
    await render(<StudentDetailsCard student={student} />);
    await fireEvent.press(screen.getByTestId('btn-save-pupil-details'));
    expect(update).toHaveBeenCalled();
    expect(await screen.findByTestId('pupil-details-message')).toHaveTextContent('Your details have been saved.');
  });

  it('rejects something that is not shaped like a postcode without calling the service', async () => {
    await render(<StudentDetailsCard student={student} />);
    await fireEvent.changeText(screen.getByTestId('input-pupil-postcode'), 'hello');
    await fireEvent(screen.getByTestId('input-pupil-postcode'), 'blur');
    expect(lookup).not.toHaveBeenCalled();
    expect(await screen.findByTestId('input-pupil-postcode-note')).toHaveTextContent(/does not look like a UK postcode/);
  });

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

describe('missingPupilDetails', () => {
  const { missingPupilDetails } = require('../pupilDetails');

  it('names each blank detail and ignores spaces-only values', () => {
    expect(missingPupilDetails({ phone: '', address: '  ', postcode: 'SM1 4LS', provisional_licence: null }))
      .toEqual(['mobile number', 'pick-up address', 'provisional licence number']);
  });

  it('is empty once everything is filled in, or when there is no record yet', () => {
    expect(missingPupilDetails({ phone: '07700 900123', address: '1 High St', postcode: 'SM1 4LS', provisional_licence: 'MORGA657054SM9IJ' })).toEqual([]);
    expect(missingPupilDetails(undefined)).toEqual([]);
  });
});
