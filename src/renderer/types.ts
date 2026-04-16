/**
 * Shared types used across hooks, mold/, components/, and utils/.
 *
 * Kept in its own module to avoid circular imports: previously `Axis` lived in
 * App.tsx and was imported by mold/*.ts, which are in turn imported by the
 * hook that App.tsx imports.
 */

/** Split-plane axis for the two-part mold. */
export type Axis = 'x' | 'y' | 'z';
