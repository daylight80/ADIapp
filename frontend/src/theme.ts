// British colour palette - Orange & Blue driving school theme
export const theme = {
  colors: {
    primary: '#00539F',
    primaryLight: '#E5F0FA',
    primaryDark: '#003A6F',
    accent: '#FF6B00',
    accentHover: '#E55E00',
    background: '#F8FAFC',
    surface: '#FFFFFF',
    border: '#E2E8F0',
    text: '#0F172A',
    textMuted: '#64748B',
    faultDriving: '#F59E0B',
    faultSerious: '#EF4444',
    faultDangerous: '#7F1D1D',
    success: '#10B981',
    info: '#0EA5E9',
    warning: '#F59E0B',
    danger: '#EF4444',
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    full: 999,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  font: {
    h1: { fontSize: 28, fontWeight: '700' as const, color: '#0F172A' },
    h2: { fontSize: 22, fontWeight: '700' as const, color: '#0F172A' },
    h3: { fontSize: 18, fontWeight: '600' as const, color: '#0F172A' },
    body: { fontSize: 15, fontWeight: '400' as const, color: '#0F172A' },
    caption: { fontSize: 13, fontWeight: '400' as const, color: '#64748B' },
    button: { fontSize: 16, fontWeight: '600' as const, color: '#FFFFFF' },
  },
};

export type Theme = typeof theme;
