import type { Meta } from '@storybook/react';
import { RigidBody, CuboidCollider, CylinderCollider, BallCollider, Physics } from '@react-three/rapier';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Box, Sphere, Cylinder, Grid, Environment } from '@react-three/drei';
import { init as initRecast } from 'recast-navigation';
import React, { Suspense, useRef, useState, useEffect, useMemo, useCallback, useImperativeHandle } from 'react';
import { useControls } from 'leva';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRapierNavMesh } from '../../lib/navigation/useRapierNavMesh';
import { NavMeshDebug } from '../../lib/navigation/navigation';

export default {
  title: 'Scenes/RapierNavMesh',
  parameters: {
    layout: 'fullscreen',
  },
} as Meta;

interface MovingBoxProps {
  position: [number, number, number];
  color: string;
  mass?: number;
}

const MovingBox: React.FC<MovingBoxProps> = ({ position, color, mass = 1 }) => {
  const initialImpulse = useRef(
    new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(5),
  );

  return (
    <RigidBody
      position={position}
      mass={mass}
      type="dynamic"
      name={`moving-box-${color}`}
      userData={{ type: 'movingBox', color, mass, position }}
      onCollisionEnter={() => {
        initialImpulse.current
          .set(Math.random() - 0.5, 0, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(2);
      }}
      linearDamping={0.5}
    >
      <Box args={[1, 1, 1]}>
        <meshStandardMaterial color={color} />
      </Box>
    </RigidBody>
  );
};

interface BouncingBallProps {
  position: [number, number, number];
  radius?: number;
  color?: string;
}

const BouncingBall: React.FC<BouncingBallProps> = ({ position, radius = 0.5, color = 'red' }) => {
  const rigidBodyRef = useRef(null);

  useFrame(() => {
    // Apply small upward impulse periodically to keep the ball bouncing
    if (rigidBodyRef.current && Math.random() > 0.95) {
      rigidBodyRef.current.applyImpulse({ x: 0, y: 2 + Math.random() * 3, z: 0 }, true);
    }
  });

  return (
    <RigidBody
      position={position}
      mass={1}
      restitution={0.8}
      friction={0.1}
      linearDamping={0.1}
      ref={rigidBodyRef}
      name={`bouncing-ball-${color}`}
      userData={{ type: 'bouncingBall', color, radius, position }}
      colliders="ball"
    >
      <Sphere args={[radius]}>
        <meshStandardMaterial color={color} />
      </Sphere>
    </RigidBody>
  );
};

const Ramp: React.FC<{
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
}> = ({ position, rotation, size }) => {
  return (
    <RigidBody
      type="fixed"
      position={position}
      rotation={rotation}
      name={`ramp-${position[0]}-${position[2]}`}
      userData={{ type: 'ramp', position, rotation, size }}
    >
      <Box args={size}>
        <meshStandardMaterial color="slategrey" />
      </Box>
    </RigidBody>
  );
};

const Walls: React.FC = () => {
  return (
    <>
      {/* North wall */}
      <RigidBody type="fixed" name="wall-north" userData={{ type: 'wall', direction: 'north', position: [0, 2, -50] }}>
        <CuboidCollider args={[50, 2, 0.5]} position={[0, 2, -50]} />
        <Box args={[100, 4, 1]} position={[0, 2, -50]}>
          <meshStandardMaterial color="slategrey" opacity={0.8} transparent />
        </Box>
      </RigidBody>

      {/* South wall */}
      <RigidBody type="fixed" name="wall-south" userData={{ type: 'wall', direction: 'south', position: [0, 2, 50] }}>
        <CuboidCollider args={[50, 2, 0.5]} position={[0, 2, 50]} />
        <Box args={[100, 4, 1]} position={[0, 2, 50]}>
          <meshStandardMaterial color="slategrey" opacity={0.8} transparent />
        </Box>
      </RigidBody>

      {/* East wall */}
      <RigidBody type="fixed" name="wall-east" userData={{ type: 'wall', direction: 'east', position: [50, 2, 0] }}>
        <CuboidCollider args={[0.5, 2, 50]} position={[50, 2, 0]} />
        <Box args={[1, 4, 100]} position={[50, 2, 0]}>
          <meshStandardMaterial color="slategrey" opacity={0.8} transparent />
        </Box>
      </RigidBody>

      {/* West wall */}
      <RigidBody type="fixed" name="wall-west" userData={{ type: 'wall', direction: 'west', position: [-50, 2, 0] }}>
        <CuboidCollider args={[0.5, 2, 50]} position={[-50, 2, 0]} />
        <Box args={[1, 4, 100]} position={[-50, 2, 0]}>
          <meshStandardMaterial color="slategrey" opacity={0.8} transparent />
        </Box>
      </RigidBody>
    </>
  );
};

const Floor: React.FC<{ size?: number }> = ({ size = 300 }) => {
  return (
    <RigidBody type="fixed" name="floor" userData={{ type: 'floor' }}>
      <CuboidCollider args={[size / 2, 0.1, size / 2]} position={[0, -0.1, 0]} />
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[size, 0.2, size]} />
        <meshStandardMaterial color="#808080" />
      </mesh>
    </RigidBody>
  );
};

