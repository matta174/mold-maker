import { describe, it, expect } from 'vitest';
import {
  predictMoldFootprint,
  computeFit,
  suggestScale,
  formatFitStatus,
} from './printerFit';
import type { PrinterPreset } from './printerPresets';

/**
 * Tests focus on the edge cases that will bite if the math drifts:
 *   - Wall thickness ratio's effect on predicted footprint (easy to forget).
 *   - Never auto-upscaling (the "polite suggestion" rule — breaking this
 *     would be a regression we'd hear about in Reddit comments immediately).
 *   - Overflow detection including the axis with the biggest problem.
 *   - Formatting handles edge cases (exact fit, single-axis overflow).
 *
 * Fixtures use realistic printer volumes so drift into an unrealistic
 * test universe is visible — if someone tunes the math to pass a test
 * against a 50mm printer, the real-printer cases here should catch it.
 */

const BAMBU_X1C: PrinterPreset = {
  id: 'bambu-x1c',
  label: 'Bambu X1C (256³)',
  category: 'fdm',
  volumeMm: { x: 256, y: 256, z: 256 },
};

const PRUSA_MINI: PrinterPreset = {
  id: 'prusa-mini',
  label: 'Prusa Mini+ (180³)',
  category: 'fdm',
  volumeMm: { x: 180, y: 180, z: 180 },
};

describe('predictMoldFootprint', () => {
  it('returns the part bbox when wall thickness is zero and scale is 1', () => {
    const mold = predictMoldFootprint({ x: 100, y: 100, z: 100 }, 0, 1);
    expect(mold).toEqual({ x: 100, y: 100, z: 100 });
  });

  it('adds wall thickness on every axis, computed from the largest part axis', () => {
    // Part 100x50x20, wall ratio 0.1 → wall = 10mm on each face
    // Each axis grows by 2 * 10 = 20mm
    const mold = predictMoldFootprint({ x: 100, y: 50, z: 20 }, 0.1, 1);
    expect(mold).toEqual({ x: 120, y: 70, z: 40 });
  });

  it('scales both part dimensions and wall thickness together', () => {
    // Part 100x100x100, wall ratio 0.1 → wall = 10mm at scale 1
    // At scale 0.5, part becomes 50 and wall becomes 5mm → mold = 60
    const mold = predictMoldFootprint({ x: 100, y: 100, z: 100 }, 0.1, 0.5);
    expect(mold).toEqual({ x: 60, y: 60, z: 60 });
  });
});

describe('computeFit', () => {
  it('reports fits=true when the mold is smaller than the printer volume', () => {
    // 100mm cube, wall 0.1 → 120mm mold, easily fits 256mm printer
    const fit = computeFit({ x: 100, y: 100, z: 100 }, 0.1, 1, BAMBU_X1C);
    expect(fit.fits).toBe(true);
    expect(fit.overflow).toEqual({ x: 0, y: 0, z: 0 });
    expect(fit.worstAxis).toBe(null);
    expect(fit.moldSize).toEqual({ x: 120, y: 120, z: 120 });
  });

  it('reports fits=false and per-axis overflow when too large', () => {
    // 200mm cube, wall 0.1 → 240mm mold, overflows 180mm Prusa Mini by 60 on all axes
    const fit = computeFit({ x: 200, y: 200, z: 200 }, 0.1, 1, PRUSA_MINI);
    expect(fit.fits).toBe(false);
    expect(fit.moldSize).toEqual({ x: 240, y: 240, z: 240 });
    expect(fit.overflow).toEqual({ x: 60, y: 60, z: 60 });
  });

  it('identifies the worst axis when overflow is uneven', () => {
    // Part 150x100x50, wall 0.1 → wall = 15mm, mold = 180x130x80
    // Prusa Mini 180³: exactly fits X, Y has 0 overflow, Z has 0 overflow
    // So bump X up to provoke overflow on just one axis.
    const fit = computeFit({ x: 200, y: 100, z: 50 }, 0.1, 1, PRUSA_MINI);
    // max part axis = 200, wall = 20 → mold = 240x140x90
    // Printer 180: overflow 60x0x0
    expect(fit.fits).toBe(false);
    expect(fit.overflow.x).toBe(60);
    expect(fit.overflow.y).toBe(0);
    expect(fit.overflow.z).toBe(0);
    expect(fit.worstAxis).toBe('x');
  });

  it('picks Z as worst axis when Z overflow dominates', () => {
    // Short in X/Y, tall in Z → Z overflows first
    // Part 50x50x200, wall 0.1 → wall = 20mm, mold = 90x90x240
    // Prusa Mini 180: overflow 0x0x60
    const fit = computeFit({ x: 50, y: 50, z: 200 }, 0.1, 1, PRUSA_MINI);
    expect(fit.worstAxis).toBe('z');
    expect(fit.overflow.z).toBe(60);
  });

  it('accounts for scale in the fit calculation', () => {
    // Same 200mm cube that overflowed at scale 1 — at scale 0.5 should fit
    const fit = computeFit({ x: 200, y: 200, z: 200 }, 0.1, 0.5, PRUSA_MINI);
    expect(fit.fits).toBe(true);
    expect(fit.moldSize).toEqual({ x: 120, y: 120, z: 120 });
  });
});

