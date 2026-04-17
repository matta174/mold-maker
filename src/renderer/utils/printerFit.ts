/**
 * Printer fit calculations for the Auto-scale-to-printer feature (roadmap #10).
 *
 * Design philosophy — "polite suggestion, not silent rescale."
 *
 * The competitor we looked at (mold.actionbox.ca) silently downscales your
 * model to whatever their server decides is reasonable, with no UI showing
 * that it happened. Users discover their printed mold is tiny only after
 * they've slicer-sliced and started a 6-hour print. That's hostile UX.
 *
 * This module computes:
 *   1. Whether the predicted *mold* (not just the part) fits the printer.
 *   2. If it doesn't fit, what uniform scale would make it fit with a safety
 *      margin, so the user can click "Apply" once and be done.
 *
 * Important: we predict the MOLD footprint, not the raw part footprint.
 * A 200mm part with 10% wall-thickness ratio produces a ~240mm-tall mold
 * (part + walls on both sides). If we only checked the part size, the
 * "this fits!" indicator would lie to users half the time.
 *
 * Scale is uniform (same factor on X/Y/Z). Non-uniform scale breaks
 * the CSG pipeline's assumptions about wall thickness being isotropic,
 * and would produce molds with uneven walls that users would (correctly)
 * report as bugs.
 */
import type { PrinterPreset } from './printerPresets';

/** 3D vector of millimeter dimensions. All fields non-negative. */
export interface Mm3 {
  x: number;
  y: number;
  z: number;
}

/** Shape of the part's axis-aligned bounding box — matches what
 *  THREE.Box3.getSize(new THREE.Vector3()) gives us. */
export interface PartBbox {
  x: number;
  y: number;
  z: number;
}

/**
 * Predict the footprint of the *mold* (not the raw part) at a given scale.
 *
 * Why this matters: the mold adds walls on every side of the part. A 100mm
 * part with a 10% wall-thickness ratio produces a mold that's 120mm on that
 * axis (wall on either side = 10mm each). Ignoring this makes the fit
 * readout overoptimistic by ~20% on every axis, which is the difference
 * between "fits a Bambu" and "doesn't fit a Bambu."
 *
 * Assumption: wall thickness applies to all six faces uniformly. This
 * matches the CSG implementation in moldGenerator.ts as of 2026-04. If
 * that ever changes (e.g., we add separate top/bottom wall ratios), this
 * math will drift — update here when it does.
 */
export function predictMoldFootprint(
  partBbox: PartBbox,
  wallThicknessRatio: number,
  scale: number,
): Mm3 {
  // Wall thickness is a fraction of the part's *largest* extent — this is
  // how it's computed in moldGenerator. Using the largest axis means the
  // wall is the same absolute thickness on every face, which is what
  // makes structural sense (thin walls on the short axis would crack).
  const maxPartAxis = Math.max(partBbox.x, partBbox.y, partBbox.z);
  const wallMm = maxPartAxis * wallThicknessRatio * scale;

  return {
    x: partBbox.x * scale + 2 * wallMm,
    y: partBbox.y * scale + 2 * wallMm,
    z: partBbox.z * scale + 2 * wallMm,
  };
}

/** Result of a fit check — one object so callers can render richly
 *  without re-computing derived numbers. */
export interface FitResult {
  /** True if the mold footprint fits inside the printer's build volume. */
  fits: boolean;
  /** Predicted mold size in mm at the current scale. */
  moldSize: Mm3;
  /** Per-axis overflow in mm. Zero on axes that fit, positive on axes
   *  that don't. Useful for messaging like "20mm too tall." */
  overflow: Mm3;
  /** Axis with the worst overflow (or null if it fits). Useful for
   *  single-line readouts: "12mm too tall on Z." */
  worstAxis: 'x' | 'y' | 'z' | null;
}

/**
 * Compute how the predicted mold fits inside the printer's build volume.
 *
 * Returns a FitResult with enough detail for the UI to say either
 * "✓ fits" or "✗ 12mm too tall on Z" without further math.
 */
export function computeFit(
  partBbox: PartBbox,
  wallThicknessRatio: number,
  scale: number,
  printer: PrinterPreset,
): FitResult {
  const moldSize = predictMoldFootprint(partBbox, wallThicknessRatio, scale);

  const overflow: Mm3 = {
    x: Math.max(0, moldSize.x - printer.volumeMm.x),
    y: Math.max(0, moldSize.y - printer.volumeMm.y),
    z: Math.max(0, moldSize.z - printer.volumeMm.z),
  };

  const fits = overflow.x === 0 && overflow.y === 0 && overflow.z === 0;

  let worstAxis: 'x' | 'y' | 'z' | null = null;
  if (!fits) {
    // Pick the axis with the largest *absolute* overflow, not the largest
    // ratio. If the Z is 2mm too tall and X is 50mm too wide, the X is
    // the bigger problem even if Z is the one blocking the print.
    if (overflow.x >= overflow.y && overflow.x >= overflow.z) worstAxis = 'x';
    else if (overflow.y >= overflow.z) worstAxis = 'y';
    else worstAxis = 'z';
  }

  return { fits, moldSize, overflow, worstAxis };
}

