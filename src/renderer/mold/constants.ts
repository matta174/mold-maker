// ─────────────────────────────────────────────────────────────────────────────
// Tunables for mold generation
// ─────────────────────────────────────────────────────────────────────────────
//
// Every dimensionless ratio used during mold generation lives here so they can
// be tuned without hunting through geometry code. Values are expressed as a
// fraction of some reference dimension — usually the model's bounding-box extent
// or the wall thickness. They are NOT absolute millimetre values.
//

/** Wall thickness as a fraction of max bbox extent. Kept ratio-based because
 *  it's the scaffold that pin radius, pin inset, sprue margin, vent margin,
 *  and a handful of other tunables are derived from. Switching it to absolute
 *  mm would cascade through a dozen dependents; that's a separate refactor.
 */
export const WALL_THICKNESS_RATIO = 0.08;

/** Default clearance between mating surfaces, in mm. Changed from ratio-of-
 *  wall-thickness (roadmap #13) because casters think in absolute mm and reuse
 *  known-good values across models — scaling clearance with model size was a
 *  programmer's abstraction, not a user's mental model. 0.15 mm is the common
 *  FDM tight-fit clearance (loose enough to demold, tight enough to register).
 *  Users can dial to 0.05 mm for resin prints or 1.0 mm for rough clearance. */
export const CLEARANCE_MM = 0.15;

/** Default sprue diameter (top / pour end), in mm. Same rationale as
 *  CLEARANCE_MM — absolute mm matches how casters think. The sprue tapers
 *  narrower toward the cavity via SPRUE_TOP_MULTIPLIER (top is 2× gate). */
export const SPRUE_DIAMETER_MM = 10;

/** Registration pin radius as a fraction of wall thickness. */
export const PIN_RADIUS_RATIO = 0.3;
/** Registration pin height as a fraction of wall thickness. */
export const PIN_HEIGHT_RATIO = 0.6;
/** Inset of registration pins from the bbox corners, as fraction of wall thickness. */
export const PIN_INSET_RATIO = 0.7;
/** Sprue top (pour end) radius multiplier vs. gate radius. The gate end is
 *  narrower than the top so material flows from wide to narrow (helps demolding
 *  and reduces cavity-side stress). 2:1 is a compromise between pour ergonomics
 *  (wider is better) and material waste (narrower is better). */
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

// ─────────────────────────────────────────────────────────────────────────────
// Feature flags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Oblique parting planes — roadmap #5.
 *
 * When false:
 *   • `cutAngle` is accepted everywhere in the API for forward compat, but
 *     the CSG, channel placement, draft analysis, and UI all behave exactly
 *     as before (axis-aligned cuts only). Any non-zero value is silently
 *     clamped to 0 at the edges of the pipeline. `cutAngle=0` is the only
 *     value a user can actually produce because the slider is hidden.
 *   • Lets us land the plumbing in small commits, ship to main, and exercise
 *     the data-model changes via tests without exposing a half-built feature
 *     to end users.
 *
 * When true:
 *   • The Cut Angle slider is visible in the Control Panel.
 *   • Non-zero cutAngle actually tilts the parting plane in CSG, pin
 *     placement, sprue/vent classification, and the heatmap.
 *
 * Flip once all downstream code paths are implemented and verified.
 * Search for this constant to find every gated code path.
 */
export const ENABLE_OBLIQUE_PLANES = true;

/** Dev-only logger — gated so production builds don't spam the console. */
const DEBUG = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true;
export const dbg = (...args: unknown[]) => { if (DEBUG) console.log(...args); };
