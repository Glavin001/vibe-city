"use client";

import { ThreeElements, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, Matrix4, Mesh, ShaderMaterial, Vector3, Vector4 } from "three";

import { createFireMaterial, FireShape } from "./volumetricFireMaterial";

const worldMatrix = new Matrix4();
const worldScale = new Vector3();

export interface VolumetricFireProps
  extends Omit<ThreeElements["mesh"], "scale"> {
  size?: [number, number, number];
  shape?: FireShape;
  shapeParams?: [number, number, number, number?];
  color?: string;
  noiseScale?: [number, number, number, number];
  magnitude?: number;
  lacunarity?: number;
  gain?: number;
  intensity?: number;
}

const shapeToIndex: Record<FireShape, number> = {
  box: 0,
  sphere: 1,
  plane: 2,
  torus: 3,
  cylinder: 4,
};

export function VolumetricFire({
  size = [1, 1, 1],
  shape = "box",
  shapeParams = [1, 1, 0.4, 0],
  color = "#ffffff",
  noiseScale = [1, 2, 1, 0.35],
  magnitude = 1.35,
  lacunarity = 2.0,
  gain = 0.5,
  intensity = 1.5,
  ...props
}: VolumetricFireProps) {
  const meshRef = useRef<Mesh | null>(null);
  const material = useMemo(() => createFireMaterial(), []);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    (material.uniforms.baseColor.value as Color).set(color as string);
  }, [material, color]);

  useEffect(() => {
    const [x, y, z, w = 0] = shapeParams;
    const uniform = material.uniforms.shapeParams.value as Vector4;
    uniform.set(x, y, z, w);
  }, [material, shapeParams]);

  useEffect(() => {
    const [x, y, z, w] = noiseScale;
    const uniform = material.uniforms.noiseScale.value as Vector4;
    uniform.set(x, y, z, w);
  }, [material, noiseScale]);

  useEffect(() => {
    material.uniforms.magnitude.value = magnitude;
  }, [material, magnitude]);

  useEffect(() => {
    material.uniforms.lacunarity.value = lacunarity;
  }, [material, lacunarity]);

  useEffect(() => {
    material.uniforms.gain.value = gain;
  }, [material, gain]);

  useEffect(() => {
    material.uniforms.intensity.value = intensity;
  }, [material, intensity]);

  useEffect(() => {
    material.uniforms.shapeType.value = shapeToIndex[shape];
  }, [material, shape]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    mesh.updateMatrixWorld();
    worldMatrix.copy(mesh.matrixWorld).invert();
    worldScale.set(1, 1, 1);
    mesh.getWorldScale(worldScale);

    (material.uniforms.invModelMatrix.value as Matrix4).copy(worldMatrix);
    (material.uniforms.scale.value as Vector3).copy(worldScale);
    material.uniforms.time.value = state.clock.getElapsedTime();
  });

  return (
    <mesh ref={meshRef} scale={size} frustumCulled={false} {...props}>
      <boxGeometry args={[1, 1, 1]} />
      <primitive object={material as ShaderMaterial} attach="material" />
    </mesh>
  );
}