/**
 * Suggest a uniform scale factor that makes the mold fit the printer with
 * a safety margin.
 *
 * Returns 1.0 if the part at current size already fits (no scaling needed).
 * Returns a number < 1.0 if the part needs to shrink.
 * Never returns a number > 1.0 — we don't auto-upscale. If users want a
 * bigger print, they can type a scale manually, but auto-suggesting
 * upscaling is rude (printer time is expensive, and the user may not
 * have the filament for it).
 *
 * Safety margin default 0.95 = "fill 95% of the build volume's worst axis
 * at max." This leaves headroom for:
 *   - printer bed levelling variation
 *   - first-layer brim / raft
 *   - the fact that parts touching the exact build-volume edge tend to
 *     print badly on most consumer machines
 *
 * Math: we need scale S such that the predicted mold at scale S fits the
 * printer volume * safetyMargin on every axis. Because wall thickness
 * scales linearly with the part dimensions AND with S (the wall is a
 * ratio of the scaled part's max axis), the predicted mold size is:
 *
 *   mold[axis] = (partBbox[axis] + 2 * wallRatio * maxPartAxis) * S
 *
 * So the constraint per axis is:
 *   (partBbox[axis] + 2 * wallRatio * maxPartAxis) * S <= printer[axis] * margin
 *   S <= printer[axis] * margin / (partBbox[axis] + 2 * wallRatio * maxPartAxis)
 *
 * Take the min across axes. Clamp to <= 1.0. Round down to a "nice"
 * increment (0.01 = 1%) so the user doesn't see "0.8347..." in the UI.
 */
export function suggestScale(
  partBbox: PartBbox,
  wallThicknessRatio: number,
  printer: PrinterPreset,
  safetyMargin: number = 0.95,
): number {
  // Guard: if the part bbox is garbage (uninitialized geometry, bug upstream),
  // return 1.0 rather than NaN or Infinity. The caller's fit readout will
  // show the part doesn't fit anyway.
  if (partBbox.x <= 0 || partBbox.y <= 0 || partBbox.z <= 0) return 1.0;

  const maxPartAxis = Math.max(partBbox.x, partBbox.y, partBbox.z);
  const wallTerm = 2 * wallThicknessRatio * maxPartAxis;

  const scaleLimits = [
    (printer.volumeMm.x * safetyMargin) / (partBbox.x + wallTerm),
    (printer.volumeMm.y * safetyMargin) / (partBbox.y + wallTerm),
    (printer.volumeMm.z * safetyMargin) / (partBbox.z + wallTerm),
  ];

  const maxAllowedScale = Math.min(...scaleLimits);

  // Never auto-upscale. If the part already fits with headroom, leave it.
  if (maxAllowedScale >= 1.0) return 1.0;

  // Round DOWN to the nearest 1% so the suggestion is trustworthy.
  // If the math says 0.834, round to 0.83 — if we rounded up to 0.84 we
  // might push the mold back into overflow on a marginal axis.
  return Math.floor(maxAllowedScale * 100) / 100;
}

/**
 * Format a fit readout for display. Lives here (not in the component) so
 * the same wording is unit-testable and reusable anywhere we surface fit
 * (e.g., if we later add a warning at export time).
 *
 * Examples:
 *   "✓ Fits (240 × 180 × 120 mm)"
 *   "✗ 14mm too tall — Z overflows"
 *   "✗ Doesn't fit — 22mm on X, 14mm on Y"
 */
export function formatFitStatus(fit: FitResult): string {
  if (fit.fits) {
    const { x, y, z } = fit.moldSize;
    return `Fits (${Math.round(x)} × ${Math.round(y)} × ${Math.round(z)} mm)`;
  }

  const parts: string[] = [];
  if (fit.overflow.x > 0) parts.push(`${Math.ceil(fit.overflow.x)}mm on X`);
  if (fit.overflow.y > 0) parts.push(`${Math.ceil(fit.overflow.y)}mm on Y`);
  if (fit.overflow.z > 0) parts.push(`${Math.ceil(fit.overflow.z)}mm on Z`);
  return `Doesn't fit — ${parts.join(', ')}`;
}
