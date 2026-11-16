export const COLORS = {
  background: '#f9fafc',
  surface: '#ffffff',
  surfaceMuted: '#edf2f8',
  textPrimary: '#070e16',
  textMuted: '#555f69',
  border: '#d9dfe5',
  borderSubtle: '#e9eef4',
  primary: '#070e16',
  primaryHover: '#1a2433',
  nexus: '#e60018',
  nexusDark: '#ff2e30',
  nexusSoft: '#fef2f2',
  nexusBorder: '#fecaca',
  environ: '#007e46',
  environDark: '#00a15a',
  environSoft: '#ecfdf5',
  environBorder: '#a7f3d0',
  warning: '#d97706',
  warningSoft: '#fffbeb',
  warningBorder: '#fde68a',
  danger: '#e60018',
  dangerSoft: '#fef2f2',
  dangerBorder: '#fecaca',
} as const;

export const MODULE_TOKENS = {
  core: {
    label: 'Mushai Core',
    accent: COLORS.primary,
    softBg: COLORS.surfaceMuted,
    border: COLORS.border,
    text: COLORS.textPrimary,
  },
  nexus: {
    label: 'Nexus',
    subtitle: 'Manufacturing Operations',
    accent: COLORS.nexus,
    softBg: COLORS.nexusSoft,
    border: COLORS.nexusBorder,
    text: '#b91c1c',
  },
  environ: {
    label: 'Environ',
    subtitle: 'EHS & Sustainability',
    accent: COLORS.environ,
    softBg: COLORS.environSoft,
    border: COLORS.environBorder,
    text: '#047857',
  },
} as const;

export const TYPOGRAPHY = {
  display: 'Michroma, Sora, system-ui, sans-serif',
  heading: 'Sora, system-ui, sans-serif',
  body: '"Plus Jakarta Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const RADII = {
  sm: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
} as const;

export const SHADOWS = {
  none: 'none',
  subtle: '0 1px 2px 0 rgba(7, 14, 22, 0.04)',
  elevated: '0 12px 32px -12px rgba(7, 14, 22, 0.12)',
} as const;

export const DIMENSIONS = {
  sidebarWidth: 256,
  topBarHeight: 56,
  tableRowHeight: 42,
} as const;
