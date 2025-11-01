"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Rapier from "@dimforge/rapier3d-compat";
import { getPositionsAndIndices } from "navcat/three";
import * as THREE from "three/webgpu";

import type { NavcatDynamicSceneOptions } from "@/lib/navcat-dynamic-objects";
import { createNavcatDynamicObjectsScene } from "@/lib/navcat-dynamic-objects";
import { BUILDINGS } from "@/lib/bunker-world";

type EnvironmentBuilder = NonNullable<NavcatDynamicSceneOptions["createEnvironment"]>;

const GROUND_SIZE = 60;

const buildBunkerEnvironment: EnvironmentBuilder = async ({ scene }) => {
    const createdObjects: THREE.Object3D[] = [];
    const createdMeshes: THREE.Mesh[] = [];
    const walkableMeshes: THREE.Mesh[] = [];

    const addObject = <T extends THREE.Object3D>(object: T): T => {
        createdObjects.push(object);
        scene.add(object);
        return object;
    };

    const addMesh = (mesh: THREE.Mesh, includeInNavMesh = false): THREE.Mesh => {
        createdMeshes.push(mesh);
        addObject(mesh);
        if (includeInNavMesh) {
            walkableMeshes.push(mesh);
        }
        return mesh;
    };

    scene.background = new THREE.Color(0x030712);
    scene.fog = new THREE.Fog(0x030712, 80, 180);

    addObject(new THREE.AmbientLight(0xffffff, 0.35));

    const sunLight = addObject(new THREE.DirectionalLight(0xfff2e0, 1.2));
    sunLight.castShadow = true;
    sunLight.position.set(25, 30, 15);
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 120;
    sunLight.shadow.camera.left = -50;
    sunLight.shadow.camera.right = 50;
    sunLight.shadow.camera.top = 50;
    sunLight.shadow.camera.bottom = -50;

    const fillLight = addObject(new THREE.DirectionalLight(0x335eff, 0.35));
    fillLight.position.set(-30, 20, -25);

    const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 1, 1);
    groundGeometry.rotateX(-Math.PI / 2);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9, metalness: 0.05 });
    addMesh(new THREE.Mesh(groundGeometry, groundMaterial), true).receiveShadow = true;

    const courtyardGeometry = new THREE.CircleGeometry(6, 48);
    courtyardGeometry.rotateX(-Math.PI / 2);
    const courtyardMaterial = new THREE.MeshStandardMaterial({ color: 0x2f3640, roughness: 0.8, metalness: 0.05 });
    const courtyard = addMesh(new THREE.Mesh(courtyardGeometry, courtyardMaterial));
    courtyard.position.set(0, 0.02, 0);
    courtyard.receiveShadow = true;

    const walkwayMaterial = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.85, metalness: 0.08 });
    const walkwayGeometry = new THREE.BoxGeometry(8, 0.2, 16);
    const walkway = addMesh(new THREE.Mesh(walkwayGeometry, walkwayMaterial));
    walkway.position.set(-5, 0.1, 4);
    walkway.receiveShadow = true;

    const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_SIZE / 2, 0x4b5563, 0x374151);
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.35;
    addObject(grid);

    const buildingStaticObstacles: { position: [number, number, number]; radius: number; height?: number }[] = [];

    type DoorFace = "north" | "south" | "east" | "west";

    const getDoorTransform = (
        face: DoorFace,
        size: [number, number, number],
        doorSize: [number, number],
        offset = 0,
    ) => {
        const [width, height, depth] = size;
        const doorY = -height / 2 + doorSize[1] / 2;
        switch (face) {
            case "east":
                return {
                    position: new THREE.Vector3(width / 2 + 0.11, doorY, offset),
                    rotation: new THREE.Euler(0, Math.PI / 2, 0),
                };
            case "west":
                return {
                    position: new THREE.Vector3(-width / 2 - 0.11, doorY, offset),
                    rotation: new THREE.Euler(0, Math.PI / 2, 0),
                };
            case "south":
                return {
                    position: new THREE.Vector3(offset, doorY, depth / 2 + 0.11),
                    rotation: new THREE.Euler(0, 0, 0),
                };
            case "north":
            default:
                return {
                    position: new THREE.Vector3(offset, doorY, -depth / 2 - 0.11),
                    rotation: new THREE.Euler(0, 0, 0),
                };
        }
    };

    const buildingMaterials = {
        STORAGE: new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.75, metalness: 0.12 }),
        BUNKER: new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.7, metalness: 0.18 }),
    } as const;
    const sharedMaterials: THREE.Material[] = Object.values(buildingMaterials);

    for (const [name, building] of Object.entries(BUILDINGS)) {
        const baseMaterial = buildingMaterials[name as keyof typeof buildingMaterials] ?? new THREE.MeshStandardMaterial({ color: 0x4b5563 });
        const [width, height, depth] = building.size;
        const [cx, cy, cz] = building.center;

        const buildingGroup = addObject(new THREE.Group());
        buildingGroup.position.set(cx, cy + height / 2, cz);

        const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), baseMaterial.clone());
        body.castShadow = true;
        body.receiveShadow = true;
        buildingGroup.add(body);
        createdMeshes.push(body);

        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9, metalness: 0.05 });
        const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.7, 0.3, depth + 0.7), roofMaterial);
        roof.position.y = height / 2 + 0.15;
        roof.castShadow = true;
        roof.receiveShadow = true;
        buildingGroup.add(roof);
        createdMeshes.push(roof);

        const doorTransform = getDoorTransform(
            building.doorFace as DoorFace,
            building.size,
            building.doorSize,
            building.doorOffset ?? 0,
        );
        const doorMaterial = new THREE.MeshStandardMaterial({ color: name === "BUNKER" ? 0x7c2d12 : 0xa16207, roughness: 0.6, metalness: 0.35 });
        const door = new THREE.Mesh(new THREE.BoxGeometry(building.doorSize[0], building.doorSize[1], 0.2), doorMaterial);
        door.position.copy(doorTransform.position);
        door.rotation.copy(doorTransform.rotation);
        door.castShadow = true;
        buildingGroup.add(door);
        createdMeshes.push(door);

        const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.25 });
        const doorFrame = new THREE.Mesh(
            new THREE.BoxGeometry(building.doorSize[0] + 0.25, building.doorSize[1] + 0.25, 0.12),
            frameMaterial,
        );
        doorFrame.position.copy(doorTransform.position);
        doorFrame.rotation.copy(doorTransform.rotation);
        doorFrame.castShadow = true;
        buildingGroup.add(doorFrame);
        createdMeshes.push(doorFrame);

        buildingStaticObstacles.push({
            position: [cx, cy, cz],
            radius: Math.max(width, depth) * 0.6,
            height,
        });
    }

    const sceneProps = new THREE.Group();
    addObject(sceneProps);

    const accentLight = new THREE.PointLight(0x22d3ee, 2.4, 18, 1.8);
    accentLight.position.set(-12, 4, 6);
    sceneProps.add(accentLight);

    const bunkerLight = new THREE.PointLight(0xfacc15, 1.8, 16, 2.2);
    bunkerLight.position.set(15, 4, 0);
    sceneProps.add(bunkerLight);

    const [navMeshPositions, navMeshIndices] = getPositionsAndIndices(walkableMeshes);

    return {
        walkableMeshes,
        navMeshGeometry: { positions: navMeshPositions, indices: navMeshIndices },
        staticObstacles: buildingStaticObstacles,
        setupPhysicsWorld: ({ physicsWorld }) => {
            const groundBody = physicsWorld.createRigidBody(
                Rapier.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0),
            );
            const groundCollider = Rapier.ColliderDesc.cuboid(GROUND_SIZE / 2, 0.1, GROUND_SIZE / 2);
            groundCollider.setFriction(0.9);
            groundCollider.setRestitution(0.1);
            physicsWorld.createCollider(groundCollider, groundBody);

            for (const building of Object.values(BUILDINGS)) {
                const [width, height, depth] = building.size;
                const [cx, cy, cz] = building.center;
                const rigidBody = physicsWorld.createRigidBody(
                    Rapier.RigidBodyDesc.fixed().setTranslation(cx, cy + height / 2, cz),
                );
                const collider = Rapier.ColliderDesc.cuboid(width / 2, height / 2, depth / 2);
                collider.setFriction(0.8);
                collider.setRestitution(0.05);
                physicsWorld.createCollider(collider, rigidBody);
            }
        },
        cleanup: () => {
            for (const material of sharedMaterials) {
                material.dispose?.();
            }
            for (const mesh of createdMeshes) {
                if (mesh.parent) {
                    mesh.parent.remove(mesh);
                }
                mesh.geometry.dispose();
                const material = mesh.material;
                if (Array.isArray(material)) {
                    for (const mat of material) {
                        mat.dispose?.();
                    }
                } else {
                    material.dispose?.();
                }
            }
            for (const object of createdObjects) {
                if (object.parent) {
                    object.parent.remove(object);
                }
            }
        },
    };
};

