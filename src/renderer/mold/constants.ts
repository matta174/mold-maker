// ─────────────────────────────────────────────────────────────────────────────
// Tunables for mold generation
// ─────────────────────────────────────────────────────────────────────────────
//
// Every dimensionless ratio used during mold generation lives here so they can
// be tuned without hunting through geometry code. Values are expressed as a
// fraction of some reference dimension — usually the model's bounding-box extent
// or the wall thickness. They are NOT absolute millimetre values.
//

/** Wall thickness as a fraction of max bbox extent. */
export const WALL_THICKNESS_RATIO = 0.08;
/** Clearance (slop between mating surfaces) as a fraction of wall thickness. */
export const CLEARANCE_RATIO = 0.05;
/** Registration pin radius as a fraction of wall thickness. */
export const PIN_RADIUS_RATIO = 0.3;
/** Registration pin height as a fraction of wall thickness. */
export const PIN_HEIGHT_RATIO = 0.6;
/** Inset of registration pins from the bbox corners, as fraction of wall thickness. */
export const PIN_INSET_RATIO = 0.7;
/** Estimated wall thickness of the part (for gate sizing), as fraction of min bbox extent. */
export const EST_WALL_THICKNESS_RATIO = 0.15;
/** Sprue gate radius as fraction of estimated wall thickness (min). */
export const SPRUE_GATE_TO_WALL = 0.75;
/** Sprue top (pour end) radius multiplier vs. gate radius. */
export const SPRUE_TOP_MULTIPLIER = 2.0;
/** Vent radius as fraction of sprue gate radius. */
export const VENT_RADIUS_RATIO = 0.35;
/** Vent taper: top/bottom radius ratio for demolding. */
export const VENT_TAPER_RATIO = 1.2;
/** Minimum spacing between vents, as fraction of lateral bbox extent. */
export const VENT_MIN_SPACING_RATIO = 0.3;
/** Max candidate vertices to sample when searching for vent positions. */
export const VENT_CANDIDATE_SAMPLE_CAP = 2000;
/** Max number of vents to place. */
export const MAX_VENTS = 4;
/** Minimum number of vents (corners are added if clustering yields fewer). */
export const MIN_VENTS = 2;
/** Vertex-merge tolerance for STL→Manifold bridge. */
export const MERGE_TOLERANCE = 1e-5;
/** Exploded-view separation as fraction of max bbox extent (used in App.tsx). */
export const EXPLODE_OFFSET_RATIO = 0.3;

/** Dev-only logger — gated so production builds don't spam the console. */
const DEBUG = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true;
export const dbg = (...args: unknown[]) => { if (DEBUG) console.log(...args); };