describe('suggestScale', () => {
  it('returns 1.0 when the part already fits with headroom', () => {
    // 50mm cube, mold = 60mm, Bambu X1C 256 — tons of room
    const scale = suggestScale({ x: 50, y: 50, z: 50 }, 0.1, BAMBU_X1C);
    expect(scale).toBe(1.0);
  });

  it('never returns a scale greater than 1.0 even with huge headroom', () => {
    // Tiny part that could physically be upscaled 5x and still fit — we refuse.
    const scale = suggestScale({ x: 10, y: 10, z: 10 }, 0.1, BAMBU_X1C);
    expect(scale).toBe(1.0);
  });

  it('returns a scale less than 1.0 when the mold overflows', () => {
    // 300mm cube, 0.1 wall → 360mm mold, overflows 256mm Bambu by a lot
    const scale = suggestScale({ x: 300, y: 300, z: 300 }, 0.1, BAMBU_X1C);
    expect(scale).toBeLessThan(1.0);
    expect(scale).toBeGreaterThan(0);
  });

  it('suggested scale actually fits the mold inside the printer with margin', () => {
    const partBbox = { x: 300, y: 300, z: 300 };
    const wall = 0.1;
    const scale = suggestScale(partBbox, wall, BAMBU_X1C, 0.95);
    const fit = computeFit(partBbox, wall, scale, BAMBU_X1C);
    expect(fit.fits).toBe(true);
    // And with 95% margin — should leave at least ~1% of build volume free on worst axis
    const worst = Math.max(fit.moldSize.x, fit.moldSize.y, fit.moldSize.z);
    expect(worst).toBeLessThanOrEqual(256 * 0.95);
  });

  it('is constrained by the tightest axis, not the average', () => {
    // Tall narrow part — Z is the binding constraint
    // Part 50x50x400, wall 0.1 → wall = 40mm, mold = 130x130x480
    // Prusa Mini 180: X/Y fit easy, Z needs to shrink to 180/480 = 0.375
    // With 0.95 margin → 180*0.95 / 480 = 0.356, floor to 0.35
    const scale = suggestScale({ x: 50, y: 50, z: 400 }, 0.1, PRUSA_MINI);
    expect(scale).toBeLessThanOrEqual(0.36);
    expect(scale).toBeGreaterThan(0.30);
  });

  it('rounds the suggested scale down (never up) so the mold still fits', () => {
    // Pathological case: exact division produces a recurring decimal.
    // We must round DOWN — rounding up would push the mold back into overflow.
    const partBbox = { x: 300, y: 300, z: 300 };
    const wall = 0.1;
    const rawSuggestion = suggestScale(partBbox, wall, BAMBU_X1C, 0.95);
    // Whatever it suggests should be an integer percentage (0.01 precision).
    expect(rawSuggestion * 100).toBeCloseTo(Math.round(rawSuggestion * 100), 10);
    // And the resulting mold should still fit.
    const fit = computeFit(partBbox, wall, rawSuggestion, BAMBU_X1C);
    expect(fit.fits).toBe(true);
  });

  it('returns 1.0 for a degenerate bbox (guards against NaN)', () => {
    expect(suggestScale({ x: 0, y: 0, z: 0 }, 0.1, BAMBU_X1C)).toBe(1.0);
    expect(suggestScale({ x: 100, y: 0, z: 100 }, 0.1, BAMBU_X1C)).toBe(1.0);
  });

  it('applies a stricter safety margin when requested', () => {
    const partBbox = { x: 200, y: 200, z: 200 };
    const wall = 0.1;
    const scaleA = suggestScale(partBbox, wall, BAMBU_X1C, 0.95);
    const scaleB = suggestScale(partBbox, wall, BAMBU_X1C, 0.80);
    // Stricter margin → smaller suggested scale (or equal if both clamp to 1.0)
    expect(scaleB).toBeLessThanOrEqual(scaleA);
  });
});

describe('formatFitStatus', () => {
  it('renders the fit case with rounded mm dimensions', () => {
    const fit = computeFit({ x: 100, y: 100, z: 100 }, 0.1, 1, BAMBU_X1C);
    expect(formatFitStatus(fit)).toBe('Fits (120 × 120 × 120 mm)');
  });

  it('renders a single-axis overflow with just that axis', () => {
    // Only Z overflows
    const fit = computeFit({ x: 50, y: 50, z: 200 }, 0.1, 1, PRUSA_MINI);
    expect(formatFitStatus(fit)).toBe("Doesn't fit — 60mm on Z");
  });

  it('renders multi-axis overflow with all offending axes', () => {
    const fit = computeFit({ x: 200, y: 200, z: 200 }, 0.1, 1, PRUSA_MINI);
    expect(formatFitStatus(fit)).toBe(
      "Doesn't fit — 60mm on X, 60mm on Y, 60mm on Z",
    );
  });

  it('ceils fractional overflow (14.2mm → 15mm) so the message is not overoptimistic', () => {
    // Part 161x50x50, wall 0.1 → wall = 16.1mm, mold X = 193.2
    // Prusa Mini 180 → overflow = 13.2mm, ceil to 14
    const fit = computeFit({ x: 161, y: 50, z: 50 }, 0.1, 1, PRUSA_MINI);
    expect(formatFitStatus(fit)).toContain('14mm on X');
  });
});
