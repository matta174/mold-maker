// Repro/debug probe for the Mr Coaster bug reports (2026-04-21).
//
// NOT a permanent regression test. Purpose: reproduce the visual
// breakage from the user's screenshots — Z=50% rect (sprue location
// might be off) and Y=58% rounded (whole layout looks wrong) — with
// numbers instead of pixels. Answers we want:
//   1. For Y=58% rounded — are the two halves actually different sizes,
//      or is that exploded-view rendering?
//   2. Where does the sprue cylinder actually land in world coords, and
//      is that coord inside the top mold's cavity region?
//   3. Does the bottom mold contain features it shouldn't (e.g. stranded
//      sprue geometry)?
//
// Delete this file when the bugs are fixed and real regression tests
// have been added.
//
// Run: npx vitest run src/renderer/mold/repro_coasterBug.test.ts

import { describe, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { generateMold } from './generateMold';
import { computeChannelPositions } from './channelPlacement';
import { computeMoldEnvelope } from './moldBox';

const STL_PATH = '/sessions/zen-quirky-ramanujan/mnt/uploads/Mr Coaster 2(1).stl';

function loadCoaster(): { geometry: THREE.BufferGeometry; bbox: THREE.Box3 } {
  const buf = fs.readFileSync(STL_PATH);
  // STLLoader wants a specific ArrayBuffer view; give it one backed by the
  // Node buffer's underlying memory.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const geometry = new STLLoader().parse(ab as ArrayBuffer);
  geometry.computeBoundingBox();
  return { geometry, bbox: geometry.boundingBox! };
}

function bboxDump(label: string, geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const s = new THREE.Vector3();
  b.getSize(s);
  const triCount = geo.index
    ? geo.index.count / 3
    : geo.attributes.position.count / 3;
  console.log(
    `${label}: bbox min=[${b.min.x.toFixed(1)}, ${b.min.y.toFixed(1)}, ${b.min.z.toFixed(1)}] ` +
      `max=[${b.max.x.toFixed(1)}, ${b.max.y.toFixed(1)}, ${b.max.z.toFixed(1)}] ` +
      `size=[${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)}] ` +
      `tris=${triCount}`,
  );
}

describe('Mr Coaster bug repro', () => {
  it('Z=50% rect — sprue position vs cavity', async () => {
    const { geometry, bbox } = loadCoaster();
    bboxDump('INPUT MESH', geometry);

    const envelope = computeMoldEnvelope(bbox, 'rect', 'z', 0); // wall computed by caller normally
    // channelPlacement uses bbox directly, not the envelope — reproduce its
    // sprue math the same way generateMold does:
    const sz = new THREE.Vector3();
    bbox.getSize(sz);
    const splitPos = bbox.min.z + sz.z * 0.5;
    const moldMin = envelope.moldMin;
    const moldSize = envelope.moldSize;
    const channels = computeChannelPositions(
      bbox,
      'z',
      splitPos,
      moldMin,
      moldSize,
      geometry,
      0,
    );
    console.log(
      `Z=50 sprue: pos=[${channels.spruePos.map((v) => v.toFixed(2)).join(', ')}] ` +
        `height=${channels.sprueHeight.toFixed(2)} rotation=[${channels.rotation.join(',')}] ` +
        `vents=${channels.ventPositions.length}`,
    );

    const { top, bottom } = await generateMold(geometry, bbox, 'z', 0.5, {
      moldBoxShape: 'rect',
    });
    bboxDump('TOP (z=0.5, rect)', top);
    bboxDump('BOT (z=0.5, rect)', bottom);
  }, 60_000);

  it('Y=58% rounded — layout sanity', async () => {
    const { geometry, bbox } = loadCoaster();
    bboxDump('INPUT MESH', geometry);

    const sz = new THREE.Vector3();
    bbox.getSize(sz);
    const splitPos = bbox.min.y + sz.y * 0.58;
    console.log(
      `splitPos (y, 58%) = ${splitPos.toFixed(2)} ` +
        `(bbox y range = [${bbox.min.y.toFixed(2)}, ${bbox.max.y.toFixed(2)}])`,
    );

    const envelope = computeMoldEnvelope(bbox, 'roundedRect', 'y', 0);
    console.log(
      `envelope(roundedRect, y): ` +
        `moldMin=[${envelope.moldMin.x.toFixed(2)}, ${envelope.moldMin.y.toFixed(2)}, ${envelope.moldMin.z.toFixed(2)}] ` +
        `moldSize=[${envelope.moldSize.x.toFixed(2)}, ${envelope.moldSize.y.toFixed(2)}, ${envelope.moldSize.z.toFixed(2)}] ` +
        `shape=${envelope.shape}`,
    );

    const channels = computeChannelPositions(
      bbox,
      'y',
      splitPos,
      envelope.moldMin,
      envelope.moldSize,
      geometry,
      0,
    );
    console.log(
      `Y=58 sprue: pos=[${channels.spruePos.map((v) => v.toFixed(2)).join(', ')}] ` +
        `height=${channels.sprueHeight.toFixed(2)} rotation=[${channels.rotation.join(',')}] ` +
        `vents=${channels.ventPositions.length}`,
    );
    for (const v of channels.ventPositions) {
      console.log(`  vent: [${v.map((x) => x.toFixed(2)).join(', ')}]`);
    }

    const { top, bottom } = await generateMold(geometry, bbox, 'y', 0.58, {
      moldBoxShape: 'roundedRect',
    });
    bboxDump('TOP (y=0.58, roundedRect)', top);
    bboxDump('BOT (y=0.58, roundedRect)', bottom);

    // Critical question: lateral extents (X, Z) should be IDENTICAL between
    // top and bottom. If not, that's the bug in screenshot #2.
    top.computeBoundingBox();
    bottom.computeBoundingBox();
    const tb = top.boundingBox!;
    const bb = bottom.boundingBox!;
    const latMismatch =
      Math.abs(tb.min.x - bb.min.x) + Math.abs(tb.max.x - bb.max.x) +
      Math.abs(tb.min.z - bb.min.z) + Math.abs(tb.max.z - bb.max.z);
    console.log(
      `LATERAL MISMATCH (X+Z): ${latMismatch.toFixed(3)}  ` +
        `(should be ~0 — both halves cut from same envelope)`,
    );

    // Y extents: top should START at splitPos (minus clearance), bottom should END at splitPos.
    console.log(
      `Y seam: top.min.y=${tb.min.y.toFixed(2)} bot.max.y=${bb.max.y.toFixed(2)} splitPos=${splitPos.toFixed(2)}`,
    );
  }, 90_000);
});
