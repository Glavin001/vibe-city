'use client'

import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Physics, RigidBody, HeightfieldCollider, HeightfieldArgs } from '@react-three/rapier'
import { useMemo } from 'react'
import * as THREE from 'three'
import { PlaneGeometry } from 'three'

// Simple fallback implementation following the exact GitHub issue format
// IMPORTANT: For a heightfield with widthQuads x depthQuads quads, you must supply
// (widthQuads+1) * (depthQuads+1) height values in ROW-MAJOR order.
// Example: widthQuads=2, depthQuads=2 => 3x3 heights = 9 values.
// <HeightfieldCollider args={[2, 2, heights, { x: 1, y: 1, z: 1 }]} />
// See: https://github.com/pmndrs/react-three-rapier/issues/730#issuecomment-2734006659
function SimpleHeightfieldDemo() {
  /*
  // Simple 3x3 grid with 9 height values
  const heights = [0, 1, 0, 1, 2, 1, 0, 1, 0]
  const widthQuads = 2
  const depthQuads = 2
  const rows = depthQuads + 1
  const cols = widthQuads + 1
  const scale = { x: 1, y: 1, z: 1 }

  // Build a matching visual mesh for the heightfield (row-major indexing)
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(scale.x * widthQuads, scale.z * depthQuads, widthQuads, depthQuads)
    const position = geo.attributes.position
    for (let i = 0; i < position.count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      // IMPORTANT: We offset Z here because the mesh is rotated -90° around X.
      // Local +Z becomes world +Y after that rotation, matching Rapier's heightfield vertical axis.
      position.setZ(i, heights[row * cols + col] * scale.y)
    }
    geo.computeVertexNormals()
    return geo
  }, [cols])
  */

 const heightFieldHeight = 50;
 const heightFieldWidth = 50;
 const heightField = useMemo(() => Array.from({
   length: heightFieldHeight * heightFieldWidth
 }).map((_, index) => {
   return Math.random();
 }), []);

 const heightFieldGeometry = useMemo(() => {
    const heightFieldGeometry = new PlaneGeometry(
      heightFieldWidth,
      heightFieldHeight,
      heightFieldWidth - 1,
      heightFieldHeight - 1
    );

    heightField.forEach((v, index) => {
      heightFieldGeometry.attributes.position.array[index * 3 + 2] = v;
    });
    heightFieldGeometry.scale(1, -1, 1);
    heightFieldGeometry.rotateX(-Math.PI / 2);
    heightFieldGeometry.rotateY(-Math.PI / 2);
    heightFieldGeometry.computeVertexNormals();
    return heightFieldGeometry;
  }, [heightField]);

  const heightFieldArgs: HeightfieldArgs = useMemo(() => ([
    heightFieldWidth - 1,
    heightFieldWidth - 1,
    heightField,
    {
      x: heightFieldWidth,
      y: 1,
      z: heightFieldWidth
    }
  ]), [heightField]);

  return (
    <div className="w-full h-[80vh] bg-gradient-to-b from-sky-400 to-sky-200 rounded-lg overflow-hidden relative">
      <Canvas shadows camera={{ position: [5, 1, 5], fov: 60 }}>
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[10, 10, 5]}
          intensity={1}
          castShadow
        />

        <Physics gravity={[0, -9.81, 0]} debug>
          {/* Simple heightfield terrain following GitHub issue format */}
          {/*
          <RigidBody type="fixed" position={[0, 0, 0]} colliders={false}>
            <HeightfieldCollider args={[widthQuads, depthQuads, heights, scale]} />
            <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <meshLambertMaterial color="#4a7c59" wireframe={false} />
            </mesh>
          </RigidBody>
          */}
          <RigidBody
            type={"fixed"}
            position={[0, -2, 0]}
            colliders={false}
            name={"Floor"}
          >
            <mesh geometry={heightFieldGeometry} receiveShadow>
              <meshPhysicalMaterial side={2} color={"#4a7c59"} />
            </mesh>

            <HeightfieldCollider args={heightFieldArgs} />
          </RigidBody>

          {/* Falling box */}
          <RigidBody type="dynamic" position={[0, 5, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.5, 0.5, 0.5]} />
              <meshStandardMaterial color="#ff6b6b" />
            </mesh>
          </RigidBody>

          {/* Falling sphere */}
          <RigidBody type="dynamic" position={[1, 6, 1]}>
            <mesh castShadow>
              <sphereGeometry args={[0.25, 16, 16]} />
              <meshStandardMaterial color="#4ecdc4" />
            </mesh>
          </RigidBody>
        </Physics>

        <OrbitControls enablePan enableZoom enableRotate />
      </Canvas>

      <div className="absolute top-4 left-4 bg-black/80 text-white p-4 rounded-lg backdrop-blur-sm max-w-sm">
        <h3 className="text-lg font-bold mb-2">Simple Heightfield Test</h3>
        <div className="text-sm space-y-1">
          <p>• Simple 3×3 heightfield</p>
          <p>• Follows GitHub issue format</p>
          <p>• Fallback if main demo fails</p>
        </div>
      </div>
    </div>
  )
}

export default SimpleHeightfieldDemo
