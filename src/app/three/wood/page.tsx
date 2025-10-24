"use client";

import { OrbitControls } from "@react-three/drei";
import {
  Canvas,
  extend,
  type ThreeToJSXElements,
  useLoader,
  useThree,
} from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import {
  Finishes,
  WoodGenuses,
  WoodNodeMaterial,
} from "three/addons/materials/WoodNodeMaterial.js";
import WebGPU from "three/addons/capabilities/WebGPU.js";

declare module "@react-three/fiber" {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any);

function getGridPosition(
  woodIndex: number,
  finishIndex: number,
): [number, number, number] {
  return [
    0,
    (finishIndex - Finishes.length / 2) * 1,
    (woodIndex - WoodGenuses.length / 2 + 0.45) * 1,
  ];
}

function GridPlane() {
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();

    const gridXZ = TSL.Fn(
      // @ts-ignore
      ([
        gridSize = TSL.float(1.0),
        dotWidth = TSL.float(0.1),
        lineWidth = TSL.float(0.02),
      ]) => {
        const coord = TSL.positionWorld.xz.div(gridSize);
        const grid = TSL.fract(coord);

        const fw = TSL.fwidth(coord);
        const smoothing = TSL.max(fw.x, fw.y).mul(0.5);

        const squareDist = TSL.max(
          TSL.abs(grid.x.sub(0.5)),
          TSL.abs(grid.y.sub(0.5)),
        );
        const dots = TSL.smoothstep(
          dotWidth.add(smoothing),
          dotWidth.sub(smoothing),
          squareDist,
        );

        const lineX = TSL.smoothstep(
          lineWidth.add(smoothing),
          lineWidth.sub(smoothing),
          TSL.abs(grid.x.sub(0.5)),
        );
        const lineZ = TSL.smoothstep(
          lineWidth.add(smoothing),
          lineWidth.sub(smoothing),
          TSL.abs(grid.y.sub(0.5)),
        );
        const lines = TSL.max(lineX, lineZ);

        return TSL.max(dots, lines);
      },
    );

    const radialGradient = TSL.Fn(
      // @ts-ignore
      ([radius = TSL.float(10.0), falloff = TSL.float(1.0)]) => {
        return TSL.smoothstep(
          radius,
          radius.sub(falloff),
          TSL.length(TSL.positionWorld),
        );
      },
    );

    const gridPattern = (gridXZ as any)(1.0, 0.03, 0.005);
    const baseColor = TSL.vec4(1.0, 1.0, 1.0, 0.0);
    const gridColor = TSL.vec4(0.5, 0.5, 0.5, 1.0);

    mat.colorNode = gridPattern
      .mix(baseColor, gridColor)
      .mul((radialGradient as any)(30.0, 20.0));
    mat.transparent = true;

    return mat;
  }, []);

  return (
    <mesh
      material={material}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={-1}
    >
      <circleGeometry args={[40]} />
    </mesh>
  );
}

function Label({
  text,
  position,
  font,
  material,
}: {
  text: string;
  position: [number, number, number];
  font: any;
  material: THREE.MeshStandardMaterial;
}) {
  const geometry = useMemo(() => {
    const txt = new TextGeometry(text, {
      font,
      size: 0.1,
      depth: 0.001,
      curveSegments: 12,
      bevelEnabled: false,
    });

    txt.computeBoundingBox();
    const offx = -0.5 * (txt.boundingBox!.max.x - txt.boundingBox!.min.x);
    const offy = -0.5 * (txt.boundingBox!.max.y - txt.boundingBox!.min.y);
    const offz = -0.5 * (txt.boundingBox!.max.z - txt.boundingBox!.min.z);
    txt.translate(offx, offy, offz);

    return txt;
  }, [font, text]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      rotation={[0, -Math.PI / 2, 0]}
    />
  );
}

function Labels({
  font,
  material,
}: {
  font: any;
  material: THREE.MeshStandardMaterial;
}) {
  return (
    <>
      {Finishes.map((finish, y) => (
        <Label
          key={`finish-${finish}`}
          text={finish}
          position={getGridPosition(-1, y)}
          font={font}
          material={material}
        />
      ))}
      {WoodGenuses.map((genus, x) => (
        <Label
          key={`genus-${genus}`}
          text={genus}
          position={getGridPosition(x, -1)}
          font={font}
          material={material}
        />
      ))}
    </>
  );
}

function WoodBlock({
  genus,
  finish,
  position,
  geometry,
}: {
  genus: (typeof WoodGenuses)[number];
  finish: (typeof Finishes)[number];
  position: [number, number, number];
  geometry: THREE.BufferGeometry;
}) {
  const material = useMemo(() => {
    const mat = WoodNodeMaterial.fromPreset(genus, finish);
    mat.transformationMatrix = new THREE.Matrix4().setPosition(
      new THREE.Vector3(-0.1, 0, Math.random()),
    );
    return mat;
  }, [genus, finish]);

  return <mesh geometry={geometry} material={material} position={position} />;
}

function WoodBlocks({
  geometry,
}: {
  geometry: THREE.BufferGeometry;
}) {
  return (
    <>
      {WoodGenuses.map((genus, x) =>
        Finishes.map((finish, y) => (
          <WoodBlock
            key={`${genus}-${finish}`}
            genus={genus}
            finish={finish}
            position={getGridPosition(x, y)}
            geometry={geometry}
          />
        )),
      )}
    </>
  );
}