interface ObstaclesProps {
  showMovingBoxes: boolean;
  showBouncingBalls: boolean;
  showRamps: boolean;
  showStaticObstacles: boolean;
  showDynamicStack: boolean;
  showStressTest: boolean;
  stressTestCount: number;
  resetInterval: number;
  showBallPit: boolean;
}

const Obstacles: React.FC<ObstaclesProps> = ({
  showMovingBoxes,
  showBouncingBalls,
  showRamps,
  showStaticObstacles,
  showDynamicStack,
  showStressTest,
  stressTestCount,
  resetInterval,
  showBallPit,
}) => {
  return (
    <>
      {/* Static obstacles */}
      {showStaticObstacles && (
        <>
          <RigidBody
            type="fixed"
            position={[10, 2, 10]}
            name="static-cylinder"
            colliders={false}
            userData={{ type: 'staticObstacle', shape: 'cylinder', position: [10, 2, 10] }}
          >
            <CylinderCollider args={[2, 2]} />
            <Cylinder args={[2, 2, 4]}>
              <meshStandardMaterial color="gray" />
            </Cylinder>
          </RigidBody>

          <RigidBody
            type="fixed"
            position={[-15, 1.5, 5]}
            name="static-box-large"
            userData={{ type: 'staticObstacle', shape: 'box', position: [-15, 1.5, 5], size: [5, 3, 3] }}
          >
            <Box args={[5, 3, 3]}>
              <meshStandardMaterial color="gray" />
            </Box>
          </RigidBody>

          <RigidBody
            type="fixed"
            position={[0, 1, -20]}
            name="static-box-wall"
            userData={{ type: 'staticObstacle', shape: 'box', position: [0, 1, -20], size: [20, 2, 2] }}
          >
            <Box args={[20, 2, 2]}>
              <meshStandardMaterial color="gray" />
            </Box>
          </RigidBody>

          <RigidBody
            type="fixed"
            position={[-20, 1, 15]}
            name="static-sphere"
            userData={{ type: 'staticObstacle', shape: 'sphere', position: [-20, 1, 15], radius: 2 }}
            colliders="ball"
          >
            <Sphere args={[2]}>
              <meshStandardMaterial color="gray" />
            </Sphere>
          </RigidBody>
        </>
      )}

      {/* Moving obstacles with different colors */}
      {showMovingBoxes && (
        <>
          <MovingBox position={[5, 1, 0]} color="red" />
          <MovingBox position={[-5, 1, -5]} color="blue" />
          <MovingBox position={[15, 1, -15]} color="green" />
          <MovingBox position={[-10, 1, 10]} color="purple" />
          <MovingBox position={[20, 1, 20]} color="orange" />
          <MovingBox position={[-20, 1, -10]} color="cyan" />
          <MovingBox position={[0, 1, 15]} color="magenta" />
          <MovingBox position={[8, 1, -8]} color="yellow" />
        </>
      )}

      {/* Ramps */}
      {showRamps && (
        <>
          <Ramp position={[30, 5, 0]} rotation={[0, 0, Math.PI / 6]} size={[20, 0.5, 8]} />
          <Ramp position={[-30, 5, 0]} rotation={[0, 0, -Math.PI / 6]} size={[20, 0.5, 8]} />
          <Ramp position={[0, 5, 30]} rotation={[Math.PI / 6, 0, 0]} size={[8, 0.5, 20]} />
        </>
      )}

      {/* Bouncing balls */}
      {showBouncingBalls && (
        <>
          <BouncingBall position={[30, 15, 0]} radius={1} color="crimson" />
          <BouncingBall position={[28, 15, 2]} radius={0.7} color="gold" />
          <BouncingBall position={[32, 15, -2]} radius={0.8} color="lime" />
        </>
      )}

      {/* Stacked boxes for dynamic demonstration */}
      {showDynamicStack && <DynamicStack position={[0, 1, 0]} height={5} />}

      {/* Stress test objects */}
      {showStressTest && <StressTestObjects count={stressTestCount} resetInterval={resetInterval} />}

      {/* Ball Pit */}
      {showBallPit && <BallPit />}
    </>
  );
};

