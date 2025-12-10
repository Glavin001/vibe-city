/**
 * TSL Noise Utilities for Tornado Simulation
 * 
 * Implements simplex noise and curl noise for realistic turbulence effects.
 * All functions are designed to work with Three.js TSL (Three Shading Language).
 */

import * as TSL from "three/tsl";

// Type aliases for TSL nodes
type Vec3Node = ReturnType<typeof TSL.vec3>;
type Vec4Node = ReturnType<typeof TSL.vec4>;
type FloatNode = ReturnType<typeof TSL.float>;

/**
 * Permutation function for noise - helps create pseudo-random patterns
 */
export const permute = TSL.Fn(([x]: [Vec4Node]) => {
  return x.mul(34.0).add(1.0).mul(x).mod(289.0);
});

/**
 * Taylor inverse square root approximation
 */
export const taylorInvSqrt = TSL.Fn(([r]: [Vec4Node]) => {
  return TSL.float(1.79284291400159).sub(TSL.float(0.85373472095314).mul(r));
});

/**
 * 3D Simplex Noise
 * Returns a value in range [-1, 1]
 */
export const simplex3D = TSL.Fn(([v]: [Vec3Node]) => {
  const C = TSL.vec2(1.0 / 6.0, 1.0 / 3.0);
  const D = TSL.vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  const vDotCyyy = v.x.add(v.y).add(v.z).mul(C.y);
  const i = TSL.floor(v.add(vDotCyyy));
  const iDotCxxx = i.x.add(i.y).add(i.z).mul(C.x);
  const x0 = v.sub(i).add(iDotCxxx);

  // Other corners
  const g = TSL.step(x0.yzx, x0.xyz);
  const l = TSL.vec3(1.0).sub(g);
  const i1 = TSL.min(g.xyz, l.zxy);
  const i2 = TSL.max(g.xyz, l.zxy);

  const x1 = x0.sub(i1).add(C.x);
  const x2 = x0.sub(i2).add(C.y);
  const x3 = x0.sub(D.yyy);

  // Permutations
  const iMod = i.mod(289.0);
  const p = permute(
    permute(
      permute(
        iMod.z.add(TSL.vec4(0.0, i1.z, i2.z, 1.0))
      ).add(iMod.y).add(TSL.vec4(0.0, i1.y, i2.y, 1.0))
    ).add(iMod.x).add(TSL.vec4(0.0, i1.x, i2.x, 1.0))
  );

  // Gradients
  const n_ = 0.142857142857; // 1/7
  const ns = TSL.vec3(n_, n_, n_).mul(D.wyz).sub(D.xzx);

  const j = p.sub(TSL.floor(p.mul(ns.z).mul(ns.z)).mul(49.0));
  const x_ = TSL.floor(j.mul(ns.z));
  const y_ = TSL.floor(j.sub(x_.mul(7.0)));

  const x = x_.mul(ns.x).add(ns.y);
  const y = y_.mul(ns.x).add(ns.y);
  const h = TSL.vec4(1.0).sub(TSL.abs(x)).sub(TSL.abs(y));

  const b0 = TSL.vec4(x.x, x.y, y.x, y.y);
  const b1 = TSL.vec4(x.z, x.w, y.z, y.w);

  const s0 = TSL.floor(b0).mul(2.0).add(1.0);
  const s1 = TSL.floor(b1).mul(2.0).add(1.0);
  const sh = TSL.step(h, TSL.vec4(0.0)).mul(-1.0);

  const a0 = b0.xzyw.add(s0.xzyw.mul(TSL.vec4(sh.x, sh.x, sh.y, sh.y)));
  const a1 = b1.xzyw.add(s1.xzyw.mul(TSL.vec4(sh.z, sh.z, sh.w, sh.w)));

  const p0 = TSL.vec3(a0.x, a0.y, h.x);
  const p1 = TSL.vec3(a0.z, a0.w, h.y);
  const p2 = TSL.vec3(a1.x, a1.y, h.z);
  const p3 = TSL.vec3(a1.z, a1.w, h.w);

  // Normalize gradients
  const norm = taylorInvSqrt(
    TSL.vec4(TSL.dot(p0, p0), TSL.dot(p1, p1), TSL.dot(p2, p2), TSL.dot(p3, p3))
  );
  const p0n = p0.mul(norm.x);
  const p1n = p1.mul(norm.y);
  const p2n = p2.mul(norm.z);
  const p3n = p3.mul(norm.w);

  // Mix contributions from corners
  const m = TSL.max(
    TSL.vec4(0.6).sub(TSL.vec4(
      TSL.dot(x0, x0),
      TSL.dot(x1, x1),
      TSL.dot(x2, x2),
      TSL.dot(x3, x3)
    )),
    TSL.vec4(0.0)
  );
  const m2 = m.mul(m);
  const m4 = m2.mul(m2);

  return TSL.float(42.0).mul(
    TSL.dot(m4, TSL.vec4(
      TSL.dot(p0n, x0),
      TSL.dot(p1n, x1),
      TSL.dot(p2n, x2),
      TSL.dot(p3n, x3)
    ))
  );
});

/**
 * Fractional Brownian Motion (FBM) using simplex noise
 * Creates more natural-looking turbulence with multiple octaves
 */
