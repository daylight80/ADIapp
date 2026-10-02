import * as fs from 'fs';
import * as path from 'path';
import { INSTRUCTOR_TAB_SPECS, STUDENT_TAB_SPECS, type TabSpec } from '../navTabs';

const appDir = path.join(__dirname, '..', '..', 'app');
const routes = (tabs: TabSpec[]) => tabs.map((t) => t.route).filter(Boolean);

describe('instructor bottom bar', () => {
  it('has Home, Diary, Students, Profile and Logout, in that order', () => {
    expect(INSTRUCTOR_TAB_SPECS.map((t) => t.key)).toEqual(['home', 'diary', 'students', 'profile', 'logout']);
    expect(INSTRUCTOR_TAB_SPECS.map((t) => t.label)).toEqual(['Home', 'Diary', 'Students', 'Profile', 'Logout']);
  });

  it('can reach the Profile screen, which is where Gift vouchers, Deadlines and Pricing live', () => {
    expect(routes(INSTRUCTOR_TAB_SPECS)).toContain('/profile-screen');
  });
});

describe('student bottom bar', () => {
  it('still has My Learning, Mock Test, Profile and Logout', () => {
    expect(STUDENT_TAB_SPECS.map((t) => t.key)).toEqual(['learning', 'mock', 'profile', 'logout']);
  });
});

describe.each([
  ['instructor', INSTRUCTOR_TAB_SPECS],
  ['student', STUDENT_TAB_SPECS],
])('%s tabs are well formed', (_name, tabs) => {
  it('has unique keys', () => {
    const keys = tabs.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ends with Logout, which is the only tab with no route', () => {
    expect(tabs[tabs.length - 1].key).toBe('logout');
    expect(tabs.filter((t) => t.route === '').map((t) => t.key)).toEqual(['logout']);
  });

  it('points every other tab at a screen that exists', () => {
    for (const route of routes(tabs)) {
      expect(route.startsWith('/')).toBe(true);
      const file = path.join(appDir, `${route.slice(1)}.tsx`);
      expect({ route, exists: fs.existsSync(file) }).toEqual({ route, exists: true });
    }
  });
});
