/**
 * The shift-state vocabulary from DESIGN.md §2.
 * Load bearing, not decorative: these are the product's own states, and a diagram
 * on this site has to agree with the screenshot beside it.
 */
export const stateNames = [
  'float-out',
  'float-in',
  'pending',
  'allied',
  'permanent',
  'urgent',
  'open',
] as const;

export type StateName = (typeof stateNames)[number];