export const fbm3D = TSL.Fn(([p, _octaves, lacunarity, gain]: [Vec3Node, FloatNode, FloatNode, FloatNode]) => {
  let value = TSL.float(0.0);
  let amplitude = TSL.float(1.0);
  let frequency = TSL.float(1.0);
  const pos = p;

  // Unrolled loop for 4 octaves (TSL doesn't support dynamic loops well)
  // Octave 1
  value = value.add(amplitude.mul(simplex3D(pos.mul(frequency))));
  amplitude = amplitude.mul(gain);
  frequency = frequency.mul(lacunarity);

  // Octave 2
  value = value.add(amplitude.mul(simplex3D(pos.mul(frequency))));
  amplitude = amplitude.mul(gain);
  frequency = frequency.mul(lacunarity);

  // Octave 3
  value = value.add(amplitude.mul(simplex3D(pos.mul(frequency))));
  amplitude = amplitude.mul(gain);
  frequency = frequency.mul(lacunarity);

  // Octave 4
  value = value.add(amplitude.mul(simplex3D(pos.mul(frequency))));

  return value;
});

/**
 * 3D Curl Noise
 * Creates divergence-free noise field - perfect for fluid/tornado simulation
 * Returns a vec3 representing the curl of the noise field
 */
export const curlNoise3D = TSL.Fn(([p, time, scale]: [Vec3Node, FloatNode, FloatNode]) => {
  const eps = TSL.float(0.0001);
  const scaledP = p.mul(scale);
  
  // Offset positions for different noise channels
  const offset1 = TSL.vec3(12.3, 4.56, 7.89);
  const offset2 = TSL.vec3(45.6, 78.9, 12.3);
  
  // Sample noise at offset positions
  const p1 = scaledP.add(offset1).add(TSL.vec3(time.mul(0.1), 0.0, 0.0));
  const p2 = scaledP.add(offset2).add(TSL.vec3(0.0, time.mul(0.1), 0.0));
  const p3 = scaledP.add(TSL.vec3(0.0, 0.0, time.mul(0.1)));

  // Compute partial derivatives using central differences
  const n1 = simplex3D(p1);
  const n2 = simplex3D(p2);
  const n3 = simplex3D(p3);

  const n1_dy = simplex3D(p1.add(TSL.vec3(0.0, eps, 0.0)));
  const n1_dz = simplex3D(p1.add(TSL.vec3(0.0, 0.0, eps)));

  const n2_dx = simplex3D(p2.add(TSL.vec3(eps, 0.0, 0.0)));
  const n2_dz = simplex3D(p2.add(TSL.vec3(0.0, 0.0, eps)));

  const n3_dx = simplex3D(p3.add(TSL.vec3(eps, 0.0, 0.0)));
  const n3_dy = simplex3D(p3.add(TSL.vec3(0.0, eps, 0.0)));

  // Curl = (dFz/dy - dFy/dz, dFx/dz - dFz/dx, dFy/dx - dFx/dy)
  const curlX = n3_dy.sub(n3).div(eps).sub(n2_dz.sub(n2).div(eps));
  const curlY = n1_dz.sub(n1).div(eps).sub(n3_dx.sub(n3).div(eps));
  const curlZ = n2_dx.sub(n2).div(eps).sub(n1_dy.sub(n1).div(eps));

  return TSL.vec3(curlX, curlY, curlZ);
});

/**
 * Simplified curl noise for better performance
 * Uses pre-computed offsets instead of finite differences
 */
export const curlNoiseSimple = TSL.Fn(([p, time]: [Vec3Node, FloatNode]) => {
  // Sample noise at three offset positions
  const n1 = simplex3D(p.add(TSL.vec3(0.0, 0.0, 0.0)).add(TSL.vec3(time.mul(0.05))));
  const n2 = simplex3D(p.add(TSL.vec3(12.3, 4.5, 6.7)).add(TSL.vec3(time.mul(0.07))));
  const n3 = simplex3D(p.add(TSL.vec3(50.1, 20.2, 90.3)).add(TSL.vec3(time.mul(0.03))));
  
  // Create curl-like field
  return TSL.vec3(n2.sub(n3), n3.sub(n1), n1.sub(n2));
});

/**
 * Worley/Cellular noise for cloud-like patterns
 * Returns distance to nearest feature point
 */
export const worleyNoise = TSL.Fn(([p]: [Vec3Node]) => {
  const pi = TSL.floor(p);
  const pf = TSL.fract(p);
  
  let minDist = TSL.float(1.0);
  
  // Check neighboring cells (simplified 3x3x3 grid)
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const neighbor = TSL.vec3(x, y, z);
        const cellPos = pi.add(neighbor);
        
        // Hash the cell position to get feature point
        const hash = TSL.fract(
          TSL.sin(
            TSL.dot(cellPos, TSL.vec3(127.1, 311.7, 74.7))
          ).mul(43758.5453)
        );
        
        const featurePoint = neighbor.add(hash);
        const diff = featurePoint.sub(pf);
        const dist = TSL.length(diff);
        
        minDist = TSL.min(minDist, dist);
      }
    }
  }
  
  return minDist;
});

/**
 * Domain warping - distorts coordinates for more organic patterns
 */
export const domainWarp = TSL.Fn(([p, time, strength]: [Vec3Node, FloatNode, FloatNode]) => {
  const warp = curlNoiseSimple(p.mul(0.5), time);
  return p.add(warp.mul(strength));
});
