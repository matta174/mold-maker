import * as THREE from 'three';

/**
 * A bundled sample model so first-time users have something to load without
 * needing to go find their own STL. Generated procedurally (no binary asset
 * in the repo, no licensing concerns, no WASM dependencies) via LatheGeometry
 * — a classic mushroom profile that's deliberately chosen to demonstrate
 * every heatmap classification in one shape:
 *
 *   - Flat bottom (pull axis Y, below plane) → GREEN  (positive draft)
 *   - Stem vertical wall                      → RED    (zero draft)
 *   - Cap UNDERSIDE flaring outward           → RED    (undercut — the
 *                                                        educational bit)
 *   - Cap vertical outer wall                 → RED    (zero draft)
 *   - Cap upper slope                         → YELLOW (marginal draft)
 *   - Cap top tip                             → GREEN  (positive draft)
 *
 * The undercut under the cap is the point — molding this shape as a
 * simple Y-axis two-part mold will fail, and the heatmap shows the user
 * *why* before they run the CSG. If they pick X or Z axis they get a
 * different (worse) picture. It's a teaching model disguised as a
 * mushroom.
 */
export function createSampleModel(): { geometry: THREE.BufferGeometry; fileName: string } {
  // LatheGeometry rotates this 2D profile around the Y axis. Profile is
  // authored bottom-up: each vertex is (radius, height).
  //
  // Normal convention: LatheGeometry generates outward-facing normals. A
  // profile segment going OUTWARD at constant y (increasing radius) produces
  // a downward-facing ring; INWARD at constant y produces an upward-facing
  // ring. That's how we get the undercut.
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),      // center of base
    new THREE.Vector2(5, 0),      // base edge — flat bottom ring
    new THREE.Vector2(5, 10),     // up the stem (vertical wall)
    new THREE.Vector2(12, 10),    // out to cap underside — THIS is the undercut
    new THREE.Vector2(12, 15),    // up the cap outer wall (vertical)
    new THREE.Vector2(10, 17),    // cap shoulder (slight inward+up slope)
    new THREE.Vector2(6, 19),     // cap upper slope
    new THREE.Vector2(0, 20),     // top center point
  ];

  // 48 segments gives a smooth enough revolution that the cap curvature
  // reads as a curve, not a polygon. Manifold's STL-to-Manifold bridge
  // will merge coincident vertices anyway, so the extra faces cost nothing
  // downstream.
  const geometry = new THREE.LatheGeometry(profile, 48);

  // Match the post-load pipeline the real fileLoader path produces:
  // centered around origin, with bounding box + vertex normals computed.
  // App.tsx then re-centers and re-computes, but doing it here too keeps
  // the sample equivalent to a freshly-loaded STL in any unit test or
  // sanity check that skips the App layer.
  geometry.center();
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();

  return { geometry, fileName: 'sample-mushroom.stl' };
}