interface DynamicStackProps {
  position: [number, number, number];
  height: number;
}

const DynamicStack: React.FC<DynamicStackProps> = ({ position, height }) => {
  const boxes = [];
  const boxSize = 1;
  const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'cyan', 'magenta'];

  for (let i = 0; i < height; i++) {
    const boxPosition: [number, number, number] = [position[0], position[1] + i * boxSize + boxSize / 2, position[2]];
    const color = colors[i % colors.length];

    boxes.push(
      <RigidBody
        key={i}
        position={boxPosition}
        mass={1}
        name={`stack-box-${i}`}
        userData={{
          type: 'stackBox',
          stackIndex: i,
          position: boxPosition,
          color,
          stackOrigin: position,
        }}
      >
        <Box args={[boxSize, boxSize, boxSize]}>
          <meshStandardMaterial color={color} />
        </Box>
      </RigidBody>,
    );
  }

  return <>{boxes}</>;
};

// New component for stress testing with random objects
interface StressTestObjectsProps {
  count: number;
  resetInterval: number;
}

const StressTestObjects: React.FC<StressTestObjectsProps> = ({ count, resetInterval }) => {
  // Generate configs only once when component mounts or count changes
  const objectConfigs = useMemo(() => generateRandomObjectConfigs(count), [count]);
  // Create and maintain refs for all objects
  const rigidBodyRefs = useRef<Array<any>>(Array(count).fill(null));

  // Reset objects by repositioning them instead of remounting
  const resetObjects = useCallback(() => {
    rigidBodyRefs.current.forEach((ref, index) => {
      if (ref) {
        // Generate new random position
        const newHeight = 5 + Math.random() * 15;
        const newX = (Math.random() - 0.5) * 80;
        const newZ = (Math.random() - 0.5) * 80;

        // Set new position
        ref.setTranslation({ x: newX, y: newHeight, z: newZ }, true);

        // Reset velocity
        ref.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ref.setAngvel({ x: 0, y: 0, z: 0 }, true);

        // Apply new random impulse
        const initialImpulse = {
          x: (Math.random() - 0.5) * 10,
          y: Math.random() * 5,
          z: (Math.random() - 0.5) * 10,
        };

        // Apply random rotation
        const initialTorque = {
          x: (Math.random() - 0.5) * 5,
          y: (Math.random() - 0.5) * 5,
          z: (Math.random() - 0.5) * 5,
        };

        // Apply impulses after a small delay to ensure physics is updated
        setTimeout(() => {
          ref.applyImpulse(initialImpulse, true);
          ref.applyTorqueImpulse(initialTorque, true);
        }, 100);
      }
    });
  }, []);

  // Set up interval for resetting objects
  useEffect(() => {
    const intervalId = setInterval(resetObjects, resetInterval);
    return () => clearInterval(intervalId);
  }, [resetInterval, resetObjects]);

  return (
    <>
      {objectConfigs.map((config, index) => (
        <RandomPhysicsObject
          key={`static-${index}`}
          config={config}
          index={index}
          ref={(el) => {
            rigidBodyRefs.current[index] = el;
          }}
        />
      ))}
    </>
  );
};

// Types for random object generation
type ObjectType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'tetrahedron';
interface RandomObjectConfig {
  type: ObjectType;
  position: [number, number, number];
  rotation: [number, number, number];
  size: number;
  color: string;
  mass: number;
  isMetallic: boolean;
  roughness: number;
}

// Generate random configurations for objects
const generateRandomObjectConfigs = (count: number): RandomObjectConfig[] => {
  const configs: RandomObjectConfig[] = [];
  const colors = [
    'red',
    'blue',
    'green',
    'yellow',
    'purple',
    'orange',
    'cyan',
    'magenta',
    'crimson',
    'gold',
    'lime',
    'teal',
    'indigo',
    'violet',
    'coral',
    'turquoise',
  ];

  // Define a wider range of object types
  const objectTypes: ObjectType[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'tetrahedron'];

  for (let i = 0; i < count; i++) {
    // Random position within a 40x40 area, with height between 5-20
    const position: [number, number, number] = [
      (Math.random() - 0.5) * 80,
      5 + Math.random() * 15,
      (Math.random() - 0.5) * 80,
    ];

    // Random rotation
    const rotation: [number, number, number] = [
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    ];

    // Random size between 0.3 and 1.5
    const size = 0.3 + Math.random() * 1.2;

    // Random color
    const color = colors[Math.floor(Math.random() * colors.length)];

    // Random mass between 0.5 and 5
    const mass = 0.5 + Math.random() * 4.5;

    // Random object type
    const type = objectTypes[Math.floor(Math.random() * objectTypes.length)];

    // Random material properties
    const isMetallic = Math.random() > 0.7;
    const roughness = isMetallic ? 0.1 + Math.random() * 0.3 : 0.5 + Math.random() * 0.5;

    configs.push({
      type,
      position,
      rotation,
      size,
      color,
      mass,
      isMetallic,
      roughness,
    });
  }

  return configs;
};

