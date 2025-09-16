"use client";

import * as THREE from "three";
import { shaderMaterial } from "@react-three/drei";
import { extend } from "@react-three/fiber";

// Material uniforms and shaders largely based on the provided starter code
const GrassMaterial = shaderMaterial(
  {
    bladeHeight: 1,
    map: null,
    alphaMap: null,
    time: 0,
    // Wind uniforms (texture-driven wind instead of heavy simplex noise)
    windTex: null,
    windScale: 0.02,
    windSpeed: 0.2,
    // Tile origin in world XZ for correct interaction/wind sampling
    tileOrigin: new THREE.Vector2(0, 0),
    tipColor: new THREE.Color(0.0, 0.6, 0.0).convertSRGBToLinear(),
    bottomColor: new THREE.Color(0.0, 0.1, 0.0).convertSRGBToLinear(),
    // Interaction uniforms
    boundsMin: new THREE.Vector2(-30, -30),
    boundsSize: new THREE.Vector2(60, 60),
    interactTex: null,
    useInteract: 0,
    interactInvSize: new THREE.Vector2(1, 1),
    flattenStrength: 0.9,
  },
  /* glsl */ `
      precision mediump float;
      attribute vec3 offset;
      attribute vec4 orientation;
      attribute float halfRootAngleSin;
      attribute float halfRootAngleCos;
      attribute float stretch;
      uniform float time;
      uniform float bladeHeight;
      // Wind
      uniform sampler2D windTex;
      uniform float windScale;
      uniform float windSpeed;
      uniform vec2 tileOrigin;
      // Interaction uniforms
      uniform vec2 boundsMin;
      uniform vec2 boundsSize;
      uniform sampler2D interactTex;
      uniform float useInteract;
      uniform vec2 interactInvSize;
      uniform float flattenStrength;
      varying vec2 vUv;
      varying float frc;

      // Simple hash for dithering if needed
      float hash12(vec2 p) {
        vec3 p3  = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      // rotate vector by quaternion
      vec3 rotateVectorByQuaternion( vec3 v, vec4 q){
        return 2.0 * cross(q.xyz, v * q.w + cross(q.xyz, v)) + v;
      }

      // slerp between quaternions
      vec4 slerp(vec4 v0, vec4 v1, float t) {
        v0 = normalize(v0);
        v1 = normalize(v1);
        float dot_ = dot(v0, v1);
        if (dot_ < 0.0) { v1 = -v1; dot_ = -dot_; }
        const float DOT_THRESHOLD = 0.9995;
        if (dot_ > DOT_THRESHOLD) {
          vec4 result = t*(v1 - v0) + v0; return normalize(result);
        }
        float theta_0 = acos(dot_);
        float theta = theta_0*t;
        float sin_theta = sin(theta);
        float sin_theta_0 = sin(theta_0);
        float s0 = cos(theta) - dot_ * sin_theta / sin_theta_0;
        float s1 = sin_theta / sin_theta_0;
        return (s0 * v0) + (s1 * v1);
      }

      void main() {
        frc = position.y/float(bladeHeight);
        float tipWeight = smoothstep(0.0, 1.0, frc);
        // Sample tiled wind texture in world XZ using the blade root offset in world space
        vec2 worldXZ = offset.xz + tileOrigin;
        vec2 wuv = worldXZ * windScale + vec2(time * windSpeed, time * windSpeed * 0.73);
        float noise = texture2D(windTex, wuv).r;
        vec4 direction = vec4(0.0, halfRootAngleSin, 0.0, halfRootAngleCos);
        // Tip-weight the orientation slerp so the base remains more rigid
        direction = slerp(direction, orientation, tipWeight);
        vec3 vPosition = vec3(position.x, position.y + position.y * stretch, position.z);
        vPosition = rotateVectorByQuaternion(vPosition, direction);
        // Interaction-driven bending/flattening sampled in world XZ using the blade root offset
        if (useInteract > 0.5) {
          vec2 uvWorld = (worldXZ - boundsMin) / boundsSize;
          float c = texture2D(interactTex, uvWorld).r;
          // Sobel-lite gradient
          float cxp = texture2D(interactTex, uvWorld + vec2(interactInvSize.x, 0.0)).r;
          float cxm = texture2D(interactTex, uvWorld - vec2(interactInvSize.x, 0.0)).r;
          float cyp = texture2D(interactTex, uvWorld + vec2(0.0, interactInvSize.y)).r;
          float cym = texture2D(interactTex, uvWorld - vec2(0.0, interactInvSize.y)).r;
          vec2 grad = vec2(cxp - cxm, cyp - cym);
          vec2 bendDir = (length(grad) > 1e-5) ? normalize(grad) : vec2(0.0);
          float flatten = clamp(flattenStrength * c * frc, 0.0, 0.95);
          // push tips away from center and reduce height
          vPosition.xz += bendDir * (flatten * bladeHeight * 0.35);
          vPosition.y *= (1.0 - flatten);
        }

        // Wind sway is weighted to the tip as well, keeping the root anchored
        float halfAngle = noise * 0.15 * tipWeight;
        vPosition = rotateVectorByQuaternion(vPosition, normalize(vec4(sin(halfAngle), 0.0, -sin(halfAngle), cos(halfAngle))));
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(offset + vPosition, 1.0 );
      }
    `,
  /* glsl */ `
      precision mediump float;
      uniform sampler2D map;
      uniform sampler2D alphaMap;
      uniform vec3 tipColor;
      uniform vec3 bottomColor;
      varying vec2 vUv;
      varying float frc;

      void main() {
        float alpha = texture2D(alphaMap, vUv).r;
        if(alpha < 0.15) discard;
        vec4 col = vec4(texture2D(map, vUv));
        col = mix(vec4(tipColor, 1.0), col, frc);
        col = mix(vec4(bottomColor, 1.0), col, frc);
        gl_FragColor = col;

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  (self) => {
    if (!self) return;
    self.side = THREE.DoubleSide;
    // Use alpha testing cutout to reduce overdraw and keep depth writes
    self.transparent = false;
    self.depthWrite = true;
    self.alphaTest = 0.15;
  }
);

extend({ GrassMaterial });

export { GrassMaterial };

// TypeScript JSX support for <grassMaterial />
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      grassMaterial: Record<string, unknown>;
    }
  }
}
declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      grassMaterial: Record<string, unknown>;
    }
  }
}
declare module "react/jsx-dev-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      grassMaterial: Record<string, unknown>;
    }
  }
}


