import type { Meta, StoryObj } from '@storybook/react';
import { RigidBody, CuboidCollider, CylinderCollider, BallCollider, Physics, RapierRigidBody } from '@react-three/rapier';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Box, Sphere, Cylinder, Grid, Environment, Line } from '@react-three/drei';
import { init as initRecast } from 'recast-navigation';
import React, { useRef, useState, useEffect, useMemo, useCallback, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRapierNavMesh } from '../../lib/navigation/useRapierNavMesh';
import { NavMeshDebug } from '../../lib/navigation/navigation';
import { Agent } from '../../lib/navigation/crowd-agent';
import { useNavigation } from '../../lib/navigation/useNavigation';
import type { CrowdAgent, NavMeshQuery } from 'recast-navigation';
import { Entity } from '../../store/ecs';

export default {
  title: 'Scenes/RapierNavMesh',
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    showDebug: {
      control: 'boolean',
      description: 'Show NavMesh Debug visualization',
    },
    showCrowd: {
      control: 'boolean',
      description: 'Show crowd agents',
    },
    crowdAgentCount: {
      control: { type: 'range', min: 1, max: 50, step: 1 },
      description: 'Number of crowd agents',
    },
    showMovingBoxes: {
      control: 'boolean',
      description: 'Show moving boxes',
    },
    showBouncingBalls: {
      control: 'boolean',
      description: 'Show bouncing balls',
    },
    showRamps: {
      control: 'boolean',
      description: 'Show ramps',
    },
    showFloor: {
      control: 'boolean',
      description: 'Show floor',
    },
    showWalls: {
      control: 'boolean',
      description: 'Show walls',
    },
    showStaticObstacles: {
      control: 'boolean',
      description: 'Show static obstacles',
    },
    showDynamicStack: {
      control: 'boolean',
      description: 'Show dynamic stack',
    },
    showStressTest: {
      control: 'boolean',
      description: 'Show stress test objects',
    },
    stressTestCount: {
      control: { type: 'range', min: 10, max: 300, step: 10 },
      description: 'Number of stress test objects',
    },
    resetInterval: {
      control: { type: 'range', min: 1000, max: 10000, step: 1000 },
      description: 'Reset interval in milliseconds',
    },
    showBallPit: {
      control: 'boolean',
      description: 'Show ball pit',
    },
    showAgentPaths: {
      control: 'boolean',
      description: 'Show agent paths to target',
    },
  },
} as Meta;

