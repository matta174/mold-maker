/**
 * Shared types used across hooks, mold/, components/, and utils/.
 *
 * Kept in its own module to avoid circular imports: previously `Axis` lived in
 * App.tsx and was imported by mold/*.ts, which are in turn imported by the
 * hook that App.tsx imports.
 */

/** Split-plane axis for the two-part mold. */
export type Axis = 'x' | 'y' | 'z';

/**
 * Outer shell shape for the generated mold.
 *
 * - `rect`:        axis-aligned rectangular box. Default. Best for most parts —
 *                  cheapest to print, cleanest registration pins.
 * - `cylinder`:    circular cross-section, extruded along the parting axis.
 *                  Wins for round parts (bottles, dials, buttons) where a
 *                  rectangular mold would waste volume and whose curved walls
 *                  demold more symmetrically than flat faces.
 * - `roundedRect`: rectangular with rounded vertical edges (along the parting
 *                  axis). Small aesthetic win on FDM prints where sharp outer
 *                  corners tend to delaminate; otherwise equivalent to `rect`.
 *
 * Note: the prism axis for `cylinder` and `roundedRect` is *always* the parting
 * axis — this gives a natural "puck-splits-in-half" behaviour when the mold is
 * cut. For a non-axis-aligned parting direction we'd need a different shell,
 * but that's the oblique-parting-plane feature, not this one.
 */
export type MoldBoxShape = 'rect' | 'cylinder' | 'roundedRect';
