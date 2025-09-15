"use client";

import { Environment, OrbitControls, StatsGl } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grass } from "./Grass";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

function useInteractionTexture({ size = 512, decay = 0.96 } = {}) {
  const canvas = useMemo(
    () => Object.assign(document.createElement("canvas"), { width: size, height: size }),
    [size],
  );
  const ctx = useMemo(() => canvas.getContext("2d") as CanvasRenderingContext2D, [canvas]);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }, [canvas]);

  const fade = () => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(0,0,0,${1 - decay})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    texture.needsUpdate = true;
  };

  const makeStamper = (boundsMin: THREE.Vector2, boundsSize: THREE.Vector2) =>
    (x: number, z: number, radiusWorld: number, strength = 1) => {
      const u = (x - boundsMin.x) / boundsSize.x;
      const v = (z - boundsMin.y) / boundsSize.y;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      const r = (radiusWorld / Math.max(boundsSize.x, boundsSize.y)) * canvas.width;
      const gx = u * canvas.width;
      const gy = (1 - v) * canvas.height;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.9 * strength})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(gx, gy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      texture.needsUpdate = true;
    };

  return { texture, fade, makeStamper, size };
}

function RollingBall({
  stamper,
  boundsMin,
  boundsSize,
  radius = 0.6,
  speed = 1,
  groundRef,
}: {
  stamper: ReturnType<ReturnType<typeof useInteractionTexture>["makeStamper"]>;
  boundsMin: THREE.Vector2;
  boundsSize: THREE.Vector2;
  radius?: number;
  speed?: number;
  groundRef?: React.RefObject<THREE.Mesh | null>;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() * speed;
    const x = boundsMin.x + (0.5 + 0.5 * Math.sin(t * 0.35)) * boundsSize.x;
    const z = boundsMin.y + (0.5 + 0.5 * Math.cos(t * 0.5)) * boundsSize.y;
    let y = radius;
    const ground = groundRef?.current;
    if (ground) {
      ray.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(ground, false);
      if (hits.length > 0) y = hits[0].point.y + radius;
    }
    if (ref.current) ref.current.position.set(x, y, z);
    if (stamper) stamper(x, z, radius, 1.0);
  });
  return (
    <mesh ref={ref} castShadow receiveShadow>
      <sphereGeometry args={[radius, 32, 32]} />
      <meshStandardMaterial color="#cccccc" metalness={0.2} roughness={0.6} />
    </mesh>
  );
}

function InteractionFader({ fade }: { fade: () => void }) {
  useFrame(() => fade());
  return null;
}

export default function GrassV2Demo() {
  const scale = 2;
  const W = 80 * scale;
  const boundsMin = useMemo(() => new THREE.Vector2(-W / 2, -W / 2), [W]);
  const boundsSize = useMemo(() => new THREE.Vector2(W, W), [W]);
  const interact = useInteractionTexture({ size: 512, decay: 0.97 });
  const groundRef = useRef<THREE.Mesh>(null);

  const stamper = useMemo(
    () => interact.makeStamper(boundsMin, boundsSize),
    [interact, boundsMin, boundsSize],
  );
  return (
    <Canvas shadows camera={{ position: [10, 6, 10], fov: 45 }}>
      <Suspense fallback={null}>
        <color attach="background" args={["#9fd6ff"]} />
        <hemisphereLight intensity={0.65} groundColor="#7aa07a" />
        <directionalLight position={[10, 15, 10]} intensity={1.15} castShadow />

         <Grass
           width={W}
           instances={80000*scale*scale}
           interactionTexture={interact.texture}
           useInteract
           boundsMin={boundsMin}
           boundsSize={boundsSize}
           flattenStrength={0.9}
           groundRef={groundRef}
         />

        <InteractionFader fade={interact.fade} />
        <RollingBall stamper={stamper} boundsMin={boundsMin} boundsSize={boundsSize} radius={5} speed={0.5} groundRef={groundRef} />

        <Environment preset="sunset" />
        <OrbitControls makeDefault />
      </Suspense>
      <StatsGl />
    </Canvas>
  );
}


