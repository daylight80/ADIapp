import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  const make = (name: string) => {
    const C = (p: any) => <View testID={p.testID} accessibilityLabel={name}>{p.children}</View>;
    C.displayName = name;
    return C;
  };
  const SvgText = (p: any) => <Text testID={p.testID}>{p.children}</Text>;
  SvgText.displayName = 'SvgText';
  return { __esModule: true, default: make('Svg'), Svg: make('Svg'), Polyline: make('Polyline'), Circle: make('Circle'), Text: SvgText };
});

import { FaultRouteMap } from '../FaultRouteMap';

const route: any = {
  id: 'r1', name: 'Lesson', startedAt: '2026-10-28T10:00:00Z', endedAt: '2026-10-28T11:00:00Z', durationSec: 3600, distanceMeters: 5000,
  points: [
    { lat: 51.0, lng: -0.1, t: 1000 }, { lat: 51.1, lng: -0.1, t: 2000 }, { lat: 51.2, lng: -0.1, t: 3000 },
  ],
};

describe('FaultRouteMap', () => {
  it('draws a numbered dot and a timed row for each fault, with the line names', async () => {
    await render(<FaultRouteMap route={route} events={[{ key: 'dl25_1b', type: 'serious', t: 1900 }, { key: 'dl25_21_right', type: 'driving', t: 2900 }]} />);
    expect(screen.getByTestId('fault-route-map-dot-1')).toBeTruthy();
    expect(screen.getByTestId('fault-route-map-dot-2')).toBeTruthy();
    expect(screen.getByText('1b Highway Code / safety')).toBeTruthy();
    expect(screen.getByText('21 Junctions – turning right')).toBeTruthy();
    expect(screen.getByText(/^Serious · /)).toBeTruthy();
    expect(screen.getByText(/^Driving · /)).toBeTruthy();
  });

  it('shows nothing when there are no faults', async () => {
    await render(<FaultRouteMap route={route} events={[]} />);
    expect(screen.queryByTestId('fault-route-map')).toBeNull();
  });

  it('shows nothing when the route has too few points to draw', async () => {
    await render(<FaultRouteMap route={{ ...route, points: [route.points[0]] }} events={[{ key: 'dl25_1b', type: 'serious', t: 1900 }]} />);
    expect(screen.queryByTestId('fault-route-map')).toBeNull();
  });
});
