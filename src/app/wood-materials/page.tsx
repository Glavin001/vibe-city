"use client";

import { Suspense, useMemo, useRef } from "react";
import { Canvas, extend } from "@react-three/fiber";
import { OrbitControls, Environment, Text, Html, Stats } from "@react-three/drei";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { WoodNodeMaterial, WoodGenuses, Finishes } from "three/addons/materials/WoodNodeMaterial.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { useControls, folder } from "leva";
import type { ThreeElement } from "@react-three/fiber";

// Extend R3F with WebGPU THREE and custom materials
// biome-ignore lint/suspicious/noExplicitAny: WebGPU types not fully compatible yet
extend(THREE as any);
extend({ WoodNodeMaterial, RoundedBoxGeometry });

// Declare module augmentation for TypeScript
declare module "@react-three/fiber" {
  interface ThreeElements {
    woodNodeMaterial: ThreeElement<typeof WoodNodeMaterial>;
    roundedBoxGeometry: ThreeElement<typeof RoundedBoxGeometry>;
  }
}

// Helper to capitalize names for display
function capitalize(str: string): string {
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Helper to calculate grid positions
function getGridPosition(woodIndex: number, finishIndex: number) {
  return new THREE.Vector3(
    0,
    (finishIndex - Finishes.length / 2) * 1.0,
    (woodIndex - WoodGenuses.length / 2 + 0.45) * 1.0
  );
}

// Grid plane component with procedural TSL pattern
function GridPlane() {
  // Create material with TSL procedural grid
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();

    // Grid function using TSL
    const gridXZ = TSL.Fn(
      ([gridSize = TSL.float(1.0), dotWidth = TSL.float(0.1), lineWidth = TSL.float(0.02)]) => {
        const coord = TSL.positionWorld.xz.div(gridSize);
        const grid = TSL.fract(coord);

        // Screen-space derivative for automatic antialiasing
        const fw = TSL.fwidth(coord);
        const smoothing = TSL.max(fw.x, fw.y).mul(0.5);

        // Create squares at cell centers
        const squareDist = TSL.max(TSL.abs(grid.x.sub(0.5)), TSL.abs(grid.y.sub(0.5)));
        const dots = TSL.smoothstep(dotWidth.add(smoothing), dotWidth.sub(smoothing), squareDist);

        // Create grid lines
        const lineX = TSL.smoothstep(lineWidth.add(smoothing), lineWidth.sub(smoothing), TSL.abs(grid.x.sub(0.5)));
        const lineZ = TSL.smoothstep(lineWidth.add(smoothing), lineWidth.sub(smoothing), TSL.abs(grid.y.sub(0.5)));
        const lines = TSL.max(lineX, lineZ);

        return TSL.max(dots, lines);
      }
    );

    // Radial gradient
    const radialGradient = TSL.Fn(([radius = TSL.float(10.0), falloff = TSL.float(1.0)]) => {
      return TSL.smoothstep(radius, radius.sub(falloff), TSL.length(TSL.positionWorld));
    });

    // Create grid pattern
    const gridPattern = gridXZ(1.0, 0.03, 0.005);
    const baseColor = TSL.vec4(1.0, 1.0, 1.0, 0.0);
    const gridColor = TSL.vec4(0.5, 0.5, 0.5, 1.0);

    // Mix base color with grid lines and apply radial gradient
    mat.colorNode = gridPattern.mix(baseColor, gridColor).mul(radialGradient(30.0, 20.0));
    mat.transparent = true;

    return mat;
  }, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <circleGeometry args={[40, 64]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// Wood block component
interface WoodBlockProps {
  woodType: string;
  finish: string;
  position: THREE.Vector3;
}

function WoodBlock({ woodType, finish, position }: WoodBlockProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Create wood material from presets
  const material = useMemo(() => {
    // @ts-expect-error - WoodNodeMaterial has fromPreset static method
    const mat = WoodNodeMaterial.fromPreset(woodType, finish);
    // Set random transformation matrix for variety
    mat.transformationMatrix = new THREE.Matrix4().setPosition(
      new THREE.Vector3(-0.1, 0, Math.random())
    );
    return mat;
  }, [woodType, finish]);

  return (
    <mesh ref={meshRef} position={position}>
      <roundedBoxGeometry args={[0.125, 0.9, 0.9, 10, 0.02]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// Label component
interface LabelProps {
  text: string;
  position: THREE.Vector3;
}

function Label({ text, position }: LabelProps) {
  return (
    <group position={position} rotation={[0, -Math.PI / 2, 0]}>
      <Html
        center
        style={{
          color: '#000',
          fontSize: '12px',
          fontFamily: 'Arial, sans-serif',
          fontWeight: 'normal',
          userSelect: 'none',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </Html>
    </group>
  );
}

// Custom wood block with controls
function CustomWoodBlock() {
  const controls = useControls("Custom Wood", {
    colors: folder({
      darkGrainColor: "#0c0504",
      lightGrainColor: "#926c50",
    }),
    appearance: folder({
      clearcoat: { value: 1.0, min: 0, max: 1, step: 0.01 },
      clearcoatRoughness: { value: 0.2, min: 0, max: 1, step: 0.01 },
    }),
    pattern: folder({
      centerSize: { value: 1.11, min: 0, max: 2, step: 0.01 },
      largeWarpScale: { value: 0.32, min: 0, max: 1, step: 0.001 },
      largeGrainStretch: { value: 0.24, min: 0, max: 1, step: 0.001 },
      smallWarpStrength: { value: 0.059, min: 0, max: 0.2, step: 0.001 },
      smallWarpScale: { value: 2, min: 0, max: 5, step: 0.01 },
      fineWarpStrength: { value: 0.006, min: 0, max: 0.05, step: 0.001 },
      fineWarpScale: { value: 32.8, min: 0, max: 50, step: 0.1 },
    }),
    rings: folder({
      ringThickness: { value: 1 / 34, min: 0, max: 0.1, step: 0.001 },
      ringBias: { value: 0.03, min: -0.2, max: 0.2, step: 0.001 },
      ringSizeVariance: { value: 0.03, min: 0, max: 0.2, step: 0.001 },
      ringVarianceScale: { value: 4.4, min: 0, max: 10, step: 0.1 },
    }),
    surface: folder({
      barkThickness: { value: 0.3, min: 0, max: 1, step: 0.01 },
      splotchScale: { value: 0.2, min: 0, max: 1, step: 0.01 },
      splotchIntensity: { value: 0.541, min: 0, max: 1, step: 0.01 },
      cellScale: { value: 910, min: 100, max: 2000, step: 1 },
      cellSize: { value: 0.1, min: 0.01, max: 0.5, step: 0.001 },
    }),
  });

  const customPosition = useMemo(
    () => getGridPosition(Math.round(WoodGenuses.length / 2), 5),
    []
  );

  // Create custom wood material with all parameters
  const material = useMemo(() => {
    const mat = new WoodNodeMaterial({
      centerSize: controls.centerSize,
      largeWarpScale: controls.largeWarpScale,
      largeGrainStretch: controls.largeGrainStretch,
      smallWarpStrength: controls.smallWarpStrength,
      smallWarpScale: controls.smallWarpScale,
      fineWarpStrength: controls.fineWarpStrength,
      fineWarpScale: controls.fineWarpScale,
      ringThickness: controls.ringThickness,
      ringBias: controls.ringBias,
      ringSizeVariance: controls.ringSizeVariance,
      ringVarianceScale: controls.ringVarianceScale,
      barkThickness: controls.barkThickness,
      splotchScale: controls.splotchScale,
      splotchIntensity: controls.splotchIntensity,
      cellScale: controls.cellScale,
      cellSize: controls.cellSize,
      darkGrainColor: new THREE.Color(controls.darkGrainColor),
      lightGrainColor: new THREE.Color(controls.lightGrainColor),
      clearcoat: controls.clearcoat,
      clearcoatRoughness: controls.clearcoatRoughness,
    });
    mat.transformationMatrix = new THREE.Matrix4().setPosition(
      new THREE.Vector3(-0.1, 0, Math.random())
    );
    return mat;
  }, [controls]);

  return (
    <>
      <Label
        text="custom"
        position={getGridPosition(Math.round(WoodGenuses.length / 2 - 1), 5)}
      />
      <mesh position={customPosition}>
        <roundedBoxGeometry args={[0.125, 0.9, 0.9, 10, 0.02]} />
        <primitive object={material} attach="material" />
      </mesh>
    </>
  );
}

// Main scene component
function WoodMaterialsScene() {
  const baseRef = useRef<THREE.Group>(null);

  return (
    <>
      <color attach="background" args={["#ffffff"]} />

      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1.5} />

      <OrbitControls
        makeDefault
        target={[0, 0, 0.548]}
        enableDamping
        dampingFactor={0.05}
      />

      <Suspense fallback={null}>
        <Environment
          files="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/aerodynamics_workshop_1k.hdr"
          background={false}
        />
      </Suspense>

      <GridPlane />

      <group
        ref={baseRef}
        rotation={[0, 0, -Math.PI / 2]}
        position={[0, 0, 0.548]}
      >
        {/* Wood type labels (top row) */}
        {WoodGenuses.map((wood, x) => (
          <Label key={`wood-${wood}`} text={capitalize(wood)} position={getGridPosition(x, -1)} />
        ))}

        {/* Finish labels (left column) */}
        {Finishes.map((finish, y) => (
          <Label key={`finish-${finish}`} text={capitalize(finish)} position={getGridPosition(-1, y)} />
        ))}

        {/* Wood blocks grid */}
        {WoodGenuses.map((wood, x) =>
          Finishes.map((finish, y) => (
            <WoodBlock
              key={`${wood}-${finish}`}
              woodType={wood}
              finish={finish}
              position={getGridPosition(x, y)}
            />
          ))
        )}

        {/* Custom wood block with controls */}
        <CustomWoodBlock />
      </group>
    </>
  );
}

export default function WoodMaterialsPage() {
  return (
    <div className="w-full h-screen relative bg-white">
      {/* Info panel */}
      <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur-sm p-4 rounded-lg shadow-lg max-w-md">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          Three.js WebGPU - Procedural Wood Materials
        </h1>
        <p className="text-sm text-gray-600 mb-2">
          Based on{" "}
          <a
            href="https://www.youtube.com/watch?v=n7e0vxgBS8A"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-700 underline"
          >
            Lance Phan's Blender tutorial
          </a>
        </p>
        <p className="text-xs text-gray-500">
          Procedural wood materials using WebGPU renderer and TSL (Three Shading Language).
          Use the Leva controls to customize the "custom" wood block parameters.
        </p>
        <p className="text-xs text-gray-500 italic mt-2">
          Note: Requires WebGPU support. Check{" "}
          <a
            href="https://caniuse.com/webgpu"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-700 underline"
          >
            browser compatibility
          </a>
          .
        </p>
      </div>

      <Canvas
        camera={{ position: [-0.1, 5, 0.548], fov: 75 }}
        gl={async (props) => {
          // @ts-expect-error - WebGPURenderer props type compatibility with R3F
          const renderer = new THREE.WebGPURenderer({
            ...props,
            antialias: true,
          } as any);
          renderer.toneMapping = THREE.NeutralToneMapping;
          renderer.toneMappingExposure = 1.0;
          await renderer.init();
          // @ts-expect-error - Return type compatibility with R3F
          return renderer as any;
        }}
      >
        <WoodMaterialsScene />
      </Canvas>

      <Stats className="!absolute !top-4 !right-4" />
    </div>
  );
}