function CustomWood({
  geometry,
  font,
  labelMaterial,
}: {
  geometry: THREE.BufferGeometry;
  font: any;
  labelMaterial: THREE.MeshStandardMaterial;
}) {
  const material = useMemo(() => {
    const mat = new WoodNodeMaterial({
      centerSize: 1.11,
      largeWarpScale: 0.32,
      largeGrainStretch: 0.24,
      smallWarpStrength: 0.059,
      smallWarpScale: 2,
      fineWarpStrength: 0.006,
      fineWarpScale: 32.8,
      ringThickness: 1 / 34,
      ringBias: 0.03,
      ringSizeVariance: 0.03,
      ringVarianceScale: 4.4,
      barkThickness: 0.3,
      splotchScale: 0.2,
      splotchIntensity: 0.541,
      cellScale: 910,
      cellSize: 0.1,
      darkGrainColor: new THREE.Color("#0c0504"),
      lightGrainColor: new THREE.Color("#926c50"),
      clearcoat: 1,
      clearcoatRoughness: 0.2,
    });
    mat.transformationMatrix = new THREE.Matrix4().setPosition(
      new THREE.Vector3(-0.1, 0, Math.random()),
    );
    return mat;
  }, []);

  useEffect(() => {
    const gui = new GUI();
    gui.add(material, "centerSize", 0.0, 2.0, 0.01);
    gui.add(material, "largeWarpScale", 0.0, 1.0, 0.001);
    gui.add(material, "largeGrainStretch", 0.0, 1.0, 0.001);
    gui.add(material, "smallWarpStrength", 0.0, 0.2, 0.001);
    gui.add(material, "smallWarpScale", 0.0, 5.0, 0.01);
    gui.add(material, "fineWarpStrength", 0.0, 0.05, 0.001);
    gui.add(material, "fineWarpScale", 0.0, 50.0, 0.1);
    gui.add(material, "ringThickness", 0.0, 0.1, 0.001);
    gui.add(material, "ringBias", -0.2, 0.2, 0.001);
    gui.add(material, "ringSizeVariance", 0.0, 0.2, 0.001);
    gui.add(material, "ringVarianceScale", 0.0, 10.0, 0.1);
    gui.add(material, "barkThickness", 0.0, 1.0, 0.01);
    gui.add(material, "splotchScale", 0.0, 1.0, 0.01);
    gui.add(material, "splotchIntensity", 0.0, 1.0, 0.01);
    gui.add(material, "cellScale", 100, 2000, 1);
    gui.add(material, "cellSize", 0.01, 0.5, 0.001);
    gui
      .addColor({ darkGrainColor: "#0c0504" }, "darkGrainColor")
      .onChange((v) => material.darkGrainColor.set(v));
    gui
      .addColor({ lightGrainColor: "#926c50" }, "lightGrainColor")
      .onChange((v) => material.lightGrainColor.set(v));
    gui.add(material, "clearcoat", 0.0, 1.0, 0.01);
    gui.add(material, "clearcoatRoughness", 0.0, 1.0, 0.01);
    return () => gui.destroy();
  }, [material]);

  return (
    <>
      <Label
        text="custom"
        position={getGridPosition(
          Math.round(WoodGenuses.length / 2 - 1),
          5,
        )}
        font={font}
        material={labelMaterial}
      />
      <mesh
        geometry={geometry}
        material={material}
        position={getGridPosition(Math.round(WoodGenuses.length / 2), 5)}
      />
    </>
  );
}

function EnvironmentMap() {
  const texture = useLoader(
    HDRLoader,
    "https://threejs.org/examples/textures/equirectangular/san_giuseppe_bridge_2k.hdr",
  );
  const { scene } = useThree();

  useEffect(() => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    (scene as any).environmentIntensity = 2;
  }, [scene, texture]);

  return null;
}

function WoodScene() {
  const font = useLoader(
    FontLoader,
    "https://threejs.org/examples/fonts/helvetiker_regular.typeface.json",
  );
  const textMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial();
    (mat as any).colorNode = TSL.color("#000000");
    return mat;
  }, []);
  const geometry = useMemo(
    () => new RoundedBoxGeometry(0.125, 0.9, 0.9, 10, 0.02),
    [],
  );

  return (
    <group rotation={[0, 0, -Math.PI / 2]} position={[0, 0, 0.548]}>
      <GridPlane />
      <Labels font={font} material={textMaterial} />
      <WoodBlocks geometry={geometry} />
      <CustomWood geometry={geometry} font={font} labelMaterial={textMaterial} />
    </group>
  );
}

export default function WoodPage() {
  if (typeof window !== "undefined" && !WebGPU.isAvailable()) {
    return (
      <div className="p-4">WebGPU is not supported in this browser.</div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="w-full h-[600px]">
        <Canvas
          camera={{ position: [-0.1, 5, 0.548], fov: 75 }}
          gl={(
            async (canvas: HTMLCanvasElement) => {
              const renderer = new THREE.WebGPURenderer({
                canvas,
                antialias: true,
              });
              await renderer.init();
              renderer.toneMapping = THREE.NeutralToneMapping;
              renderer.toneMappingExposure = 1.0;
              return renderer;
            }
          ) as any}
        >
          <Suspense fallback={null}>
            <color attach="background" args={["#ffffff"]} />
            <EnvironmentMap />
            <WoodScene />
            <OrbitControls target={[0, 0, 0.548]} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}

