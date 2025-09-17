"use client";

import { ThreeElements, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, PerspectiveCamera, ShaderMaterial } from "three";

const smokeVertexShader = /* glsl */ `
  precision highp float;

  attribute float shift;

  uniform float time;
  uniform float riseSpeed;
  uniform float size;
  uniform float curlStrength;
  uniform float projectionScale;

  varying float vFade;

  void main() {
    float progress = fract(time * riseSpeed * 0.1 + shift);
    float height = progress * riseSpeed;
    vec3 displaced = position;
    displaced.y += height;
    displaced.x += sin((progress + shift) * 6.28318) * curlStrength * progress;
    displaced.z += cos((progress + shift) * 6.28318) * curlStrength * progress;

    vFade = 1.0 - progress;

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    #ifdef USE_SIZE_ATTENUATION
      gl_PointSize = size * (1.0 + progress * 0.5) * projectionScale / max(0.0001, gl_Position.w);
    #else
      gl_PointSize = size;
    #endif
  }
`;

const smokeFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 smokeColor;
  uniform float opacity;

  varying float vFade;

  void main() {
    vec2 coord = gl_PointCoord - 0.5;
    float dist = length(coord);
    float alpha = smoothstep(0.5, 0.0, dist) * vFade * opacity;

    if (alpha <= 0.001) {
      discard;
    }

    gl_FragColor = vec4(smokeColor, alpha);
  }
`;

export interface SmokePlumeProps extends Omit<ThreeElements["points"], "children"> {
  count?: number;
  spread?: number;
  height?: number;
  size?: number;
  riseSpeed?: number;
  curlStrength?: number;
  opacity?: number;
  color?: string;
}

export function SmokePlume({
  count = 120,
  spread = 0.8,
  height = 3.5,
  size = 40,
  riseSpeed = 2.4,
  curlStrength = 0.35,
  opacity = 0.45,
  color = "#9ea2a8",
  ...props
}: SmokePlumeProps) {
  const pointsRef = useRef<ThreeElements["points"]["ref"]>(null);
  const { camera, size: viewport } = useThree();

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const shifts = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * spread;
      const y = Math.random() * height * 0.1;

      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      shifts[i] = Math.random();
    }

    return { positions, shifts };
  }, [count, spread, height]);

  const material = useMemo(() => {
    const shader = new ShaderMaterial({
      vertexShader: `#define USE_SIZE_ATTENUATION\n${smokeVertexShader}`,
      fragmentShader: smokeFragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        time: { value: 0 },
        riseSpeed: { value: riseSpeed },
        size: { value: size },
        curlStrength: { value: curlStrength },
        projectionScale: { value: 1 },
        smokeColor: { value: new Color(color) },
        opacity: { value: opacity },
      },
    });
    return shader;
  }, [color, curlStrength, opacity, riseSpeed, size]);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    material.uniforms.opacity.value = opacity;
  }, [material, opacity]);

  useEffect(() => {
    material.uniforms.curlStrength.value = curlStrength;
  }, [material, curlStrength]);

  useEffect(() => {
    material.uniforms.riseSpeed.value = riseSpeed;
  }, [material, riseSpeed]);

  useEffect(() => {
    material.uniforms.size.value = size;
  }, [material, size]);

  useEffect(() => {
    (material.uniforms.smokeColor.value as Color).set(color);
  }, [material, color]);

  useEffect(() => {
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as PerspectiveCamera;
      const perspectiveScale =
        viewport.height /
        (2 * Math.tan((perspective.fov * Math.PI) / 360));
      material.uniforms.projectionScale.value = perspectiveScale;
    } else {
      material.uniforms.projectionScale.value = 1;
    }
  }, [camera, material, viewport.height]);

  useFrame((state) => {
    material.uniforms.time.value = state.clock.getElapsedTime();
  });

  return (
    <points ref={pointsRef} {...props}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="attributes-shift" args={[geometry.shifts, 1]} />
      </bufferGeometry>
      <primitive object={material} attach="material" />
    </points>
  );
}

