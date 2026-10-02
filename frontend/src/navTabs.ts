// The bottom bar's tabs, kept apart from the component so the list can be tested
// (see __tests__/navTabs.test.ts). BottomNav.tsx adds the icons.
//
// The instructor's Profile tab is here on purpose. It was dropped on 10 Sept when
// Logout was added, and nothing else linked to the Profile screen, which left
// everything on it unreachable for instructors: Gift vouchers, Deadlines &
// reminders, Pricing & packages, the calendar feed and data export.

export type TabSpec = { key: string; label: string; route: string };

export const INSTRUCTOR_TAB_SPECS: TabSpec[] = [
  { key: 'home', label: 'Home', route: '/home-screen' },
  { key: 'diary', label: 'Diary', route: '/lesson-diary-screen' },
  { key: 'students', label: 'Students', route: '/student-crm-screen' },
  { key: 'profile', label: 'Profile', route: '/profile-screen' },
  { key: 'logout', label: 'Logout', route: '' },
];

export const STUDENT_TAB_SPECS: TabSpec[] = [
  { key: 'learning', label: 'My Learning', route: '/student-home-screen' },
  { key: 'mock', label: 'Mock Test', route: '/dl25-mock-test-screen' },
  { key: 'profile', label: 'Profile', route: '/profile-screen' },
  { key: 'logout', label: 'Logout', route: '' },
];
