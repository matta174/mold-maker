/**
 * Printer build-volume presets for the Auto-scale-to-printer feature (roadmap #10).
 *
 * Philosophy — we show *build volumes*, not marketing specs. Vendors often quote
 * the largest axis with a star ("Up to 256mm!") — the star being that the print
 * becomes unreliable near the edge. Values below are the usable volumes most
 * users see after subtracting a conservative brim / first-layer margin.
 *
 * Deliberately small curated list, not every printer ever made. The long tail
 * lives behind the "Custom..." option — users with niche printers can type X/Y/Z
 * directly. If a printer here gets complaints, replace it with the model real
 * users asked for; don't let this list bloat into DIY-3D-printing-wiki territory.
 *
 * Source notes (current as of 2026-04):
 *   - Bambu X1C / P1S / A1 — 256³, per Bambu's spec page
 *   - Bambu A1 mini — 180³
 *   - Prusa MK4 / MK4S — 250 × 210 × 220 (Prusa's wiki)
 *   - Prusa Mini+ — 180³ (officially 180 × 180 × 180)
 *   - Prusa XL — 360³
 *   - Ender 3 V3 / S1 — 220 × 220 × 250 (Creality spec)
 *   - Elegoo Saturn 3 Ultra (resin) — 218.88 × 122.88 × 260
 *   - Elegoo Mars 5 Pro (resin) — 153.36 × 77.76 × 165
 *   - Anycubic Photon M5s (resin) — 218.88 × 122.88 × 200
 *
 * If any vendor updates a volume and nobody here catches it, PRs welcome.
 */

/** Broad category controls grouping in the UI — users who print on resin
 *  machines tend to ask "does this fit my Saturn?" and want the resin list,
 *  not a sea of FDM bed sizes. */
export type PrinterCategory = 'fdm' | 'resin';

export interface PrinterPreset {
  /** Stable identifier used in state + telemetry. kebab-case, no spaces. */
  id: string;
  /** Human-readable label for the dropdown. */
  label: string;
  /** FDM (filament) vs MSLA (resin). */
  category: PrinterCategory;
  /** Usable build volume in millimeters. X = width, Y = depth, Z = height. */
  volumeMm: { x: number; y: number; z: number };
}

export const PRINTER_PRESETS: readonly PrinterPreset[] = [
  // FDM — most common first (dropdown bias toward popular choices)
  { id: 'bambu-a1',        label: 'Bambu A1 / A1 mini (256 or 180)',      category: 'fdm',   volumeMm: { x: 256, y: 256, z: 256 } },
  { id: 'bambu-a1-mini',   label: 'Bambu A1 mini (180³)',                  category: 'fdm',   volumeMm: { x: 180, y: 180, z: 180 } },
  { id: 'bambu-x1c',       label: 'Bambu X1C / P1S (256³)',                category: 'fdm',   volumeMm: { x: 256, y: 256, z: 256 } },
  { id: 'prusa-mk4',       label: 'Prusa MK4 / MK4S (250×210×220)',        category: 'fdm',   volumeMm: { x: 250, y: 210, z: 220 } },
  { id: 'prusa-mini',      label: 'Prusa Mini+ (180³)',                    category: 'fdm',   volumeMm: { x: 180, y: 180, z: 180 } },
  { id: 'prusa-xl',        label: 'Prusa XL (360³)',                       category: 'fdm',   volumeMm: { x: 360, y: 360, z: 360 } },
  { id: 'ender-3',         label: 'Ender 3 V3 / S1 (220×220×250)',         category: 'fdm',   volumeMm: { x: 220, y: 220, z: 250 } },
  // Resin
  { id: 'elegoo-saturn-3', label: 'Elegoo Saturn 3 Ultra (219×123×260)',   category: 'resin', volumeMm: { x: 218, y: 122, z: 260 } },
  { id: 'elegoo-mars-5',   label: 'Elegoo Mars 5 Pro (153×78×165)',        category: 'resin', volumeMm: { x: 153, y: 77,  z: 165 } },
  { id: 'anycubic-m5s',    label: 'Anycubic Photon M5s (219×123×200)',     category: 'resin', volumeMm: { x: 218, y: 122, z: 200 } },
] as const;

/** Look up a preset by id. Returns undefined if the id no longer exists
 *  (e.g., we removed a preset between app versions and a stored selection
 *  points at the ghost id). Callers should treat undefined as "no selection." */
export function getPresetById(id: string | null | undefined): PrinterPreset | undefined {
  if (!id) return undefined;
  return PRINTER_PRESETS.find(p => p.id === id);
}
