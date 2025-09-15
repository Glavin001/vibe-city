'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { InstancedMesh2 } from '@three.ez/instanced-mesh'
import { useGLTF } from '@react-three/drei'
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

function StaticTrees() {
  const mesh = useMemo(() => {
    const trunk = new THREE.CylinderGeometry(0.1, 0.1, 1)
    const leaves = new THREE.ConeGeometry(0.5, 1, 8)
    leaves.translate(0, 1, 0)
    const geometry = mergeGeometries([trunk, leaves], true) as THREE.BufferGeometry
    const materials = [
      new THREE.MeshStandardMaterial({ color: '#8B4513' }),
      new THREE.MeshStandardMaterial({ color: '#228B22' }),
    ]
    const inst = new InstancedMesh2<THREE.BufferGeometry, THREE.Material[]>(
      geometry,
      materials,
    )
    const count = 200
    inst.addInstances(count, (obj) => {
      obj.position.set((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20)
      obj.updateMatrix()
    })
    return inst
  }, [])

  useEffect(() => () => {
    mesh.geometry.dispose()
    mesh.material.forEach((m) => m.dispose())
  }, [mesh])

  return <primitive object={mesh} />
}

const CHARACTER_URL =
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb'
useGLTF.preload(CHARACTER_URL)

function SkinnedCharacters() {
  const gltf = useGLTF(CHARACTER_URL) as GLTF
  const count = 10
  const { mesh, mixer } = useMemo(() => {
    const skinned = gltf.scene.getObjectByProperty('type', 'SkinnedMesh') as THREE.SkinnedMesh
    const geometry = skinned.geometry
    const material = skinned.material as THREE.Material
    const inst = new InstancedMesh2<THREE.BufferGeometry, THREE.Material>(
      geometry,
      material,
    )
    inst.initSkeleton(skinned.skeleton)
    inst.addInstances(count, (obj) => {
      obj.position.set((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10)
      obj.updateMatrix()
    })
    gltf.scene.traverse((o) => {
      o.visible = false
    })
    const mx = new THREE.AnimationMixer(gltf.scene)
    gltf.animations.forEach((clip) => {
      mx.clipAction(clip).play()
    })
    return { mesh: inst, mixer: mx }
  }, [gltf])

  useFrame((_, delta) => {
    mixer.update(delta)
    for (let i = 0; i < count; i++) mesh.setBonesAt(i)
  })

  useEffect(() => () => {
    mesh.dispose()
  }, [mesh])

  return (
    <>
      <primitive object={gltf.scene} />
      <primitive object={mesh} />
    </>
  )
}

export default function InstancedMeshPage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-8">
        <h1 className="text-4xl font-bold text-white mb-4">InstancedMesh2 Demo</h1>
        <p className="text-gray-300 mb-8">
          Demonstrates static trees and skinned character instances using InstancedMesh2.
        </p>
        <div className="w-full h-[600px] bg-black rounded-lg overflow-hidden">
          <Canvas camera={{ position: [10, 10, 10], fov: 50 }}>
            <Suspense fallback={null}>
              <ambientLight intensity={0.5} />
              <directionalLight position={[5, 10, 7.5]} intensity={1} />
              <StaticTrees />
              <SkinnedCharacters />
            </Suspense>
          </Canvas>
        </div>
        <div className="mt-6">
          <a
            href="/"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  )
}

