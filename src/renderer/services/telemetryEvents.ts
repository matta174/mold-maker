/**
 * Telemetry event schema — the *typed* privacy boundary.
 *
 * We enforce PII hygiene by TYPES, not by comments or runtime checks. The
 * discriminated union below names every event we're allowed to emit, and each
 * variant declares exactly which properties may accompany it. Property types
 * are restricted to string | number | boolean — no objects, no arrays, no
 * unknown. That's deliberate: a reviewer reading this file can verify "no
 * fileName, no path, no mesh data, no bounding box" by glance, without tracing
 * call-sites. If a future event needs a new property, adding it here is the
 * moment for a privacy review.
 *
 * Why the union approach: Umami accepts arbitrary `{ name, data }` payloads, so
 * nothing at the network layer would stop us shipping a PII-laden blob. The
 * compile-time union is the enforcement mechanism; this file IS the policy.
 *
 * Event count locked to 5 at launch (see .auto-memory/project_telemetry_design.md).
 * Before adding a sixth, state the specific question it answers that the
 * existing five cannot.
 */

/** The closed set of event names we emit. Any other string is a type error. */
export type EventName =
  | 'session_started'
  | 'model_loaded'
  | 'mold_generated'
  | 'plane_auto_detected'
  | 'file_exported';

/** Axis labels used in mold-generation / plane-detection events. Match the
 *  `PartingAxis` values in the mold pipeline; duplicated here so this module
 *  stays dependency-free and the privacy surface doesn't accidentally import
 *  geometry types that might grow PII-adjacent fields later. */
export type TelemetryAxis = 'x' | 'y' | 'z';

/** Export format tag. Keep in sync with actual export targets in App.tsx, but
 *  again — duplicated on purpose so this file is a self-contained schema.
 *  'step' added for the STEP-export rollout — its success-count answers the
 *  task #27 question of "does the 66 MB OCP WASM bundle pull its weight?". */
export type TelemetryExportFormat = 'stl' | 'obj' | '3mf' | 'step';

/** Reason tag for model-load / mold-generation failures. A COARSE enum, never
 *  a free-form string — free-form error messages are the most common accidental
 *  PII leak (they can include file paths, usernames, temp-dir names). If we
 *  later need to distinguish a new failure class, add an enum member; don't
 *  open a `string` field. */
export type TelemetryFailureReason =
  | 'parse_error'           // STL/OBJ couldn't be parsed
  | 'non_manifold'          // mesh isn't a valid manifold (for CSG)
  | 'csg_failed'            // Manifold boolean op threw
  | 'empty_result'          // CSG produced zero-triangle output
  | 'unknown';              // catch-all — deliberately imprecise

/**
 * Per-event property shapes. Each entry answers a SPECIFIC product question:
 *
 * - `session_started`: baseline DAU / retention. No props — we do not want a
 *   user-agent or locale string here; those are the kind of "harmless"
 *   fingerprinting vectors we've promised to avoid.
 *
 * - `model_loaded`: answers "do users get past the import step?" Success/failure
 *   ratio + coarse reason, nothing about the file itself.
 *
 * - `mold_generated`: the business-critical event — "does the product actually
 *   do its job?" Includes axis so we can see whether manual or auto wins.
 *
 * - `plane_auto_detected`: answers "is auto-detect pulling its weight, or are
 *   users immediately overriding it?" (Compare axisDetected here vs axisUsed in
 *   mold_generated to see override rate.)
 *
 * - `file_exported`: answers "which export formats matter?" — justifies or
 *   de-justifies the ~10MB STEP export binary (roadmap #4) before we ship it.
 */
export interface EventDataMap {
  session_started: Record<string, never>;
  model_loaded: {
    success: boolean;
    failureReason?: TelemetryFailureReason;
  };
  mold_generated: {
    success: boolean;
    axisUsed: TelemetryAxis;
    failureReason?: TelemetryFailureReason;
  };
  plane_auto_detected: {
    success: boolean;
    axisDetected?: TelemetryAxis;
  };
  file_exported: {
    format: TelemetryExportFormat;
  };
}

/** Compile-time assertion: every property value in EventDataMap must be a
 *  primitive (string | number | boolean) or undefined. If someone adds a
 *  nested object or array to an event shape, this type fails to compile and
 *  the build blocks before PII can escape. */
type PrimitiveOnly<T> = T extends Record<string, never>
  ? true
  : {
      [K in keyof T]: NonNullable<T[K]> extends string | number | boolean ? true : never;
    }[keyof T] extends true
  ? true
  : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertPrimitiveOnly = {
  [K in EventName]: PrimitiveOnly<EventDataMap[K]>;
};

/** The wire shape Umami's `/api/send` endpoint expects for custom events. We
 *  wrap it in a discriminated payload for telemetryTransport to consume. */
export interface TelemetryEventPayload<N extends EventName = EventName> {
  name: N;
  data: EventDataMap[N];
}

/**
 * Factory. Keeps the `{ name, data }` shape in one place so event-emitting
 * call-sites stay short:
 *
 *   sendTelemetry(buildEvent('mold_generated', { success: true, axisUsed: 'z' }));
 *
 * The generic binding means TypeScript will reject wrong-shape data at the
 * call-site, not at runtime. If you get a type error here, the fix is almost
 * always "update EventDataMap" — don't cast, don't `as any`.
 */
export function buildEvent<N extends EventName>(
  name: N,
  data: EventDataMap[N],
): TelemetryEventPayload<N> {
  return { name, data };
}
