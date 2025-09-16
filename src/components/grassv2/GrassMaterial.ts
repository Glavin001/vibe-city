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
      // Interaction uniforms
      uniform vec2 boundsMin;
      uniform vec2 boundsSize;
      uniform sampler2D interactTex;
      uniform float useInteract;
      uniform vec2 interactInvSize;
      uniform float flattenStrength;
      varying vec2 vUv;
      varying float frc;

      //WEBGL-NOISE FROM https://github.com/stegu/webgl-noise
      vec3 mod289(vec3 x) {return x - floor(x * (1.0 / 289.0)) * 289.0;}
      vec2 mod289(vec2 x) {return x - floor(x * (1.0 / 289.0)) * 289.0;}
      vec3 permute(vec3 x) {return mod289(((x*34.0)+1.0)*x);} 
      float snoise(vec2 v){
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
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
        float noise = 1.0-(snoise(vec2((time-offset.x/50.0), (time-offset.z/50.0))));
        vec4 direction = vec4(0.0, halfRootAngleSin, 0.0, halfRootAngleCos);
        // Tip-weight the orientation slerp so the base remains more rigid
        direction = slerp(direction, orientation, tipWeight);
        vec3 vPosition = vec3(position.x, position.y + position.y * stretch, position.z);
        vPosition = rotateVectorByQuaternion(vPosition, direction);
        // Interaction-driven bending/flattening sampled in world XZ using the blade root offset
        if (useInteract > 0.5) {
          vec2 uvWorld = (offset.xz - boundsMin) / boundsSize;
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
    self.transparent = true;
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


