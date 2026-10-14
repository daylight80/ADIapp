import React from 'react';
import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../tools', () => ({ copyToClipboard: jest.fn(() => true) }));

import { StudentInstructorCard } from '../StudentInstructorCard';
import { copyToClipboard } from '../tools';
import { DVSA_COMPLAINTS_URL } from '../agreementTerms';

const grant = {
  instructor_name: 'Grant Robery', adi_number: '1234567', business_name: "Grant's Driving School",
  contact_phone: '07806 750559', contact_email: 'hello@localedigital.co.uk',
  vehicle: { make_and_model: 'VW Golf', registration_plate: 'AD39 ADI', transmission: 'Automatic' },
};

describe('pupil Instructor tab', () => {
  let open: jest.SpyInstance;
  beforeEach(() => { open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any); });
  afterEach(() => open.mockRestore());

  it("shows the instructor's name, business, phone, email and ADI number", async () => {
    await render(<StudentInstructorCard instructor={grant} loadFailed={false} />);
    expect(screen.getByTestId('instructor-name')).toHaveTextContent('Grant Robery');
    expect(screen.getByText("Grant's Driving School")).toBeTruthy();
    expect(screen.getByTestId('instructor-phone')).toHaveTextContent('07806 750559');
    expect(screen.getByTestId('instructor-email')).toHaveTextContent('hello@localedigital.co.uk');
    expect(screen.getByTestId('adi-value')).toHaveTextContent('1234567');
  });

  it('shows the car to look for', async () => {
    await render(<StudentInstructorCard instructor={grant} loadFailed={false} />);
    expect(screen.getByTestId('instructor-car')).toHaveTextContent('VW Golf · Automatic');
    expect(screen.getByTestId('instructor-plate')).toHaveTextContent('AD39 ADI');
  });

  it('has no car card when the school does not share the car', async () => {
    await render(<StudentInstructorCard instructor={{ ...grant, vehicle: null }} loadFailed={false} />);
    expect(screen.queryByTestId('instructor-car-card')).toBeNull();
  });

  it('calls, texts and emails, with spaces removed from the number', async () => {
    await render(<StudentInstructorCard instructor={grant} loadFailed={false} />);
    await fireEvent.press(screen.getByTestId('instructor-call'));
    expect(open).toHaveBeenCalledWith('tel:07806750559');
    await fireEvent.press(screen.getByTestId('instructor-text'));
    expect(open).toHaveBeenLastCalledWith(expect.stringMatching(/^sms:07806750559[?&]body=$/));
    await fireEvent.press(screen.getByTestId('instructor-email'));
    expect(open).toHaveBeenLastCalledWith('mailto:hello@localedigital.co.uk');
  });

  it("opens a text saying the pupil is running late, from the pupil's first name", async () => {
    await render(<StudentInstructorCard instructor={grant} loadFailed={false} pupilName="Test Pupil" />);
    await fireEvent.press(screen.getByTestId('instructor-running-late'));
    const url = decodeURIComponent(open.mock.calls[open.mock.calls.length - 1][0] as string);
    expect(url).toContain('sms:07806750559');
    expect(url).toContain("Hi Grant, it's Test. I'm running a few minutes late");
  });

  it('shows the driving school after the instructor, only when its details differ', async () => {
    const { rerender } = await render(<StudentInstructorCard instructor={grant} loadFailed={false} />);
    expect(screen.queryByTestId('instructor-school-card')).toBeNull();
    await rerender(<StudentInstructorCard instructor={{ ...grant, school_phone: '020 8000 0000', school_email: 'office@school.co.uk' }} loadFailed={false} />);
    expect(screen.getByTestId('instructor-school-card')).toHaveTextContent(/Contact your instructor first/);
    await fireEvent.press(screen.getByTestId('school-phone'));
    expect(open).toHaveBeenLastCalledWith('tel:02080000000');
    await fireEvent.press(screen.getByTestId('school-email'));
    expect(open).toHaveBeenLastCalledWith('mailto:office@school.co.uk');
  });

  it('links to the DVSA complaints page', async () => {
    await render(<StudentInstructorCard instructor={grant} loadFailed={false} />);
    await fireEvent.press(screen.getByTestId('instructor-complaint'));
    expect(open).toHaveBeenCalledWith(DVSA_COMPLAINTS_URL);
  });

  it('copies the ADI number and says so on the card', async () => {
    await render(<StudentInstructorCard instructor={grant} loadFailed={false} />);
    await fireEvent.press(screen.getByTestId('btn-copy-adi'));
    expect(copyToClipboard).toHaveBeenCalledWith('1234567');
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('leaves out what the instructor has not filled in, but keeps the complaints link', async () => {
    await render(<StudentInstructorCard instructor={{ instructor_name: 'Grant Robery' }} loadFailed={false} />);
    expect(screen.queryByTestId('instructor-call')).toBeNull();
    expect(screen.queryByTestId('instructor-running-late')).toBeNull();
    expect(screen.queryByTestId('instructor-email')).toBeNull();
    expect(screen.queryByTestId('adi-value')).toBeNull();
    expect(screen.getByTestId('instructor-complaint')).toBeTruthy();
  });

  it('says when the details could not be loaded, and shows nothing while loading', async () => {
    const { rerender } = await render(<StudentInstructorCard instructor={null} loadFailed={false} />);
    expect(screen.queryByTestId('student-instructor-card')).toBeNull();
    expect(screen.queryByTestId('student-instructor-error')).toBeNull();
    await rerender(<StudentInstructorCard instructor={null} loadFailed />);
    expect(screen.getByTestId('student-instructor-error')).toBeTruthy();
  });
});
