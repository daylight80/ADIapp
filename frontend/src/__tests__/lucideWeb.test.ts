// The web build swaps 'lucide-react-native' for src/lucideWeb.ts, a short list of just the icons the app uses
// (see metro.config.js). An icon imported anywhere but missing from that list is `undefined` on the web, and the
// screen using it goes blank (React error #130). That happened to Home when the Action Centre card was added.
// Fix: run `python scripts/gen-lucide-web.py` from frontend/ after adding an icon import.
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name === '__tests__' || name.name === 'node_modules') continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name.name) && name.name !== 'lucideWeb.ts') out.push(p);
  }
  return out;
}

function importedIcons(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const f of [...walk(path.join(root, 'app')), ...walk(path.join(root, 'src'))]) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]lucide-react-native['"]/g)) {
      for (const part of m[1].split(',')) {
        const n = part.replace(/^\s*type\s+/, '').split(' as ')[0].trim();
        if (n) used.set(n, [...(used.get(n) || []), path.relative(root, f)]);
      }
    }
  }
  return used;
}

describe('web icon list', () => {
  it('has every icon the app imports', () => {
    const web = fs.readFileSync(path.join(root, 'src', 'lucideWeb.ts'), 'utf8');
    const exported = new Set([...web.matchAll(/export \{ default as (\w+) \}/g)].map((m) => m[1]));
    const missing = [...importedIcons()].filter(([n]) => !exported.has(n)).map(([n, files]) => `${n} (${files.join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('points every entry at an icon file that exists', () => {
    const web = fs.readFileSync(path.join(root, 'src', 'lucideWeb.ts'), 'utf8');
    const files = [...web.matchAll(/from 'lucide-react-native\/icons\/([\w-]+)'/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(50);
    const dir = path.join(root, 'node_modules', 'lucide-react-native', 'dist', 'esm', 'icons');
    const absent = files.filter((f) => !fs.existsSync(path.join(dir, `${f}.mjs`)));
    expect(absent).toEqual([]);
  });
});