// Component to render a random physics object based on its configuration
const RandomPhysicsObject = React.forwardRef<any, { config: RandomObjectConfig; index: number }>(
  ({ config, index }, ref) => {
    const { type, position, rotation, size, color, mass, isMetallic, roughness } = config;
    const rigidBodyRef = useRef(null);
    const initialImpulse = useMemo(() => {
      return new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 5, (Math.random() - 0.5) * 10);
    }, []);

    // Forward the rigidBodyRef to the parent component
    useImperativeHandle(ref, () => rigidBodyRef.current);

    // Apply initial impulse when the object is created
    useEffect(() => {
      if (rigidBodyRef.current) {
        // Small delay to ensure physics is initialized
        const timeoutId = setTimeout(() => {
          rigidBodyRef.current.applyImpulse(initialImpulse, true);
          rigidBodyRef.current.applyTorqueImpulse(
            {
              x: (Math.random() - 0.5) * 5,
              y: (Math.random() - 0.5) * 5,
              z: (Math.random() - 0.5) * 5,
            },
            true,
          );
        }, 100);

        return () => clearTimeout(timeoutId);
      }
    }, [initialImpulse]);

    // Shared material for all geometries
    const material = <meshStandardMaterial color={color} metalness={isMetallic ? 0.9 : 0} roughness={roughness} />;

    return (
      <RigidBody
        position={position}
        rotation={rotation}
        mass={mass}
        linearDamping={0.2}
        angularDamping={0.2}
        colliders="hull"
        ref={rigidBodyRef}
        name={`stress-${type}-${index}`}
        userData={{
          type: 'stressTest',
          objectType: type,
          index,
          color,
          mass,
          size,
          position,
          isMetallic,
          roughness,
        }}
        onCollisionEnter={() => {
          // Add random impulse on collision for more chaotic behavior
          if (rigidBodyRef.current && Math.random() > 0.7) {
            rigidBodyRef.current.applyImpulse(
              {
                x: (Math.random() - 0.5) * 3,
                y: Math.random() * 2,
                z: (Math.random() - 0.5) * 3,
              },
              true,
            );
          }
        }}
      >
        {type === 'box' && <Box args={[size, size, size]}>{material}</Box>}
        {type === 'sphere' && <Sphere args={[size * 0.5]}>{material}</Sphere>}
        {type === 'cylinder' && <Cylinder args={[size * 0.4, size * 0.4, size]}>{material}</Cylinder>}
        {type === 'cone' && <Cylinder args={[0, size * 0.5, size, 8]}>{material}</Cylinder>}
        {type === 'torus' && (
          <mesh>
            <torusGeometry args={[size * 0.4, size * 0.2, 16, 32]} />
            {material}
          </mesh>
        )}
        {type === 'tetrahedron' && (
          <mesh>
            <tetrahedronGeometry args={[size * 0.5]} />
            {material}
          </mesh>
        )}
      </RigidBody>
    );
  },
);

// Ball Pit component with 20 different sized balls
interface BallPitProps {
  position?: [number, number, number];
  radius?: number;
}

const BallPit: React.FC<BallPitProps> = ({ position = [-5, 10, -5], radius = 8 }) => {
  const colors = [
    '#FF5733',
    '#33FF57',
    '#3357FF',
    '#F3FF33',
    '#FF33F3',
    '#33FFF3',
    '#FF8033',
    '#8033FF',
    '#33FF80',
    '#FF3380',
    '#80FF33',
    '#3380FF',
    '#FFFF33',
    '#FF33FF',
    '#33FFFF',
    '#FFAA33',
    '#FF33AA',
    '#33FFAA',
    '#AA33FF',
    '#AAFF33',
  ];

  return (
    <>
      {/* Generate 30 balls with different sizes and colors */}
      {Array.from({ length: 30 }).map((_, i) => {
        // Random position within the container
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (radius * 0.8);
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;
        const ballPosition: [number, number, number] = [
          position[0] + x,
          position[1] + radius * 0.5 + Math.random() * radius * 0.5,
          position[2] + z,
        ];

        // Random size between 0.5 and 2.0
        const ballRadius = 0.5 + Math.random() * 1.5;
        const color = colors[i % colors.length];

        return (
          <RigidBody
            key={`ball-pit-ball-${i}`}
            position={ballPosition}
            mass={ballRadius}
            restitution={0.8}
            friction={0.2}
            linearDamping={0.2}
            angularDamping={0.2}
            colliders={false}
            name={`ball-pit-ball-${i}`}
            userData={{ type: 'ballPitBall', index: i, radius: ballRadius, color }}
          >
            <BallCollider args={[ballRadius]} />
            <Sphere args={[ballRadius]}>
              <meshStandardMaterial color={color} />
            </Sphere>
          </RigidBody>
        );
      })}
    </>
  );
};

