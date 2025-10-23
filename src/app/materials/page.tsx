"use client";

import React, { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, extend } from "@react-three/fiber";
import { OrbitControls, Environment, Html, Stats } from "@react-three/drei";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { WoodNodeMaterial, WoodGenuses, Finishes } from "three/addons/materials/WoodNodeMaterial.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { MaterialXLoader } from "three/addons/loaders/MaterialXLoader.js";
import { useControls, folder, Leva } from "leva";
import type { ThreeElement } from "@react-three/fiber";

type Vector3Tuple = [number, number, number];

const WOOD_ROW_SPACING = 1.0;
const WOOD_COLUMN_SPACING = 1.0;
const MATERIALX_ROW_SPACING = 2.0; // Increased for label spacing
const MATERIALX_COLUMN_SPACING = 1.5;
const MATERIALX_VERTICAL_GAP = 2.5;
const MATERIALX_LABEL_OFFSET = 0.7; // Distance below the material block

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

// Grid plane component with procedural TSL pattern
function GridPlane() {
  // Create material with TSL procedural grid
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();

    // Grid parameters
    const gridSize = 1.0;
    const dotWidth = 0.03;
    const lineWidth = 0.005;
    
    // Grid calculation
    const coord = TSL.positionWorld.xz.div(gridSize);
    const grid = TSL.fract(coord);

    // Screen-space derivative for automatic antialiasing
    const fw = TSL.fwidth(coord);
    const smoothing = TSL.max(fw.x, fw.y).mul(0.5);

    // Create squares at cell centers
    const squareDist = TSL.max(TSL.abs(grid.x.sub(0.5)), TSL.abs(grid.y.sub(0.5)));
    const dots = TSL.smoothstep(TSL.float(dotWidth).add(smoothing), TSL.float(dotWidth).sub(smoothing), squareDist);

    // Create grid lines
    const lineX = TSL.smoothstep(TSL.float(lineWidth).add(smoothing), TSL.float(lineWidth).sub(smoothing), TSL.abs(grid.x.sub(0.5)));
    const lineZ = TSL.smoothstep(TSL.float(lineWidth).add(smoothing), TSL.float(lineWidth).sub(smoothing), TSL.abs(grid.y.sub(0.5)));
    const lines = TSL.max(lineX, lineZ);
    
    const gridPattern = TSL.max(dots, lines);

    // Radial gradient parameters
    const radius = 30.0;
    const falloff = 20.0;
    const radialGradient = TSL.smoothstep(TSL.float(radius), TSL.float(radius).sub(falloff), TSL.length(TSL.positionWorld));

    const baseColor = TSL.vec4(1.0, 1.0, 1.0, 0.0);
    const gridColor = TSL.vec4(0.5, 0.5, 0.5, 1.0);

    // Mix base color with grid lines and apply radial gradient
    mat.colorNode = gridPattern.mix(baseColor, gridColor).mul(radialGradient);
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

// MaterialX materials list - ONLY materials that work without external texture dependencies
// Excluded materials that require missing texture files:
// - standard_surface_brass_tiled (missing brass textures)
// - standard_surface_brick_procedural (missing brick textures)
// - standard_surface_chess_set (missing chess_set textures)
// - standard_surface_greysphere_calibration (missing calibration texture)
// - standard_surface_look_brass_tiled (missing brass textures)
// - standard_surface_look_wood_tiled (missing wood textures)
// - standard_surface_wood_tiled (missing wood textures)
const MATERIALX_MATERIALS = [
  "standard_surface_carpaint",
  "standard_surface_chrome",
  "standard_surface_copper",
  "standard_surface_default",
  "standard_surface_glass",
  "standard_surface_glass_tinted",
  "standard_surface_gold",
  "standard_surface_greysphere",
  "standard_surface_jade",
  "standard_surface_marble_solid",
  "standard_surface_metal_brushed",
  "standard_surface_plastic",
  "standard_surface_thin_film",
  "standard_surface_velvet",
];

const MATERIALX_GRID_COLUMNS = 7;

// MaterialX block component (matching wood block style)
interface MaterialXBlockProps {
  materialName: string;
  position: THREE.Vector3;
  onError?: (error: Error) => void;
}

function MaterialXBlock({ materialName, position, onError }: MaterialXBlockProps) {
  const [material, setMaterial] = useState<THREE.Material | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    // Load MaterialX material with proper path handling
    const basePath = 'https://raw.githubusercontent.com/materialx/MaterialX/main/resources/';
    
    new MaterialXLoader()
      .setPath(basePath)
      .loadAsync(`Materials/Examples/StandardSurface/${materialName}.mtlx`)
      .then((loadedData) => {
        // MaterialXLoader returns an object with materials property
        const materials = loadedData?.materials ? Object.values(loadedData.materials) : [];
        if (materials.length > 0) {
          setMaterial(materials[0]);
        }
      })
      .catch((error) => {
        console.error(`Error loading MaterialX ${materialName}:`, error);
        onError?.(error as Error);
      });
  }, [materialName, onError]);

  if (!material) {
    return (
      <mesh ref={meshRef} position={position}>
        <roundedBoxGeometry args={[0.125, 0.9, 0.9, 10, 0.02]} />
        <meshStandardMaterial color="#cccccc" />
      </mesh>
    );
  }

  return (
    <mesh ref={meshRef} position={position}>
      <roundedBoxGeometry args={[0.125, 0.9, 0.9, 10, 0.02]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// Custom wood block with controls
interface CustomWoodBlockProps {
  position: THREE.Vector3;
}

function CustomWoodBlock({ position }: CustomWoodBlockProps) {
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
    <mesh position={position}>
      <roundedBoxGeometry args={[0.125, 0.9, 0.9, 10, 0.02]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// Main scene component - separate wood and MaterialX grids
function MaterialsScene() {
  const { showWood, showMaterialX, showCustom, materialXColumns } = useControls("Display", {
    showWood: { value: true, label: "Show Wood Materials" },
    showMaterialX: { value: true, label: "Show MaterialX Materials" },
    showCustom: { value: true, label: "Show Custom Wood" },
    materialXColumns: { value: MATERIALX_GRID_COLUMNS, min: 1, max: 15, step: 1, label: "MaterialX Columns" },
  });

  // Wood grid positioning
  const getWoodPosition = (column: number, row: number) => {
    const totalWoodColumns = WoodGenuses.length + (showCustom ? 1 : 0);
    return new THREE.Vector3(
      0,
      (row - Finishes.length / 2) * WOOD_ROW_SPACING,
      (column - totalWoodColumns / 2 + 0.5) * WOOD_COLUMN_SPACING
    );
  };

  // MaterialX grid positioning - separate grid below wood
  const getMaterialXPosition = (index: number) => {
    const row = Math.floor(index / materialXColumns);
    const col = index % materialXColumns;
    const gridWidth = Math.min(materialXColumns, MATERIALX_MATERIALS.length) * MATERIALX_COLUMN_SPACING;
    
    return new THREE.Vector3(
      0,
      -(Finishes.length / 2 + MATERIALX_VERTICAL_GAP + row * MATERIALX_ROW_SPACING),
      (col - materialXColumns / 2 + 0.5) * MATERIALX_COLUMN_SPACING
    );
  };

  return (
    <>
      <color attach="background" args={["#ffffff"]} />

      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1.5} />

      <OrbitControls
        makeDefault
        target={[-2, 0, 0]}
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2}
      />

      <Suspense fallback={null}>
        <Environment
          files="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/aerodynamics_workshop_1k.hdr"
          background={false}
        />
      </Suspense>

      <GridPlane />

      {/* Wood Materials Grid */}
      {showWood && (
        <group rotation={[0, 0, -Math.PI / 2]} position={[0, 0, 0.548]}>
          {/* Finish labels (left column) */}
          {Finishes.map((finish, y) => (
            <Label key={`finish-${finish}`} text={capitalize(finish)} position={getWoodPosition(-1, y)} />
          ))}

          {/* Wood type columns */}
          {WoodGenuses.map((wood, woodIndex) => (
            <React.Fragment key={`wood-section-${wood}`}>
              {/* Wood type label */}
              <Label text={capitalize(wood)} position={getWoodPosition(woodIndex, -1)} />
              
              {/* Wood blocks for each finish */}
              {Finishes.map((finish, finishIndex) => (
                <WoodBlock
                  key={`${wood}-${finish}`}
                  woodType={wood}
                  finish={finish}
                  position={getWoodPosition(woodIndex, finishIndex)}
                />
              ))}
            </React.Fragment>
          ))}

          {/* Custom Wood Section */}
          {showCustom && (
            <>
              <Label text="Custom" position={getWoodPosition(WoodGenuses.length, -1)} />
              <CustomWoodBlock position={getWoodPosition(WoodGenuses.length, Math.floor(Finishes.length / 2))} />
            </>
          )}
        </group>
      )}

      {/* MaterialX Materials Grid - separate section below */}
      {showMaterialX && (
        <group rotation={[0, 0, -Math.PI / 2]} position={[0, 0, 0.548]}>
          {MATERIALX_MATERIALS.map((materialName, index) => {
            const displayName = materialName.replace('standard_surface_', '').replace(/_/g, ' ');
            const position = getMaterialXPosition(index);
            
              return (
                <React.Fragment key={`mtx-${materialName}`}>
                  {/* Material block */}
                  <MaterialXBlock
                    materialName={materialName}
                    position={position}
                  />
                  
                  {/* Label below block */}
                  <Label 
                    text={capitalize(displayName)} 
                    position={new THREE.Vector3(position.x, position.y, position.z + MATERIALX_LABEL_OFFSET)} 
                  />
                </React.Fragment>
              );
            })}
          </group>
        )}
      </>
    );
  }

export default function MaterialsDemoPage() {
  return (
    <div className="w-full h-screen relative bg-white">
      {/* Leva controls - collapsed by default */}
      <Leva collapsed={true} />
      
      {/* Stats - top right corner */}
      <Stats className="!absolute !top-4 !right-4" />

      {/* Info panel - bottom left corner, compact */}
      <div className="absolute bottom-4 left-4 z-10 bg-white/80 backdrop-blur-sm p-3 rounded shadow-md max-w-xs text-xs">
        <h1 className="text-sm font-bold text-gray-800 mb-1">
          Three.js WebGPU - Materials Gallery
        </h1>
        <p className="text-xs text-gray-600 mb-2">
          {WoodGenuses.length} wood types × {Finishes.length} finishes + {MATERIALX_MATERIALS.length} MaterialX materials
        </p>
        <div className="space-y-1 text-[10px] text-gray-500">
          <div>
            <span className="font-semibold">Wood:</span>{" "}
            <a
              href="https://www.youtube.com/watch?v=n7e0vxgBS8A"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-700 underline"
            >
              Lance Phan
            </a>
          </div>
          <div>
            <span className="font-semibold">MaterialX:</span>{" "}
            <a
              href="https://github.com/AcademySoftwareFoundation/MaterialX"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-700 underline"
            >
              ASWF
            </a>
          </div>
          <div className="italic">
            Requires{" "}
            <a
              href="https://caniuse.com/webgpu"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-700 underline"
            >
              WebGPU
            </a>
          </div>
        </div>
      </div>

      <Canvas
        camera={{ position: [-2, 8, 0], fov: 75, up: [0, 0, 1] }}
        // biome-ignore lint/suspicious/noExplicitAny: WebGPURenderer type compatibility with R3F
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer({
            ...props,
            antialias: true,
          } as any);
          renderer.toneMapping = THREE.NeutralToneMapping;
          renderer.toneMappingExposure = 1.0;
          await renderer.init();
          return renderer as any;
        }}
      >
        <MaterialsScene />
      </Canvas>
    </div>
  );
}