interface RapierNavMeshDemoProps {
  showDebug?: boolean;
  showCrowd?: boolean;
  crowdAgentCount?: number;
  showMovingBoxes?: boolean;
  showBouncingBalls?: boolean;
  showRamps?: boolean;
  showFloor?: boolean;
  showWalls?: boolean;
  showStaticObstacles?: boolean;
  showDynamicStack?: boolean;
  showStressTest?: boolean;
  stressTestCount?: number;
  resetInterval?: number;
  showBallPit?: boolean;
  showAgentPaths?: boolean;
}

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
  const rigidBodyRef = useRef<RapierRigidBody>(null);

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
    const rigidBodyRef = useRef<RapierRigidBody>(null);
    const initialImpulse = useMemo(() => {
      return new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 5, (Math.random() - 0.5) * 10);
    }, []);

    // Forward the rigidBodyRef to the parent component
    useImperativeHandle(ref, () => rigidBodyRef.current);

    // Apply initial impulse when the object is created
    useEffect(() => {
      const body = rigidBodyRef.current;
      if (body) {
        // Small delay to ensure physics is initialized
        const timeoutId = setTimeout(() => {
          body.applyImpulse(initialImpulse, true);
          body.applyTorqueImpulse(
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

const RapierNavMeshDemoComponent: React.FC<RapierNavMeshDemoProps> = ({
  showDebug = true,
  showCrowd = true,
  crowdAgentCount = 10,
  showMovingBoxes = true,
  showBouncingBalls = true,
  showRamps = true,
  showFloor = true,
  showWalls = true,
  showStaticObstacles = true,
  showDynamicStack = true,
  showStressTest = false,
  stressTestCount = 100,
  resetInterval = 5000,
  showBallPit = true,
  showAgentPaths = true,
}) => {
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

          <PhysicsNavMeshScene showDebug={showDebug} showCrowd={showCrowd} crowdAgentCount={crowdAgentCount} showAgentPaths={showAgentPaths} />
        </Physics>

        <OrbitControls />
      </Canvas>
    </div>
  );
};

export const RapierNavMeshDemo: StoryObj<RapierNavMeshDemoProps> = {
  render: (args) => <RapierNavMeshDemoComponent {...args} />,
  args: {
    showDebug: true,
    showCrowd: true,
    crowdAgentCount: 10,
    showMovingBoxes: true,
    showBouncingBalls: true,
    showRamps: true,
    showFloor: true,
    showWalls: true,
    showStaticObstacles: true,
    showDynamicStack: true,
    showStressTest: false,
    stressTestCount: 100,
    resetInterval: 5000,
    showBallPit: true,
    showAgentPaths: true,
  },
};

interface PhysicsNavMeshSceneProps {
  showDebug: boolean;
  showCrowd: boolean;
  crowdAgentCount: number;
  showAgentPaths: boolean;
}

const PhysicsNavMeshScene: React.FC<PhysicsNavMeshSceneProps> = ({ showDebug, showCrowd, crowdAgentCount, showAgentPaths }) => {
  // Use the hook to generate the navmesh from physics colliders
  useRapierNavMesh({
    navMeshUpdateThrottle: 300,
  });

  return (
    <>
      <NavMeshDebug enabled={showDebug} />
      {showCrowd && <CrowdAgents agentCount={crowdAgentCount} showPaths={showAgentPaths} />}
    </>
  );
};

// Component to manage crowd agents and moving target
const CrowdAgents: React.FC<{ agentCount: number; showPaths: boolean }> = ({ agentCount, showPaths }) => {
  const { navMeshQuery, crowd } = useNavigation();
  const [targetPosition, setTargetPosition] = useState<THREE.Vector3 | null>(null);
  const agentRefs = useRef<(CrowdAgent | undefined)[]>([]);
  const [agentPositions, setAgentPositions] = useState<THREE.Vector3[]>([]);
  const lastAgentCountRef = useRef(agentCount);
  const targetPositionRef = useRef<THREE.Vector3 | null>(null);

  // Keep target position in ref for agent creation
  useEffect(() => {
    targetPositionRef.current = targetPosition;
  }, [targetPosition]);

  // Initialize agents with random positions within the walls
  // Only reinitialize if agentCount changes
  useEffect(() => {
    if (!navMeshQuery || !crowd) return;

    // Only regenerate positions if agentCount has changed
    if (lastAgentCountRef.current === agentCount && agentPositions.length > 0) {
      return;
    }

    // Small delay to ensure navmesh is fully ready
    const timeoutId = setTimeout(() => {
      const positions: THREE.Vector3[] = [];
      for (let i = 0; i < agentCount; i++) {
        // Random position within walls (-40 to 40 to stay away from walls at -50/50)
        const x = (Math.random() - 0.5) * 80;
        const z = (Math.random() - 0.5) * 80;
        
        const { point } = navMeshQuery.findClosestPoint({ x, y: 0, z });
        positions.push(new THREE.Vector3(point.x, point.y, point.z));
      }
      setAgentPositions(positions);
      lastAgentCountRef.current = agentCount;
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [navMeshQuery, crowd, agentCount, agentPositions.length]);

  // Update target position every 10 seconds
  useEffect(() => {
    if (!navMeshQuery || !crowd) return;

    const updateTarget = () => {
      // Random position within walls (-40 to 40)
      const x = (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 80;
      
      const { point } = navMeshQuery.findClosestPoint({ x, y: 0, z });
      setTargetPosition(new THREE.Vector3(point.x, point.y, point.z));
    };

    // Set initial target after a small delay to ensure agents are created
    const initialTimeoutId = setTimeout(updateTarget, 200);

    // Update target every 10 seconds
    const intervalId = setInterval(updateTarget, 10000);

    return () => {
      clearTimeout(initialTimeoutId);
      clearInterval(intervalId);
    };
  }, [navMeshQuery, crowd]);

  // Request agents to move to target when it changes or when agents change
  useEffect(() => {
    if (!targetPosition || !crowd) return;

    // Send move command to all agents
    agentRefs.current.forEach((agent) => {
      if (agent) {
        agent.requestMoveTarget(targetPosition);
      }
    });
  }, [targetPosition, crowd]);
  
  // Periodically check and resend move commands to ensure all agents are moving
  useEffect(() => {
    if (!crowd || !targetPosition) return;

    const intervalId = setInterval(() => {
      agentRefs.current.forEach((agent) => {
        if (agent && targetPositionRef.current) {
          // Check if agent is idle (not moving)
          const velocity = agent.velocity();
          const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
          
          // If agent is basically stopped and we have a target, resend the command
          if (speed < 0.01) {
            agent.requestMoveTarget(targetPositionRef.current);
          }
        }
      });
    }, 500); // Check every 500ms

    return () => clearInterval(intervalId);
  }, [crowd, targetPosition]);
  
  // Callback to handle new agents - send them to target immediately
  const handleAgentRef = useCallback((index: number) => {
    return (agent: CrowdAgent | undefined) => {
      agentRefs.current[index] = agent;
      
      // If agent was just created and we have a target, send it there
      if (agent && targetPositionRef.current) {
        // Use setTimeout to ensure agent is fully initialized in the crowd system
        setTimeout(() => {
          if (agent && targetPositionRef.current) {
            agent.requestMoveTarget(targetPositionRef.current);
          }
        }, 100);
      }
    };
  }, []);

  if (agentPositions.length === 0) return null;

  return (
    <>
      {/* Render agents */}
      {agentPositions.map((position, i) => (
        <Entity key={`agent-${i}`}>
          <Agent
            ref={handleAgentRef(i)}
            initialPosition={[position.x, position.y, position.z]}
            radius={0.3}
            height={1.8}
            maxAcceleration={8.0}
            maxSpeed={3.5}
            collisionQueryRange={2.5}
            pathOptimizationRange={0.0}
            separationWeight={2.0}
          />
        </Entity>
      ))}

      {/* Visualize agents as cylinders */}
      {agentRefs.current.map((agent, i) => {
        if (!agent) return null;
        return <AgentVisual key={`visual-${i}`} agent={agent} />;
      })}

      {/* Visualize agent paths */}
      {showPaths && navMeshQuery && targetPosition && agentRefs.current.map((agent, i) => {
        if (!agent) return null;
        return <AgentPath key={`path-${i}`} agent={agent} target={targetPosition} navMeshQuery={navMeshQuery} />;
      })}

      {/* Visualize target */}
      {targetPosition && (
        <group position={targetPosition}>
          {/* Main target sphere */}
          <mesh position={[0, 0.5, 0]}>
            <sphereGeometry args={[0.8, 32, 32]} />
            <meshStandardMaterial color="lime" emissive="lime" emissiveIntensity={1.0} />
          </mesh>
          {/* Outer glow ring */}
          <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.8, 1.5, 32]} />
            <meshStandardMaterial 
              color="yellow" 
              emissive="yellow" 
              emissiveIntensity={0.8} 
              transparent 
              opacity={0.6}
            />
          </mesh>
          {/* Base marker */}
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[1.2, 1.5, 0.1, 32]} />
            <meshStandardMaterial 
              color="lime" 
              emissive="lime" 
              emissiveIntensity={0.5} 
              transparent 
              opacity={0.4}
            />
          </mesh>
        </group>
      )}
    </>
  );
};

// Component to visualize a single agent
const AgentVisual: React.FC<{ agent: CrowdAgent }> = ({ agent }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;

    const position = agent.position();
    const velocity = agent.velocity();
    
    meshRef.current.position.set(position.x, position.y, position.z);

    // Rotate agent to face movement direction
    if (velocity.x !== 0 || velocity.z !== 0) {
      const angle = Math.atan2(velocity.x, velocity.z);
      meshRef.current.rotation.y = angle;
    }
  });

  return (
    <mesh ref={meshRef}>
      <cylinderGeometry args={[0.3, 0.3, 1.8, 16]} />
      <meshStandardMaterial color="red" />
    </mesh>
  );
};

// Component to visualize an agent's path to target
const AgentPath: React.FC<{ 
  agent: CrowdAgent; 
  target: THREE.Vector3; 
  navMeshQuery: NavMeshQuery;
}> = ({ agent, target, navMeshQuery }) => {
  const [pathPoints, setPathPoints] = useState<THREE.Vector3[]>([]);

  useFrame(() => {
    const agentPos = agent.position();
    const start = { x: agentPos.x, y: agentPos.y, z: agentPos.z };
    const end = { x: target.x, y: target.y, z: target.z };

    try {
      const { path } = navMeshQuery.computePath(start, end);
      
      if (path && path.length > 0) {
        const points = path.map((p: { x: number; y: number; z: number }) => 
          new THREE.Vector3(p.x, p.y + 0.2, p.z)
        );
        setPathPoints(points);
      } else {
        setPathPoints([]);
      }
    } catch {
      // Path computation can fail if positions are invalid
      setPathPoints([]);
    }
  });

  if (pathPoints.length < 2) return null;

  return (
    <Line
      points={pathPoints}
      color="red"
      lineWidth={2}
      transparent
      opacity={0.6}
    />
  );
};