export default function NavcatBunkerPage() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);

    const options = useMemo<NavcatDynamicSceneOptions>(
        () => ({
            createEnvironment: buildBunkerEnvironment,
            initialCameraPosition: [24, 18, 28],
            initialCameraTarget: [0, 3, 0],
        }),
        [],
    );

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let disposed = false;
        let handle: Awaited<ReturnType<typeof createNavcatDynamicObjectsScene>> | null = null;

        createNavcatDynamicObjectsScene(container, options)
            .then((result) => {
                if (disposed) {
                    result.dispose();
                    return;
                }
                handle = result;
                setIsReady(true);
            })
            .catch((err) => {
                console.error(err);
                setError(err instanceof Error ? err.message : "Failed to initialize bunker scene");
            });

        return () => {
            disposed = true;
            if (handle) {
                handle.dispose();
            }
        };
    }, [options]);

    return (
        <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-black text-white">
            <div ref={containerRef} className="h-screen w-full" id="navcat-bunker-root" />

            <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-sm space-y-3 rounded-lg bg-black/70 p-4 text-sm leading-relaxed shadow-lg">
                <h1 className="text-lg font-semibold">Navcat Bunker Dynamics</h1>
                <p>
                    Crowd agents navigate the bunker courtyard using Navcat pathfinding while Rapier-controlled debris keeps the
                    navmesh rebuilding.
                </p>
                <p>
                    Click anywhere on the ground to retarget the cats. Falling crates, barrels, and spheres will punch holes in the
                    navmesh as they roll through the buildings.
                </p>
                <p>Use the GUI to toggle path visualization or tweak the corner limit. Orbit, pan, and zoom with the mouse.</p>
                {!isReady && !error && <p className="animate-pulse text-yellow-300">Loading WebGPU bunker scene…</p>}
                {error && <p className="text-red-400">{error}</p>}
            </div>

            <div className="pointer-events-auto absolute bottom-4 right-4 z-10">
                <a
                    href="/"
                    className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-medium uppercase tracking-wide text-white shadow hover:bg-blue-600"
                >
                    ← Back to Home
                </a>
            </div>
        </div>
    );
}

