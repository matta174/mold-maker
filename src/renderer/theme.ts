/**
 * Design tokens for the Mold Maker renderer UI.
 *
 * Centralizing color/radius/spacing/fontSize values here prevents the gradual
 * drift that accumulates when each component hand-rolls its own values. Prefer
 * adding a new token over inlining a raw value in a component.
 */

export const colors = {
  // Background layers — increased contrast between panel and section vs. the
  // previous values so section cards actually read as cards.
  viewportBg: '#1a1a2e',
  panelBg: '#12182b',
  sectionBg: '#1c2240',

  // Borders
  borderPanel: '#2a2a4a',
  borderSection: '#2a2a5a',
  borderSubtle: '#333',

  // Brand / primary
  primary: '#ff6b35',
  primaryAlpha: '#ff6b3520', // 12.5% alpha via 8-digit hex

  // Text
  textPrimary: '#fff',
  textBody: '#bbb',
  textMuted: '#aaa',
  // Bumped from #666 → #8a8a9a so subtitle hits WCAG AA (4.5:1) on panelBg
  textDim: '#8a8a9a',
  textFaint: '#888',
  fileInfo: '#7a9ec2',

  // Semantic
  errorBg: '#7a1e1e',

  // Scene helpers
  gridMajor: '#333355',
  gridMinor: '#222244',
} as const;

export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  pill: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
} as const;

export const fontSizes = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 20,
  xl: 22,
} as const;

/**
 * Focus ring styles. Apply via object spread on any focusable element style
 * guarded by `:focus-visible` — since inline styles can't express pseudo-
 * classes, we rely on the <style> block injected by ThemeGlobals below.
 */
export const focusRing = {
  outline: `2px solid ${colors.primary}`,
  outlineOffset: 2,
} as const;

/**
 * Global focus-visible rule. Inline styles can't target pseudo-classes, so
 * render this once near the root to give every focusable element a visible
 * focus ring that matches the brand primary.
 */
export const focusVisibleCss = `
  *:focus-visible {
    outline: 2px solid ${colors.primary};
    outline-offset: 2px;
    border-radius: 4px;
  }
`;
