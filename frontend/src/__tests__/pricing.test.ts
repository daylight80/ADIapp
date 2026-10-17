import {
  parseRate, rateLabel, rateChangeOffer, rateChangeQuestion, appliedMessage, usablePackages, packagesNeedingPrice,
  packagePerHour, describePackageTopUp, packageTopUp, RATE_CHANGE_NOTE, MAX_HOURLY_RATE,
} from '../pricing';

describe('parseRate', () => {
  it('reads pounds as typed', () => {
    expect(parseRate('40')).toBe(40);
    expect(parseRate('£37.50')).toBe(37.5);
    expect(parseRate(' £ 42 ')).toBe(42);
    expect(parseRate('1,000')).toBeNull(); // over the maximum
    expect(parseRate(String(MAX_HOURLY_RATE))).toBe(MAX_HOURLY_RATE);
  });
  it('refuses anything that is not a sensible hourly rate', () => {
    for (const bad of ['', 'abc', '0', '-5', '36.999', '500.01', '1e2', null, undefined]) expect(parseRate(bad as any)).toBeNull();
  });
  it('labels a rate', () => expect(rateLabel(40)).toBe('£40.00 an hour'));
});

describe('rateChangeOffer', () => {
  it('separates pupils on the old rate from those on other rates', () => {
    const o = rateChangeOffer(36, 40, [{ rate: 35, pupils: 1 }, { rate: 36, pupils: 2 }, { rate: 40, pupils: 1 }])!;
    expect(o).toMatchObject({ onOld: 2, onOther: 1, total: 3, otherRates: '£35.00' });
    expect(rateChangeQuestion(o)).toBe('Your default is now £40.00. 2 pupils are on £36.00 and 1 on a different rate (£35.00).');
  });

  it('says "pupil is" for one, and leaves out a group with nobody in it', () => {
    expect(rateChangeQuestion(rateChangeOffer(36, 40, [{ rate: 36, pupils: 1 }])!)).toBe('Your default is now £40.00. 1 pupil is on £36.00.');
    expect(rateChangeQuestion(rateChangeOffer(36, 40, [{ rate: 35, pupils: 2 }])!)).toBe('Your default is now £40.00. 2 on a different rate (£35.00).');
  });

  it('is null when everyone is already on the new rate, or there are no pupils', () => {
    expect(rateChangeOffer(36, 40, [{ rate: 40, pupils: 4 }])).toBeNull();
    expect(rateChangeOffer(36, 40, [])).toBeNull();
  });

  it('lists several other rates and treats a rate equal to the old one only as old', () => {
    const o = rateChangeOffer(36, 40, [{ rate: 30, pupils: 1 }, { rate: 35, pupils: 1 }, { rate: 36, pupils: 3 }])!;
    expect(o.otherRates).toBe('£30.00, £35.00');
    expect(o.onOld).toBe(3);
  });

  it('tells the instructor that taught lessons keep their price, and reports what changed', () => {
    expect(RATE_CHANGE_NOTE).toMatch(/already taught keep the price agreed/);
    expect(appliedMessage(3, 40)).toBe('3 pupils moved to £40.00 an hour.');
    expect(appliedMessage(1, 40)).toBe('1 pupil moved to £40.00 an hour.');
    expect(appliedMessage(0, 40)).toBe('No pupils needed changing.');
  });
});

describe('packages', () => {
  const p = (id: string, hours: number, price: number | null, active = true) => ({ id, name: `${hours}-hour block`, hours, price, active });

  it('only lets a switched-on package with a price and hours be used', () => {
    const list = [p('a', 10, 380), p('b', 5, null), p('c', 20, 760, false), p('d', 0, 50), p('e', 1, 0)];
    expect(usablePackages(list).map((x) => x.id)).toEqual(['a', 'e']);
    expect(packagesNeedingPrice(list).map((x) => x.id)).toEqual(['b']);
  });

  it('works out and describes the price per hour', () => {
    expect(packagePerHour({ hours: 10, price: 380 })).toBe(38);
    expect(packagePerHour({ hours: 3, price: 100 })).toBe(33.33);
    expect(packagePerHour({ hours: 0, price: 100 })).toBeNull();
    expect(packagePerHour({ hours: 5, price: null })).toBeNull();
    expect(describePackageTopUp({ name: '10-hour block', hours: 10, price: 380 })).toBe('10-hour block: 10 hours for £380.00 (£38.00 an hour)');
    expect(describePackageTopUp({ name: 'Single lesson', hours: 1, price: 40 })).toBe('Single lesson: 1 hour for £40.00 (£40.00 an hour)');
  });

  it('records the package’s own hours and price, with a note saying which package', () => {
    expect(packageTopUp({ name: 'Test Day Fee', hours: 2.5, price: 135 })).toEqual({ hours: 2.5, amount: 135, notes: 'Package: Test Day Fee' });
  });
});
