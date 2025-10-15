"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import { useEffect, useRef, useMemo, useState } from "react";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { Model as UniversalHumanoid } from "../../components/UniversalHumanoid";

const maxParticleCount = 50000;
const instanceCount = maxParticleCount / 2;

interface RainSceneProps {
  guiState: {
    position: number;
    scale: number;
    dropCount: number;
  };
}

function RainScene({ guiState }: RainSceneProps) {
  const { gl, scene } = useThree();
  const [monkeyGeometry, setMonkeyGeometry] = useState<THREE.BufferGeometry | null>(null);
  const collisionBoxRef = useRef<THREE.Mesh | null>(null);
  const monkeyRef = useRef<THREE.Mesh | null>(null);
  const rainParticlesRef = useRef<THREE.Mesh | null>(null);
  const rippleParticlesRef = useRef<THREE.Mesh | null>(null);
  const clockRef = useRef(new THREE.Clock());
  
  const collisionBoxPosUI = useRef(new THREE.Vector3(0, 12, 0));
  const collisionBoxPos = useRef(new THREE.Vector3());

  // Set up collision detection system
  const collisionSystem = useMemo(() => {
    const collisionCamera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 50);
    collisionCamera.position.y = 50;
    collisionCamera.lookAt(0, 0, 0);
    collisionCamera.layers.disableAll();
    collisionCamera.layers.enable(1);

    const collisionPosRT = new THREE.RenderTarget(1024, 1024);
    collisionPosRT.texture.type = THREE.HalfFloatType;
    collisionPosRT.texture.magFilter = THREE.NearestFilter;
    collisionPosRT.texture.minFilter = THREE.NearestFilter;
    collisionPosRT.texture.generateMipmaps = false;

    const collisionPosMaterial = new THREE.MeshBasicNodeMaterial();
    collisionPosMaterial.colorNode = TSL.positionWorld;

    return { collisionCamera, collisionPosRT, collisionPosMaterial };
  }, []);

  // Create instanced arrays and compute shaders
  const { 
    positionBuffer, 
    ripplePositionBuffer, 
    rippleTimeBuffer,
    computeInit,
    computeUpdate 
  } = useMemo(() => {
    const positionBuffer = TSL.instancedArray(maxParticleCount, "vec3");
    const velocityBuffer = TSL.instancedArray(maxParticleCount, "vec3");
    const ripplePositionBuffer = TSL.instancedArray(maxParticleCount, "vec3");
    const rippleTimeBuffer = TSL.instancedArray(maxParticleCount, "vec3");

    // Compute initialization
    const randUint = () => TSL.uint(Math.random() * 0xffffff);

    const computeInit = TSL.Fn(() => {
      const position = positionBuffer.element(TSL.instanceIndex);
      const velocity = velocityBuffer.element(TSL.instanceIndex);
      const rippleTime = rippleTimeBuffer.element(TSL.instanceIndex);

      const randX = TSL.hash(TSL.instanceIndex);
      const randY = TSL.hash(TSL.instanceIndex.add(randUint()));
      const randZ = TSL.hash(TSL.instanceIndex.add(randUint()));

      position.x.assign(randX.mul(100).add(-50));
      position.y.assign(randY.mul(25));
      position.z.assign(randZ.mul(100).add(-50));

      velocity.y.assign(randX.mul(-0.04).add(-0.2));

      rippleTime.x.assign(1000);
    })().compute(maxParticleCount);

    // Compute update
    const computeUpdate = TSL.Fn(() => {
      const getCoord = (pos: any) => pos.add(50).div(100);

      const position = positionBuffer.element(TSL.instanceIndex);
      const velocity = velocityBuffer.element(TSL.instanceIndex);
      const ripplePosition = ripplePositionBuffer.element(TSL.instanceIndex);
      const rippleTime = rippleTimeBuffer.element(TSL.instanceIndex);

      position.addAssign(velocity);
      rippleTime.x.assign(rippleTime.x.add(TSL.deltaTime.mul(4)));

      const collisionArea = TSL.texture(
        collisionSystem.collisionPosRT.texture,
        getCoord(position.xz)
      );

      const surfaceOffset = 0.05;
      const floorPosition = collisionArea.y.add(surfaceOffset);

      // Floor collision
      const ripplePivotOffsetY = -0.9;

      TSL.If(position.y.add(ripplePivotOffsetY).lessThan(floorPosition), () => {
        position.y.assign(25);

        ripplePosition.xz.assign(position.xz);
        ripplePosition.y.assign(floorPosition);

        rippleTime.x.assign(1);

        position.x.assign(TSL.hash(TSL.instanceIndex.add(TSL.time)).mul(100).add(-50));
        position.z.assign(
          TSL.hash(TSL.instanceIndex.add(TSL.time.add(randUint()))).mul(100).add(-50)
        );
      });

      const rippleOnSurface = TSL.texture(
        collisionSystem.collisionPosRT.texture,
        getCoord(ripplePosition.xz)
      );

      const rippleFloorArea = rippleOnSurface.y.add(surfaceOffset);

      TSL.If(ripplePosition.y.greaterThan(rippleFloorArea), () => {
        rippleTime.x.assign(1000);
      });
    });

    return {
      positionBuffer,
      ripplePositionBuffer,
      rippleTimeBuffer,
      computeInit,
      computeUpdate: computeUpdate().compute(maxParticleCount),
    };
  }, [collisionSystem]);

  // Rain material
  const rainMaterial = useMemo(() => {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = TSL.uv()
      .distance(TSL.vec2(0.5, 0))
      .oneMinus()
      .mul(3)
      .exp()
      .mul(0.1);
    material.vertexNode = TSL.billboarding({
      position: positionBuffer.toAttribute(),
    });
    material.opacity = 0.2;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.transparent = true;
    return material;
  }, [positionBuffer]);

  // Ripple material
  const rippleMaterial = useMemo(() => {
    const rippleTime = rippleTimeBuffer.element(TSL.instanceIndex).x;

    const rippleEffect = TSL.Fn(() => {
      const center = TSL.uv().add(TSL.vec2(-0.5)).length().mul(7);
      const distance = rippleTime.sub(center);

      return distance.min(1).sub(distance.max(1).sub(1));
    });

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = rippleEffect();
    material.positionNode = TSL.positionGeometry.add(ripplePositionBuffer.toAttribute());
    material.opacityNode = rippleTime.mul(0.3).oneMinus().max(0).mul(0.5);
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.transparent = true;
    return material;
  }, [ripplePositionBuffer, rippleTimeBuffer]);

  // Ripple geometry
  const rippleGeometry = useMemo(() => {
    const surfaceRippleGeometry = new THREE.PlaneGeometry(2.5, 2.5);
    surfaceRippleGeometry.rotateX(-Math.PI / 2);

    const xRippleGeometry = new THREE.PlaneGeometry(1, 2);
    xRippleGeometry.rotateY(-Math.PI / 2);

    const zRippleGeometry = new THREE.PlaneGeometry(1, 2);

    return BufferGeometryUtils.mergeGeometries([
      surfaceRippleGeometry,
      xRippleGeometry,
      zRippleGeometry,
    ]);
  }, []);

  // Load monkey geometry
  useEffect(() => {
    const loader = new THREE.BufferGeometryLoader();
    loader.load("/models/json/suzanne_buffergeometry.json", (geometry) => {
      geometry.computeVertexNormals();
      setMonkeyGeometry(geometry);
    });
  }, []);

  // Initialize compute
  useEffect(() => {
    if (gl && "computeAsync" in gl) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gl as any).computeAsync(computeInit);
    }
  }, [gl, computeInit]);

  // Animation loop
  useFrame(() => {
    const delta = clockRef.current.getDelta();

    if (monkeyRef.current) {
      monkeyRef.current.rotation.y += delta;
    }

    // Update collision box position with lerp
    collisionBoxPosUI.current.setZ(-guiState.position);
    collisionBoxPos.current.set(
      collisionBoxPosUI.current.x,
      collisionBoxPosUI.current.y,
      -collisionBoxPosUI.current.z
    );
    if (collisionBoxRef.current) {
      collisionBoxRef.current.position.lerp(collisionBoxPos.current, 10 * delta);
      collisionBoxRef.current.scale.x = guiState.scale;
    }

    // Update particle counts
    if (rainParticlesRef.current) {
      rainParticlesRef.current.count = guiState.dropCount;
    }
    if (rippleParticlesRef.current) {
      rippleParticlesRef.current.count = guiState.dropCount;
    }

    // Render collision positions
    if (gl && "compute" in gl && "setRenderTarget" in gl) {
      scene.overrideMaterial = collisionSystem.collisionPosMaterial;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gl as any).setRenderTarget(collisionSystem.collisionPosRT);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gl as any).render(scene, collisionSystem.collisionCamera);

      // Compute particle updates
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gl as any).compute(computeUpdate);

      // Restore normal rendering
      scene.overrideMaterial = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gl as any).setRenderTarget(null);
    }
  });

  return (
    <>
      {/* Lights */}
      <directionalLight
        position={[3, 17, 17]}
        intensity={0.5}
        castShadow
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-camera-right={25}
        shadow-camera-left={-25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.01}
      />
      <ambientLight intensity={0.067} />

      {/* Rain particles */}
      <mesh ref={rainParticlesRef} material={rainMaterial}>
        <planeGeometry args={[0.1, 2]} />
      </mesh>

      {/* Ripple particles */}
      <mesh ref={rippleParticlesRef} geometry={rippleGeometry} material={rippleMaterial} />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial color={0x050505} />
      </mesh>

      {/* Collision box */}
      <mesh
        ref={collisionBoxRef}
        position={[0, 12, 0]}
        castShadow
        onUpdate={(self) => {
          self.layers.enable(1); // Add to collision layer while keeping layer 0
        }}
      >
        <boxGeometry args={[30, 1, 15]} />
        <meshStandardMaterial color={0x333333} />
      </mesh>

      {/* Monkey */}
      {monkeyGeometry && (
        <mesh
          ref={monkeyRef}
          geometry={monkeyGeometry}
          position={[0, 4.5, 0]}
          rotation={[0, Math.PI / 2, 0]}
          scale={5}
          receiveShadow
          onUpdate={(self) => {
            self.layers.enable(1); // Add to collision layer while keeping layer 0
          }}
        >
          <meshStandardMaterial roughness={1} metalness={0} />
        </mesh>
      )}

      {/* Humanoid Character */}
      <UniversalHumanoid
        position={[12, 0, 6]}
        scale={6}
        rotation={[0, -Math.PI / 6, 0]}
        onActionsReady={(actions) => {
          actions.Dance_Loop?.reset().fadeIn(0.3).play();
        }}
        onUpdate={(self) => {
          self.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.layers.enable(1);
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
        }}
      />

      <OrbitControls
        minDistance={5}
        maxDistance={50}
        target={[0, 0, 0]}
      />
      
      <StatsGl className="absolute top-4 left-4" />
    </>
  );
}

