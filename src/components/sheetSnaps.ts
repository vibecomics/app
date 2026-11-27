/** The heights the mobile bottom sheet rests at. */
export const SNAPS = ['closed', 'half', 'full'] as const;
export type Snap = (typeof SNAPS)[number];

/** Where the chosen height is kept in localStorage. */
export const SHEET_SNAP_KEY = 'comic-builder:sheet';
