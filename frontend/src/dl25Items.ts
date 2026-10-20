// The marking items on the DVSA driving test report (form DL25), for a car (category B), in form order.
// Left out because they do not apply to a car test: 9 Taxi wheelchair, 10 Uncouple / recouple, the five spare
// items 28 to 32, 33 Wheelchair, and the lorry, bus and motorcycle lines (balance, door exercise, trailer reversing).
// Kept apart from the screen so the list and the labels can be tested.
import { DVSA_CATEGORIES_BASE } from './mockDb';

export type Dl25Row = {
  key: string;
  /** The line within the item, e.g. "turning right". Empty when the item is a single line. */
  sub?: string;
  /** Only a serious fault can be marked on this line (the eyesight check). */
  seriousOnly?: boolean;
};

export type Dl25Item = { no: string; name: string; rows: Dl25Row[] };

const one = (no: string, name: string, extra: Partial<Dl25Row> = {}): Dl25Item => ({
  no, name, rows: [{ key: `dl25_${no}`, ...extra }],
});
const many = (no: string, name: string, subs: [string, string][]): Dl25Item => ({
  no, name, rows: subs.map(([id, sub]) => ({ key: `dl25_${no}_${id}`, sub })),
});

export const DL25_ITEMS: Dl25Item[] = [
  one('1a', 'Eyesight', { seriousOnly: true }),
  one('1b', 'Highway Code / safety'),
  one('2', 'Controlled stop'),
  many('3', 'Reverse / left', [['control', 'control'], ['obs', 'observation']]),
  many('4', 'Reverse / right', [['control', 'control'], ['obs', 'observation']]),
  many('5', 'Reverse park', [['control', 'control'], ['obs', 'observation']]),
  many('6', 'Turn in road', [['control', 'control'], ['obs', 'observation']]),
  one('7', 'Vehicle checks'),
  many('8', 'Forward park', [['control', 'control'], ['obs', 'observation']]),
  one('11', 'Precautions'),
  many('12', 'Control', [
    ['accelerator', 'accelerator'], ['clutch', 'clutch'], ['gears', 'gears'], ['footbrake', 'footbrake'],
    ['parkingbrake', 'parking brake'], ['steering', 'steering'],
  ]),
  many('13', 'Move off', [['safety', 'safety'], ['control', 'control']]),
  many('14', 'Use of mirrors', [['signalling', 'signalling'], ['direction', 'change direction'], ['speed', 'change speed']]),
  many('15', 'Signals', [['necessary', 'necessary'], ['correctly', 'correctly'], ['timed', 'timed']]),
  one('16', 'Clearance / obstructions'),
  many('17', 'Response to signs / signals', [
    ['signs', 'traffic signs'], ['markings', 'road markings'], ['lights', 'traffic lights'],
    ['controllers', 'traffic controllers'], ['others', 'other road users'],
  ]),
  one('18', 'Use of speed'),
  one('19', 'Following distance'),
  many('20', 'Progress', [['speed', 'appropriate speed'], ['hesitation', 'undue hesitation']]),
  many('21', 'Junctions', [
    ['approach', 'approach speed'], ['obs', 'observation'], ['right', 'turning right'], ['left', 'turning left'],
    ['cutting', 'cutting corners'],
  ]),
  many('22', 'Judgement', [['overtaking', 'overtaking'], ['meeting', 'meeting'], ['crossing', 'crossing']]),
  many('23', 'Positioning', [['normal', 'normal driving'], ['lane', 'lane discipline']]),
  one('24', 'Pedestrian crossings'),
  one('25', 'Position / normal stops'),
  one('26', 'Awareness / planning'),
  one('27', 'Ancillary controls'),
];

/** Every line that can be marked, in form order, with the label shown to the instructor and the pupil. */
export const DL25_ROWS: (Dl25Row & { label: string; itemNo: string })[] = DL25_ITEMS.flatMap((item) =>
  item.rows.map((r) => ({ ...r, itemNo: item.no, label: r.sub ? `${item.no} ${item.name} – ${r.sub}` : `${item.no} ${item.name}` })),
);

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(DL25_ROWS.map((r) => [r.key, r.label]));
const LEGACY_LABEL_BY_KEY: Record<string, string> = Object.fromEntries(DVSA_CATEGORIES_BASE.map((c) => [c.key, c.name]));
const ORDER: Record<string, number> = Object.fromEntries(DL25_ROWS.map((r, i) => [r.key, i]));

/**
 * The name to show for a recorded line. Uses the name saved with the attempt when there is one; otherwise the
 * official line; otherwise the older 12-category names that earlier mock tests used.
 */
export function labelForKey(key: string, saved?: string | null): string {
  if (saved && saved.trim()) return saved.trim();
  return LABEL_BY_KEY[key] || LEGACY_LABEL_BY_KEY[key] || key.replace(/_/g, ' ');
}

/** Sort order for a recorded key: form order first, older categories after. */
export function sortIndexForKey(key: string): number {
  return key in ORDER ? ORDER[key] : 1000 + Object.keys(LEGACY_LABEL_BY_KEY).indexOf(key);
}

export type FaultCounts = { driving: number; serious: number; dangerous: number; label?: string };
export type Dl25Faults = Record<string, FaultCounts>;

/** A fresh, empty set of counters for every line, each carrying its label so the saved attempt reads on its own. */
export function emptyDl25Faults(): Dl25Faults {
  const f: Dl25Faults = {};
  DL25_ROWS.forEach((r) => { f[r.key] = { driving: 0, serious: 0, dangerous: 0, label: r.label }; });
  return f;
}

/** The lines that have any faults, in form order, with their labels. */
export function faultedRows(breakdown: Record<string, FaultCounts | undefined> | null | undefined): { key: string; label: string; counts: FaultCounts }[] {
  return Object.entries(breakdown || {})
    .filter(([, f]) => !!f && ((f.driving || 0) > 0 || (f.serious || 0) > 0 || (f.dangerous || 0) > 0))
    .map(([key, f]) => ({ key, label: labelForKey(key, f!.label), counts: f as FaultCounts }))
    .sort((a, b) => sortIndexForKey(a.key) - sortIndexForKey(b.key));
}
