import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { GuardianCard } from '../GuardianCard';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

describe('GuardianCard', () => {
  it('offers to add a guardian when none is recorded', async () => {
    const onEdit = jest.fn();
    const { getByTestId, queryByTestId } = await render(<GuardianCard student={{}} onEdit={onEdit} />);
    expect(queryByTestId('guardian-name')).toBeNull();
    await fireEvent.press(getByTestId('btn-add-guardian'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('shows the guardian with call and email buttons', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    const { getByTestId } = await render(
      <GuardianCard student={{ guardian_name: 'Jo Smith', guardian_phone: '07700 900123', guardian_email: 'jo@example.com' }} onEdit={jest.fn()} />,
    );
    expect(getByTestId('guardian-name')).toHaveTextContent(/Jo Smith/);
    await fireEvent.press(getByTestId('guardian-phone'));
    expect(spy).toHaveBeenCalledWith('tel:07700900123');
    await fireEvent.press(getByTestId('guardian-email'));
    expect(spy).toHaveBeenCalledWith('mailto:jo@example.com');
    spy.mockRestore();
  });

  it('shows only the contact methods that are set', async () => {
    const { queryByTestId } = await render(<GuardianCard student={{ guardian_name: 'Jo Smith', guardian_phone: '07700 900123' }} onEdit={jest.fn()} />);
    expect(queryByTestId('guardian-phone')).not.toBeNull();
    expect(queryByTestId('guardian-email')).toBeNull();
  });
});
