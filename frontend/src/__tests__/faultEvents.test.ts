import { addFaultEvent, locateFaults, MAX_FAULT_EVENTS, parseFaultEvents, removeLatestFaultEvent, type FaultEvent } from '../faultEvents';
import { sketchLines, sketchProjector } from '../routeSketch';

const ev = (key: string, type: FaultEvent['type'], t: number): FaultEvent => ({ key, type, t });
const pt = (lat: number, lng: number, t: number, extra: object = {}) => ({ lat, lng, t, ...extra });

describe('fault events', () => {
  it('keeps at most the limit, dropping the oldest', () => {
    let list: FaultEvent[] = [];
    for (let i = 0; i < MAX_FAULT_EVENTS + 3; i += 1) list = addFaultEvent(list, ev('a', 'driving', i));
    expect(list).toHaveLength(MAX_FAULT_EVENTS);
    expect(list[0].t).toBe(3);
  });

  it('removes only the latest matching event', () => {
    const list = [ev('a', 'driving', 1), ev('b', 'driving', 2), ev('a', 'driving', 3), ev('a', 'serious', 4)];
    expect(removeLatestFaultEvent(list, 'a', 'driving').map((e) => e.t)).toEqual([1, 2, 4]);
    expect(removeLatestFaultEvent(list, 'zzz', 'driving')).toBe(list);
  });

  it('reads a list from a string or an array and drops anything malformed', () => {
    const good = ev('a', 'serious', 5);
    expect(parseFaultEvents(JSON.stringify([good, { key: 1 }, null, { key: 'b', type: 'nope', t: 1 }, { key: 'c', type: 'driving', t: 'x' }]))).toEqual([good]);
    expect(parseFaultEvents([good])).toEqual([good]);
    expect(parseFaultEvents('not json')).toEqual([]);
    expect(parseFaultEvents(undefined)).toEqual([]);
    expect(parseFaultEvents({ not: 'a list' })).toEqual([]);
  });
});

describe('locateFaults', () => {
  const points = [pt(51.0, -0.1, 1000), pt(51.1, -0.1, 2000), pt(51.2, -0.1, 3000)];

  it('puts each fault at the route point closest in time', () => {
    const got = locateFaults([ev('a', 'driving', 1900), ev('b', 'serious', 2900), ev('c', 'dangerous', 100)], points);
    expect(got.map((g) => g.lat)).toEqual([51.1, 51.2, 51.0]); // before the start: the first point
  });

  it('places nothing without a route of two or more points', () => {
    expect(locateFaults([ev('a', 'driving', 1)], [])).toEqual([]);
    expect(locateFaults([ev('a', 'driving', 1)], [points[0]])).toEqual([]);
  });
});

describe('route sketch projection', () => {
  const points = [pt(51.0, -0.1, 1), pt(51.0, -0.09, 2), pt(51.01, -0.09, 3, { brk: true }), pt(51.01, -0.1, 4)];

  it('needs two points', () => {
    expect(sketchProjector([points[0]], 100)).toBeNull();
    expect(sketchLines([points[0]], 100)).toEqual([]);
  });

  it('lines up the dots with the line: a route point projects onto its own vertex', () => {
    const project = sketchProjector(points, 120, 6)!;
    const lines = sketchLines(points, 120, 6);
    expect(lines).toHaveLength(2); // the break splits it
    const [x, y] = project(points[0].lat, points[0].lng);
    expect(lines[0].split(' ')[0]).toBe(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
});
