import {
  DL25_ITEMS, DL25_ROWS, labelForKey, sortIndexForKey, emptyDl25Faults, faultedRows,
} from '../dl25Items';

describe('DL25 items for a car test', () => {
  it('leaves out the items that do not apply (9, 10, 28 to 33)', () => {
    const numbers = DL25_ITEMS.map((i) => i.no);
    for (const n of ['9', '10', '28', '29', '30', '31', '32', '33']) expect(numbers).not.toContain(n);
  });

  it('has the car items in form order', () => {
    expect(DL25_ITEMS.map((i) => i.no)).toEqual([
      '1a', '1b', '2', '3', '4', '5', '6', '7', '8', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27',
    ]);
  });

  it('leaves out the lorry, bus and motorcycle lines', () => {
    const labels = DL25_ROWS.map((r) => r.label.toLowerCase()).join('|');
    for (const gone of ['balance', 'pcv', 'door exercise', 'trailer', 'wheelchair', 'uncouple', 'spare', 'taxi']) {
      expect(labels).not.toContain(gone);
    }
  });

  it('gives every line a unique key and a readable label', () => {
    const keys = DL25_ROWS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(labelForKey('dl25_21_right')).toBe('21 Junctions – turning right');
    expect(labelForKey('dl25_2')).toBe('2 Controlled stop');
    expect(labelForKey('dl25_12_parkingbrake')).toBe('12 Control – parking brake');
  });

  it('only allows a serious fault on the eyesight line', () => {
    expect(DL25_ROWS.find((r) => r.key === 'dl25_1a')?.seriousOnly).toBe(true);
    expect(DL25_ROWS.filter((r) => r.seriousOnly)).toHaveLength(1);
  });
});

describe('labels for older mock tests', () => {
  it('still names the 12 broad categories earlier attempts used', () => {
    expect(labelForKey('move_off_stop')).toBe('Move off / Stop');
    expect(labelForKey('roundabouts')).toBe('Roundabouts');
  });
  it('prefers the name saved with the attempt, and tidies an unknown key', () => {
    expect(labelForKey('dl25_2', '2 Controlled stop (saved)')).toBe('2 Controlled stop (saved)');
    expect(labelForKey('something_new')).toBe('something new');
  });
  it('puts form order first and older categories after', () => {
    expect(sortIndexForKey('dl25_1a')).toBeLessThan(sortIndexForKey('dl25_27'));
    expect(sortIndexForKey('controls')).toBeGreaterThan(sortIndexForKey('dl25_27'));
  });
});

describe('fault counters', () => {
  it('starts every line at zero, carrying its label', () => {
    const f = emptyDl25Faults();
    expect(Object.keys(f)).toHaveLength(DL25_ROWS.length);
    expect(f.dl25_13_safety).toEqual({ driving: 0, serious: 0, dangerous: 0, label: '13 Move off – safety' });
  });

  it('lists only the lines with faults, in form order, for the report', () => {
    const f = emptyDl25Faults();
    f.dl25_21_right.driving = 2;
    f.dl25_3_control.serious = 1;
    const rows = faultedRows(f);
    expect(rows.map((r) => r.key)).toEqual(['dl25_3_control', 'dl25_21_right']);
    expect(rows[1].label).toBe('21 Junctions – turning right');
  });

  it('reads an older attempt saved with the 12 categories', () => {
    const rows = faultedRows({ junctions: { driving: 3, serious: 0, dangerous: 0 }, mirrors: { driving: 0, serious: 0, dangerous: 0 } });
    expect(rows).toEqual([{ key: 'junctions', label: 'Junctions', counts: { driving: 3, serious: 0, dangerous: 0 } }]);
    expect(faultedRows(null)).toEqual([]);
  });
});
