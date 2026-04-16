import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  getRegistrationPinPositions,
  getRotationForAxis,
  computeChannelPositions,
} from './channelPlacement';

function bbox(min: [number, number, number], max: [number, number, number]): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(...min),
    new THREE.Vector3(...max),
  );
}

describe('getRegistrationPinPositions', () => {
  it('places exactly 4 pins on Z-axis at split plane', () => {
    const b = bbox([-10, -10, -10], [10, 10, 10]);
    const pins = getRegistrationPinPositions(b, 'z', 0, 1);
    expect(pins).toHaveLength(4);
    // All pins sit exactly on the split plane (z = 0)
    for (const p of pins) expect(p[2]).toBe(0);
  });

  it('Y-axis pins sit on the Y split plane', () => {
    const b = bbox([0, 0, 0], [10, 10, 10]);
    const pins = getRegistrationPinPositions(b, 'y', 5, 2);
    expect(pins).toHaveLength(4);
    for (const p of pins) expect(p[1]).toBe(5);
  });

  it('inset pushes pins OUTSIDE the bbox corners (so pin bodies clear the part)', () => {
    const b = bbox([0, 0, 0], [10, 10, 10]);
    const pins = getRegistrationPinPositions(b, 'z', 5, 10); // wall=10 → inset=7
    // First pin is min.x - inset, min.y - inset → should be negative
    expect(pins[0][0]).toBeLessThan(0);
    expect(pins[0][1]).toBeLessThan(0);
    // Fourth pin is max corner + inset → should exceed max
    expect(pins[3][0]).toBeGreaterThan(10);
    expect(pins[3][1]).toBeGreaterThan(10);
  });
});

describe('getRotationForAxis', () => {
  it('returns rotations in DEGREES (not radians) for manifold-3d', () => {
    // 90° rotations; radians would be ~1.57
    expect(getRotationForAxis('x')).toEqual([0, 90, 0]);
    expect(getRotationForAxis('y')).toEqual([90, 0, 0]);
    expect(getRotationForAxis('z')).toEqual([0, 0, 0]);
  });
});

describe('computeChannelPositions', () => {
  it('places sprue on the split plane and returns at least MIN_VENTS vents', () => {
    // A 10x10x10 box of vertices around origin
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    for (let x = -5; x <= 5; x += 5) {
      for (let y = -5; y <= 5; y += 5) {
        for (let z = -5; z <= 5; z += 5) {
          verts.push(x, y, z);
        }
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));

    const b = bbox([-5, -5, -5], [5, 5, 5]);
    const moldMin = new THREE.Vector3(-10, -10, -10);
    const moldSize = new THREE.Vector3(20, 20, 20);
    const splitPos = 0;

    const result = computeChannelPositions(b, 'z', splitPos, moldMin, moldSize, geo);

    // Sprue Z matches split plane
    expect(result.spruePos[2]).toBe(splitPos);
    // Sprue height = distance from split to mold top face
    expect(result.sprueHeight).toBe(10);
    // At least MIN_VENTS (=2) vents
    expect(result.ventPositions.length).toBeGreaterThanOrEqual(2);
    // Each vent sits on the split plane
    for (const v of result.ventPositions) {
      expect(v[2]).toBe(splitPos);
    }
    // Rotation in degrees (z-axis → [0,0,0])
    expect(result.rotation).toEqual([0, 0, 0]);
  });

  it('returns Y-axis rotation in DEGREES for Y split', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 1, 0, 1, 1, 0, 0, 1, 1, // all above y=0
    ]), 3));

    const b = bbox([0, 0, 0], [1, 2, 1]);
    const result = computeChannelPositions(
      b, 'y', 1, new THREE.Vector3(-1, -1, -1), new THREE.Vector3(3, 4, 3), geo,
    );
    expect(result.rotation).toEqual([90, 0, 0]);
  });
});
