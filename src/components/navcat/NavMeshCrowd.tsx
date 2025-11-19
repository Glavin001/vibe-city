"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { findNearestPoly, createFindNearestPolyResult, DEFAULT_QUERY_FILTER } from "navcat";
import { crowd } from "navcat/blocks";
import type { NavMesh, Vec3 } from "navcat";
import * as THREE from "three";

export type NavMeshCrowdProps = {
  navMesh: NavMesh | null;
  agentCount?: number;
  onTargetSet?: (target: Vec3) => void;
};

type AgentVisual = {
  mesh: THREE.Mesh;
  agentId: string;
};

function createAgentVisual(position: Vec3, color: number, radius: number): THREE.Mesh {
  // Create a simple capsule using cylinder + spheres for visual
  // Since CapsuleGeometry might not be available, use cylinder geometry
  const geometry = new THREE.CylinderGeometry(radius, radius, radius * 2, 16);
  const material = new THREE.MeshStandardMaterial({ 
    color,
    emissive: color,
    emissiveIntensity: 0.3,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1] + radius, position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

export function NavMeshCrowd({ navMesh, agentCount = 3, onTargetSet }: NavMeshCrowdProps) {
  const { scene, camera, gl } = useThree();
  const crowdRef = useRef<ReturnType<typeof crowd.create> | null>(null);
  const agentVisualsRef = useRef<AgentVisual[]>([]);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // Create crowd and agents
  useEffect(() => {
    if (!navMesh) return;

    // Create crowd
    const catsCrowd = crowd.create(1);
    crowdRef.current = catsCrowd;

    // Agent parameters
    const agentParams: crowd.AgentParams = {
      radius: 0.3,
      height: 0.6,
      maxAcceleration: 15.0,
      maxSpeed: 3.5,
      collisionQueryRange: 2,
      separationWeight: 0.5,
      updateFlags:
        crowd.CrowdUpdateFlags.ANTICIPATE_TURNS |
        crowd.CrowdUpdateFlags.SEPARATION |
        crowd.CrowdUpdateFlags.OBSTACLE_AVOIDANCE |
        crowd.CrowdUpdateFlags.OPTIMIZE_TOPO |
        crowd.CrowdUpdateFlags.OPTIMIZE_VIS,
      queryFilter: DEFAULT_QUERY_FILTER,
      autoTraverseOffMeshConnections: true,
      obstacleAvoidance: crowd.DEFAULT_OBSTACLE_AVOIDANCE_PARAMS,
    };

    // Agent colors (different colors for each)
    const colors = [0xff6b6b, 0x4ecdc4, 0x95e1d3, 0xf38181, 0xaa96da];

    // Create agents with initial positions spread around the courtyard
    const agentVisuals: AgentVisual[] = [];
    for (let i = 0; i < agentCount; i++) {
      // Spread agents around a circle
      const angle = (i / agentCount) * Math.PI * 2;
      const radius = 8;
      const initialPos: Vec3 = [
        Math.cos(angle) * radius,
        0.5,
        Math.sin(angle) * radius,
      ];

      // Find nearest valid position on navmesh
      const halfExtents: Vec3 = [2, 2, 2];
      const nearestResult = findNearestPoly(
        createFindNearestPolyResult(),
        navMesh,
        initialPos,
        halfExtents,
        DEFAULT_QUERY_FILTER,
      );

      if (!nearestResult.success) continue;

      // Add agent to crowd
      const agentId = crowd.addAgent(catsCrowd, navMesh, nearestResult.position, agentParams);

      // Create visual mesh
      const color = colors[i % colors.length];
      const mesh = createAgentVisual(nearestResult.position, color, agentParams.radius);
      scene.add(mesh);

      agentVisuals.push({ mesh, agentId });
    }

    agentVisualsRef.current = agentVisuals;

    // Click handler for setting targets
    const onPointerDown = (event: MouseEvent) => {
      if (event.button !== 0 || !navMesh || !catsCrowd) return;

      const rect = gl.domElement.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, camera);

      // Raycast against a ground plane (or use any walkable mesh)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersectPoint = new THREE.Vector3();
      raycasterRef.current.ray.intersectPlane(plane, intersectPoint);

      if (!intersectPoint) return;

      const targetPosition: Vec3 = [intersectPoint.x, intersectPoint.y, intersectPoint.z];

      // Find nearest valid poly on navmesh
      const halfExtents: Vec3 = [2, 2, 2];
      const nearestResult = findNearestPoly(
        createFindNearestPolyResult(),
        navMesh,
        targetPosition,
        halfExtents,
        DEFAULT_QUERY_FILTER,
      );

      if (!nearestResult.success) return;

      // Set target for all agents
      for (const { agentId } of agentVisuals) {
        crowd.requestMoveTarget(catsCrowd, agentId, nearestResult.nodeRef, nearestResult.position);
      }

      if (onTargetSet) {
        onTargetSet(nearestResult.position);
      }
    };

    gl.domElement.addEventListener("pointerdown", onPointerDown);

    return () => {
      gl.domElement.removeEventListener("pointerdown", onPointerDown);

      // Cleanup agents
      for (const { mesh, agentId } of agentVisuals) {
        if (catsCrowd) {
          crowd.removeAgent(catsCrowd, agentId);
        }
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }

      // Note: crowd.destroy() doesn't exist - crowd is cleaned up automatically when agents are removed
      agentVisualsRef.current = [];
      crowdRef.current = null;
    };
  }, [navMesh, agentCount, scene, camera, gl, onTargetSet]);

  // Update crowd and agent visuals each frame
  useFrame((_, delta) => {
    const catsCrowd = crowdRef.current;
    if (!catsCrowd || !navMesh) return;

    const clampedDelta = Math.min(delta, 0.1);
    crowd.update(catsCrowd, navMesh, clampedDelta);

    // Update agent visuals to match crowd positions
    for (const { mesh, agentId } of agentVisualsRef.current) {
      const agent = catsCrowd.agents[agentId];
      if (!agent) continue;

      const [x, y, z] = agent.position;
      mesh.position.set(x, y, z);

      // Rotate mesh to face movement direction
      if (agent.velocity && (agent.velocity[0] !== 0 || agent.velocity[2] !== 0)) {
        const angle = Math.atan2(agent.velocity[0], agent.velocity[2]);
        mesh.rotation.y = angle;
      }
    }
  });

  return null;
}