// Initialize Recast outside the component (runs once when module loads)
let recastInitialized = false;
const recastInitPromise = (async () => {
  if (recastInitialized) return;
  try {
    console.log('Initializing Recast...');
    await initRecast();
    console.log('Recast initialized successfully');
    recastInitialized = true;
  } catch (error) {
    console.error('Error initializing Recast', error);
    throw error;
  }
})();

export const RapierNavMeshDemo: React.FC = () => {
  const [isReady, setIsReady] = useState(recastInitialized);

  useEffect(() => {
    if (!recastInitialized) {
      recastInitPromise.then(() => setIsReady(true));
    }
  }, []);

  if (!isReady) {
    return <div style={{ width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Loading Recast Navigation...
    </div>;
  }

  const {
    showDebug,
    showMovingBoxes,
    showBouncingBalls,
    showRamps,
    showFloor,
    showWalls,
    showStaticObstacles,
    showDynamicStack,
    showStressTest,
    stressTestCount,
    resetInterval,
    showBallPit,
  } = useControls({
    showDebug: {
      value: true,
      label: 'Show NavMesh Debug',
    },
    showMovingBoxes: {
      value: true,
      label: 'Show Moving Boxes',
    },
    showBouncingBalls: {
      value: true,
      label: 'Show Bouncing Balls',
    },
    showRamps: {
      value: true,
      label: 'Show Ramps',
    },
    showFloor: {
      value: true,
      label: 'Show Floor',
    },
    showWalls: {
      value: true,
      label: 'Show Walls',
    },
    showStaticObstacles: {
      value: true,
      label: 'Show Static Obstacles',
    },
    showDynamicStack: {
      value: true,
      label: 'Show Dynamic Stack',
    },
    showStressTest: {
      value: false,
      label: 'Show Stress Test',
    },
    stressTestCount: {
      value: 100,
      min: 10,
      max: 300,
      step: 10,
      label: 'Stress Test Object Count',
    },
    resetInterval: {
      value: 5000,
      min: 1000,
      max: 10000,
      step: 1000,
      label: 'Reset Interval (ms)',
    },
    showBallPit: {
      value: true,
      label: 'Show Ball Pit',
    },
  });

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <Canvas camera={{ position: [0, 30, 30], fov: 50 }}>
        <color attach="background" args={['#f0f0f0']} />
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[10, 10, 10]}
          intensity={1.0}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
          shadow-camera-near={0.1}
          shadow-camera-far={200}
        />
        <Environment preset="sunset" />

        <Physics debug={false}>
          {showFloor && (
            <>
              <Floor size={300} />
              <Grid args={[100, 100]} cellSize={5} cellThickness={0.5} sectionSize={5} />
            </>
          )}
          {showWalls && <Walls />}
          <Obstacles
            showMovingBoxes={showMovingBoxes}
            showBouncingBalls={showBouncingBalls}
            showRamps={showRamps}
            showStaticObstacles={showStaticObstacles}
            showDynamicStack={showDynamicStack}
            showStressTest={showStressTest}
            stressTestCount={stressTestCount}
            resetInterval={resetInterval}
            showBallPit={showBallPit}
          />

          <PhysicsNavMeshScene showDebug={showDebug} />
        </Physics>

        <OrbitControls />
      </Canvas>
    </div>
  );
};

interface PhysicsNavMeshSceneProps {
  showDebug: boolean;
}

const PhysicsNavMeshScene: React.FC<PhysicsNavMeshSceneProps> = ({ showDebug }) => {
  // Use the hook to generate the navmesh from physics colliders
  useRapierNavMesh({
    navMeshUpdateThrottle: 300,
  });

  return <NavMeshDebug enabled={showDebug} />;
};