interface ControlsProps {
  guiState: {
    position: number;
    scale: number;
    dropCount: number;
  };
  setGuiState: React.Dispatch<React.SetStateAction<{
    position: number;
    scale: number;
    dropCount: number;
  }>>;
}

function Controls({ guiState, setGuiState }: ControlsProps) {
  return (
    <div className="absolute top-4 right-4 bg-black/80 text-white p-4 rounded-lg font-mono text-sm space-y-3 min-w-[250px]">
      <h3 className="text-lg font-bold mb-2">GPU Rain Controls</h3>
      
      <div>
        <label htmlFor="position-slider" className="block mb-1">
          Position: {guiState.position.toFixed(3)}
        </label>
        <input
          id="position-slider"
          type="range"
          min={-50}
          max={50}
          step={0.001}
          value={guiState.position}
          onChange={(e) =>
            setGuiState({ ...guiState, position: parseFloat(e.target.value) })
          }
          className="w-full"
        />
      </div>

      <div>
        <label htmlFor="scale-slider" className="block mb-1">
          Scale: {guiState.scale.toFixed(2)}
        </label>
        <input
          id="scale-slider"
          type="range"
          min={0.1}
          max={3.5}
          step={0.01}
          value={guiState.scale}
          onChange={(e) =>
            setGuiState({ ...guiState, scale: parseFloat(e.target.value) })
          }
          className="w-full"
        />
      </div>

      <div>
        <label htmlFor="count-slider" className="block mb-1">
          Drop Count: {guiState.dropCount}
        </label>
        <input
          id="count-slider"
          type="range"
          min={200}
          max={maxParticleCount}
          step={1}
          value={guiState.dropCount}
          onChange={(e) =>
            setGuiState({ ...guiState, dropCount: parseInt(e.target.value) })
          }
          className="w-full"
        />
      </div>
    </div>
  );
}

export default function GPURainPage() {
  const [guiState, setGuiState] = useState({
    position: 0,
    scale: 3.5,
    dropCount: instanceCount,
  });

  return (
    <div className="w-full h-screen">
      <Canvas
        camera={{ position: [40, 8, 0], fov: 60, near: 0.1, far: 110 }}
        gl={async (props) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const renderer = new THREE.WebGPURenderer({
            ...props,
            antialias: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
          await renderer.init();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return renderer as any;
        }}
      >
        <RainScene guiState={guiState} />
      </Canvas>
      <Controls guiState={guiState} setGuiState={setGuiState} />
    </div>
  );
}

