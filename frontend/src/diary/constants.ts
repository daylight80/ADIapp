/**
 * Lesson Diary — grid & time constants.
 *
 * Centralised so the Day view, Week view, and the AddLesson sheet all share
 * the same visible-hours window and pixel-per-hour scale.
 */
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const TOP_HOUR = 5;
export const BOTTOM_HOUR = 22;
export const HOURS = Array.from(
  { length: BOTTOM_HOUR - TOP_HOUR + 1 },
  (_, i) => i + TOP_HOUR,
); // 05:00 .. 22:00 inclusive

export const HOUR_HEIGHT = 64;
export const TOTAL_HEIGHT = (BOTTOM_HOUR - TOP_HOUR) * HOUR_HEIGHT;

// Grid layout
export const CELL_W = 100; // weekly column width
export const TIME_W = 50;  // left-hand hour-label gutter
export const CELL_H = 60;  // legacy cell height (unused — kept for parity)
