import {
  upcomingToday, changeoverPairs, changeoverVerdict, outcodeOf, weatherWindows, buildBriefing,
  TIGHT_SLACK_MINUTES, MAX_CHANGEOVER_GAP_MINUTES,
} from '../roadBriefing';

// "Now" is Thu 22 Oct 2026, 09:00 local.
const NOW = new Date(2026, 9, 22, 9, 0);
const L = (id: string, student_id: string, start: string, end: string, status = 'Scheduled', date = '2026-10-22') =>
  ({ id, student_id, date, start_time: start, end_time: end, status });
const addrs: Record<string, string> = {
  a: '1 High St, Mitcham CR4 3AB', b: '9 Park Rd, Morden SM4 5XY', c: '9 Park Rd, Morden SM4 5XY', d: '4 Hill Rd, Sutton SM1 1AA',
};
const addressOf = (l: { id: string }) => addrs[l.id.replace('l', '')] || '';
const nameOf = (id: string) => ({ s1: 'Sam', s2: 'Pat', s3: 'Lee' } as Record<string, string>)[id] || 'A pupil';

describe('which lessons count', () => {
  it('keeps today\'s lessons that have not ended and are neither completed nor cancelled, soonest first', () => {
    const list = [
      L('l4', 's3', '15:00', '16:00'),
      L('l1', 's1', '09:30', '10:30'),
      L('l2', 's2', '08:00', '08:45'),                         // already ended
      L('l3', 's1', '11:00', '12:00', 'Cancelled'),
      L('l5', 's1', '13:00', '14:00', 'Completed'),
      L('l6', 's1', '10:00', '11:00', 'Scheduled', '2026-10-23'), // tomorrow
    ];
    expect(upcomingToday(list, NOW).map((l) => l.id)).toEqual(['l1', 'l4']);
  });
});

describe('changeovers', () => {
  it('pairs consecutive lessons at different addresses with the gap and a departure time', () => {
    const lessons = [L('la', 's1', '09:30', '10:30'), L('lb', 's2', '11:00', '12:00')];
    const [p] = changeoverPairs(lessons, addressOf, NOW);
    expect(p).toMatchObject({ fromId: 'la', toId: 'lb', gapMinutes: 30 });
    expect(p.departAt).toEqual(new Date(2026, 9, 22, 10, 30));
  });

  it('skips the same address, unknown addresses and long breaks', () => {
    const same = [L('lb', 's1', '09:30', '10:30'), L('lc', 's2', '10:30', '11:30')];
    expect(changeoverPairs(same, addressOf, NOW)).toEqual([]);
    const unknown = [L('la', 's1', '09:30', '10:30'), L('lz', 's2', '11:00', '12:00')];
    expect(changeoverPairs(unknown, addressOf, NOW)).toEqual([]);
    const longBreak = [L('la', 's1', '09:30', '10:30'), L('ld', 's2', `${10 + Math.ceil(MAX_CHANGEOVER_GAP_MINUTES / 60) + 1}:30`, '23:00')];
    expect(changeoverPairs(longBreak, addressOf, NOW)).toEqual([]);
  });

  it('departs now if the first lesson is already running over', () => {
    const lessons = [L('la', 's1', '08:30', '09:30'), L('ld', 's2', '09:40', '10:40')];
    const now = new Date(2026, 9, 22, 9, 35);
    expect(changeoverPairs(lessons, addressOf, now)[0].departAt).toEqual(now);
  });

  it('is late when the drive is longer than the gap, tight under five minutes to spare, otherwise fine', () => {
    expect(changeoverVerdict(30, 35)).toEqual({ status: 'late', slack: -5 });
    expect(changeoverVerdict(30, 30).status).toBe('tight');
    expect(changeoverVerdict(30, 30 - TIGHT_SLACK_MINUTES + 1).status).toBe('tight');
    expect(changeoverVerdict(30, 30 - TIGHT_SLACK_MINUTES).status).toBe('ok');
  });
});

describe('weather windows', () => {
  it('finds the postcode area and groups lessons by it, leaving out lessons with no postcode', () => {
    expect(outcodeOf('12 High St, Mitcham CR4 3AB')).toBe('CR4');
    expect(outcodeOf('sw19 8aa')).toBe('SW19');
    expect(outcodeOf('no postcode')).toBeNull();
    const lessons = [L('la', 's1', '09:30', '10:30'), L('lb', 's2', '11:00', '12:00'), L('lc', 's2', '12:00', '13:00'), L('lz', 's1', '14:00', '15:00')];
    const w = weatherWindows(lessons, addressOf);
    expect(Object.keys(w).sort()).toEqual(['CR4', 'SM4']);
    expect(w.SM4.map((x) => x.id)).toEqual(['lb', 'lc']);
    expect(new Date(w.CR4[0].start)).toEqual(new Date(2026, 9, 22, 9, 30));
  });
});

describe('the briefing', () => {
  const lessons = [L('la', 's1', '09:30', '10:30'), L('lb', 's2', '11:00', '12:00'), L('ld', 's3', '12:30', '13:30')];
  const pairs = changeoverPairs(lessons, addressOf, NOW);
  const run = (travel: (number | null)[], weather: Record<string, any> = {}) =>
    buildBriefing({ lessons, nameOf, changeovers: pairs.map((pair, i) => ({ pair, travel: travel[i] == null ? null : { minutes: travel[i] as number } })), weather });

  it('says all clear when the roads are fine and the weather is clean', () => {
    const r = run([15, 15], { la: { flags: [], summary: '11°C', covered: true } });
    expect(r.items).toEqual([]);
    expect(r.headline).toBe('Roads and weather look clear for today');
    expect(r.checked).toBe(true);
  });

  it('warns when you will be late and notes a tight one with how much is spare', () => {
    const r = run([40, 27]);
    expect(r.items.map((i) => i.key)).toEqual(['traffic-lb', 'traffic-ld']);
    expect(r.items[0]).toMatchObject({ severity: 'warn', title: 'Pat, 11:00: you may be late' });
    expect(r.items[0].detail).toMatch(/40 min in current traffic and you have 30 min/);
    expect(r.items[1]).toMatchObject({ severity: 'info', title: 'Lee, 12:30: tight changeover' });
    expect(r.headline).toBe('1 changeover you may be late for · 1 tight changeover');
  });

  it('adds weather warnings per lesson with the worst first, and puts ice and fog above rain', () => {
    const r = run([10, 10], {
      lb: { flags: [{ kind: 'rain', text: 'Rain' }], summary: '9°C', covered: true },
      ld: { flags: [{ kind: 'ice', text: 'Ice possible, take care on untreated roads' }, { kind: 'wind', text: 'Strong winds' }], summary: '1°C', covered: true },
    });
    const w = r.items.filter((i) => i.kind === 'weather');
    expect(w.map((i) => [i.lessonId, i.severity])).toEqual([['lb', 'info'], ['ld', 'warn']]);
    expect(w[1].title).toMatch(/Lee, 12:30: ice possible/);
    expect(w[1].detail).toMatch(/Strong winds/);
    expect(r.headline).toBe('Ice possible from 12:30');
  });

  it('ignores a changeover it could not get a drive time for, and a lesson outside the forecast', () => {
    const r = run([null, 10], { la: { flags: [], summary: null, covered: false } });
    expect(r.items).toEqual([]);
    expect(r.checked).toBe(true);   // one real changeover was checked
  });

  it('has no briefing at all when nothing could be checked, rather than a false all-clear', () => {
    const r = run([null, null], {});
    expect(r).toEqual({ items: [], headline: null, checked: false });
  });
});
