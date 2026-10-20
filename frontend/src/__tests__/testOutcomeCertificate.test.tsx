import React from 'react';
import { Linking } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../supabaseDb', () => ({ TEST_RETEST_REASONS: ['Observation'] }));
const mockCreate = jest.fn();
jest.mock('../useSupabaseData', () => ({ createTestOutcome: (...a: unknown[]) => mockCreate(...a) }));
jest.mock('../DateTimeFields', () => {
  const { TextInput } = require('react-native');
  return { DateField: ({ value, onChange, testID }: any) => <TextInput value={value} onChangeText={onChange} testID={testID} /> };
});

import { TestOutcomeModal } from '../TestOutcomeModal';

const open = () => render(<TestOutcomeModal visible studentId="s1" onClose={jest.fn()} onSaved={jest.fn()} />);

beforeEach(() => { mockCreate.mockReset().mockResolvedValue({}); });

describe('theory pass certificate number', () => {
  it('only appears for a passed theory test', async () => {
    await open();
    expect(screen.queryByTestId('certificate-block')).toBeNull();          // practical
    await fireEvent.press(screen.getByTestId('seg-type-theory'));
    expect(screen.getByTestId('certificate-block')).toBeTruthy();           // theory + pass
    await fireEvent.press(screen.getByTestId('seg-result-fail'));
    expect(screen.queryByTestId('certificate-block')).toBeNull();           // theory + fail
  });

  it('Look up opens the GOV.UK page in the browser', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    await open();
    await fireEvent.press(screen.getByTestId('seg-type-theory'));
    await fireEvent.press(screen.getByTestId('btn-certificate-lookup'));
    expect(spy).toHaveBeenCalledWith('https://www.gov.uk/find-theory-test-pass-number');
    spy.mockRestore();
  });

  it('tidies what is typed and saves it with the outcome', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('seg-type-theory'));
    await fireEvent.changeText(screen.getByTestId('input-certificate-number'), ' 1234 5678 ');
    expect(screen.getByTestId('input-certificate-number').props.value).toBe('12345678');
    await fireEvent.press(screen.getByTestId('btn-test-save'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ test_type: 'theory', result: 'pass', theory_certificate_number: '12345678' });
  });

  it('saves nothing for the certificate when it is left empty, or for a practical test', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('seg-type-theory'));
    await fireEvent.press(screen.getByTestId('btn-test-save'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0].theory_certificate_number).toBeNull();
  });
});
