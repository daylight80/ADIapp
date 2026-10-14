import React from 'react';
import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../tools', () => ({ copyToClipboard: jest.fn(() => true) }));

import { StudentInstructorCard } from '../StudentInstructorCard';
import { copyToClipboard } from '../tools';

const grant = {
  instructor_name: 'Grant Robery', adi_number: '1234567', business_name: "Grant's Driving School",
  contact_phone: '07806 750559', contact_email: 'hello@localedigital.co.uk',
};

describe('pupil profile: your instructor', () => {
  it("shows the instructor's name, business, phone, email and ADI number", async () => {
    await render(<StudentInstructorCard instructor={grant} loadFailed={false} />);
    expect(screen.getByTestId('instructor-name')).toHaveTextContent('Grant Robery');
    expect(screen.getByText("Grant's Driving School")).toBeTruthy();
    expect(screen.getByTestId('instructor-phone')).toHaveTextContent('07806 750559');
    expect(screen.getByTestId('instructor-email')).toHaveTextContent('hello@localedigital.co.uk');
    expect(screen.getByTestId('adi-value')).toHaveTextContent('1234567');
  });

  it('calls and emails from the details, with spaces removed from the number', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    await render(<StudentInstructorCard instructor={grant} loadFailed={false} />);
    await fireEvent.press(screen.getByTestId('instructor-phone'));
    expect(open).toHaveBeenCalledWith('tel:07806750559');
    await fireEvent.press(screen.getByTestId('instructor-email'));
    expect(open).toHaveBeenCalledWith('mailto:hello@localedigital.co.uk');
  });

  it('copies the ADI number and says so on the card', async () => {
    await render(<StudentInstructorCard instructor={grant} loadFailed={false} />);
    await fireEvent.press(screen.getByTestId('btn-copy-adi'));
    expect(copyToClipboard).toHaveBeenCalledWith('1234567');
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('leaves out contact lines the instructor has not filled in', async () => {
    await render(<StudentInstructorCard instructor={{ instructor_name: 'Grant Robery' }} loadFailed={false} />);
    expect(screen.queryByTestId('instructor-phone')).toBeNull();
    expect(screen.queryByTestId('instructor-email')).toBeNull();
    expect(screen.queryByTestId('adi-value')).toBeNull();
  });

  it('says when the details could not be loaded, and shows nothing while loading', async () => {
    const { rerender } = await render(<StudentInstructorCard instructor={null} loadFailed={false} />);
    expect(screen.queryByTestId('student-instructor-card')).toBeNull();
    expect(screen.queryByTestId('student-instructor-error')).toBeNull();
    await rerender(<StudentInstructorCard instructor={null} loadFailed />);
    expect(screen.getByTestId('student-instructor-error')).toBeTruthy();
  });
});
