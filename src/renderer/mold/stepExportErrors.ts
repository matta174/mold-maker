// ─────────────────────────────────────────────────────────────────────────────
// User-facing translation layer for STEP-export errors.
// ─────────────────────────────────────────────────────────────────────────────
//
// Why this module exists: exportSTEP throws with messages that are great for
// a developer reading a stack trace ("sewing produced a null shape — mesh
// topology likely bad") and terrible for a user who just clicked a button and
// got a red banner ("what's sewing? what do I do now?"). This module maps the
// technical error surfaced from the worker to a short, actionable user-facing
// string. It does NOT throw away the original message — handleExport logs the
// raw error to the console so a user pasting a bug report still gives us a
// grep-able signal.
//
// Design choices:
//   • String matching, not error subclasses. The worker boundary destroys
//     class identity (errors serialize through postMessage as plain messages),
//     so there's nothing to narrow by `instanceof`. A lookup table by regex
//     is the simplest equivalent and keeps the mapping readable.
//   • Fallthrough = pass-through. If we don't recognise the message, we
//     return it verbatim. Better to show a slightly technical error than
//     to hide it behind a generic "something went wrong" that offers no
//     signal for the user OR for us when they screenshot it.
//   • No i18n layer. App is English-only for launch; when i18n lands, this
//     file is the single place to plug the translator in.
//
// Update this module when you add a new throw-site in exportSTEP or its
// dependencies (OCP loader, sewing, STEP writer) — the test file pins the
// current catalog, so a new message will fail a test until you either add a
// mapping or explicitly accept the pass-through behaviour.

/**
 * Rule-set mapping a technical message fragment (regex) to a friendlier
 * user-facing string. Order matters: the FIRST match wins, so put the most
 * specific patterns first (e.g. match "has 50000 triangles (max 100000)"
 * before the broader "triangles" catch-all).
 */
interface Rule {
  /** Regex tested against the raw error message. */
  match: RegExp;
  /**
   * Either a literal string or a function that derives the friendly message
   * from the regex match groups (useful for echoing triangle counts etc.).
   */
  translate: string | ((m: RegExpMatchArray) => string);
}

const RULES: Rule[] = [
  // ── Pre-flight rejections (fast failures, before WASM work) ─────────────
  {
    match: /mesh has no triangles/i,
    translate:
      "STEP export needs a generated mold. Click 'Generate Mold' first, then try STEP export.",
  },
  {
    match: /mesh has (\d+) triangles \(max (\d+)\)/i,
    translate: (m) =>
      `Mold is too detailed for STEP export (${m[1]} triangles, limit ${m[2]}). ` +
      `Try a simpler input mesh, or export as STL/3MF instead — those formats have no triangle limit.`,
  },
  {
    match: /no position attribute/i,
    translate:
      'The generated mold is missing geometry data. Re-generate the mold and try again.',
  },

  // ── OCP / WASM loader failures ──────────────────────────────────────────
  {
    match: /Failed to load OCP WASM \((\d+) ([^)]+)\)/,
    translate: (m) =>
      `Couldn't download the STEP export engine (${m[1]} ${m[2]}). ` +
      `Check your internet connection and try again. The engine is ~66 MB and only downloads on first use.`,
  },
  {
    match: /out of memory|RangeError.*buffer|OOM/i,
    translate:
      "Ran out of memory building the STEP file. Try exporting as STL or 3MF, " +
      "or reduce the input mesh's triangle count before generating.",
  },

  // ── BRep / sewing / writer failures ─────────────────────────────────────
  {
    match: /failed to build face for triangle/i,
    translate:
      "The mold has a malformed triangle that STEP can't represent. This usually means the input mesh is non-manifold. " +
      "Try repairing the input in Blender/Meshmixer, or export as STL — STL doesn't require clean topology.",
  },
  {
    match: /sewing produced a null shape|mesh topology likely bad/i,
    translate:
      "STEP export couldn't stitch the mold's triangles into a clean surface. " +
      "This usually means the mesh has gaps or overlapping faces. Try STL instead, or repair the mesh in Blender/Meshmixer.",
  },

  // ── Worker-level crashes ────────────────────────────────────────────────
  {
    match: /STEP export worker crashed|worker crashed/i,
    translate:
      "The STEP export engine crashed unexpectedly. Try again, or export as STL/3MF if the crash repeats. " +
      "If it keeps happening, the mesh is likely the cause — please report this as a bug.",
  },

  // ── User-initiated ──────────────────────────────────────────────────────
  // Cancellation is handled upstream (handleExport suppresses it before
  // reaching us) but including it here makes the table complete if another
  // caller ever passes the raw error through.
  {
    match: /^Export cancelled$/,
    translate: 'STEP export cancelled.',
  },
];

/**
 * Translate a technical STEP-export error message to a user-facing one.
 *
 * Unrecognised messages pass through unchanged — see module header for why.
 * The caller is responsible for still logging the raw error to the console
 * for debugging; this function only shapes what the UI shows.
 */
export function translateStepError(raw: string): string {
  for (const { match, translate } of RULES) {
    const m = raw.match(match);
    if (m) {
      return typeof translate === 'string' ? translate : translate(m);
    }
  }
  return raw;
}
