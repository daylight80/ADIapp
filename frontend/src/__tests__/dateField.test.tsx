import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));

import { DateField, DATE_PLACEHOLDER } from '../DateTimeFields';

describe('DateField', () => {
  it('shows the stored day as DD-MM-YYYY', async () => {
    await render(<DateField value="2026-10-09" onChange={() => {}} testID="d" />);
    expect(screen.getByTestId('d')).toHaveTextContent('09-10-2026');
  });

  it('shows the British placeholder when empty', async () => {
    await render(<DateField value="" onChange={() => {}} testID="d" />);
    expect(DATE_PLACEHOLDER).toBe('DD-MM-YYYY');
    expect(screen.getByTestId('d')).toHaveTextContent('DD-MM-YYYY');
  });
});
