"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";

import { VolumeTileSim } from "@/lib/three/volumetric-dust/VolumeTileSim";
import { VolumetricCompositePass } from "@/lib/three/volumetric-dust/VolumetricCompositePass";

const FULL_HEIGHT_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100vh",
  position: "relative",
};

export default function VolumetricDustPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    if (!renderer.capabilities.isWebGL2) {
      // eslint-disable-next-line no-console
      console.warn("Volumetric dust demo requires WebGL2.");
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111218);

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      200,
    );
    camera.position.set(6, 4, 8);
    camera.lookAt(0, 1.4, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(6, 10, 4);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    const roomSize = new THREE.Vector3(8, 4, 8);
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(roomSize.x, roomSize.y, roomSize.z),
      new THREE.MeshStandardMaterial({
        color: 0x383c40,
        metalness: 0,
        roughness: 0.9,
        side: THREE.BackSide,
      }),
    );
    room.position.y = roomSize.y * 0.5;
    scene.add(room);

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x2a2c30,
      metalness: 0,
      roughness: 1,
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(roomSize.x, roomSize.z),
      floorMat,
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const brickSize = new THREE.Vector3(0.19, 0.09, 0.057);
    const brick = new THREE.Mesh(
      new THREE.BoxGeometry(brickSize.x, brickSize.y, brickSize.z),
      new THREE.MeshStandardMaterial({
        color: 0x6d3a27,
        metalness: 0,
        roughness: 0.9,
      }),
    );
    brick.position.set(0, 1.2, 0);
    scene.add(brick);

    const GRID = 64;
    const tileSize = 3;
    const tileMin = new THREE.Vector3(-tileSize * 0.5, 0.4, -tileSize * 0.5);
    const tileMax = new THREE.Vector3(
      tileSize * 0.5,
      0.4 + tileSize,
      tileSize * 0.5,
    );

    const sim = new VolumeTileSim(renderer, GRID);

    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedShortType),
    });
    const composer = new EffectComposer(renderer, renderTarget);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const volumetricPass = new VolumetricCompositePass({
      densityAtlas: sim.getDensityTexture(),
      grid: GRID,
      tileMin,
      tileMax,
      kappa_m2_per_kg: 1,
      albedo: new THREE.Color(0.8, 0.75, 0.7),
      stepWorld: 0.05,
      maxSteps: 96,
    });
    composer.addPass(volumetricPass.pass);

    const tileBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          tileMax.x - tileMin.x,
          tileMax.y - tileMin.y,
          tileMax.z - tileMin.z,
        ),
      ),
      new THREE.LineBasicMaterial({
        color: 0x7fbfff,
        transparent: true,
        opacity: 0.25,
      }),
    );
    tileBox.position.copy(tileMin.clone().add(tileMax).multiplyScalar(0.5));
    scene.add(tileBox);

    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.left = "12px";
    overlay.style.top = "12px";
    overlay.style.color = "#eaecef";
    overlay.style.font = "600 12px system-ui, sans-serif";
    overlay.style.background = "rgba(0,0,0,0.4)";
    overlay.style.padding = "10px 12px";
    overlay.style.borderRadius = "8px";
    overlay.innerHTML = `
      <div><b>Volumetric dust (GPU) — demo</b></div>
      <div>Left-drag orbit, wheel zoom</div>
      <div>Click <button id="destroyBtn">Destroy brick</button> to spawn dust</div>
    `;
    container.appendChild(overlay);

    const destroyBtn = overlay.querySelector<HTMLButtonElement>("#destroyBtn");

    const brickDensitySolid = 2000;
    const airborneFrac = 0.03;
    const burstSeconds = 0.5;

    let injectTimer = 0;
    const emitterCenterLocal = new THREE.Vector3();
    let emitterMassRateKgPerSec = 0;

    const destroyBrick = () => {
      if (!brick.parent) return;
      scene.remove(brick);

      const volume = brickSize.x * brickSize.y * brickSize.z;
      const mass = brickDensitySolid * volume;
      const dustMass = mass * airborneFrac;

      emitterMassRateKgPerSec = dustMass / burstSeconds;
      injectTimer = burstSeconds;

      emitterCenterLocal.set(
        THREE.MathUtils.clamp(
          (brick.position.x - tileMin.x) / (tileMax.x - tileMin.x),
          0.01,
          0.99,
        ),
        THREE.MathUtils.clamp(
          (brick.position.y - tileMin.y) / (tileMax.y - tileMin.y),
          0.01,
          0.99,
        ),
        THREE.MathUtils.clamp(
          (brick.position.z - tileMin.z) / (tileMax.z - tileMin.z),
          0.01,
          0.99,
        ),
      );
    };

    destroyBtn?.addEventListener("click", destroyBrick);

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      composer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    onResize();

    const clock = new THREE.Clock();
    let frameId = 0;

    const animate = () => {
      const dt = Math.min(0.033, clock.getDelta());
      controls.update();

      let emit = false;
      const emitRadiusM = 0.35;

      if (injectTimer > 0) {
        emit = true;
        injectTimer -= dt;
        if (injectTimer <= 0) {
          injectTimer = 0;
          emitterMassRateKgPerSec = 0;
        }
      }

      sim.update(dt, {
        tileMin,
        tileMax,
        emit,
        emitterCenterLocal,
        emitterRadiusMeters: emitRadiusM,
        emitterMassRateKgPerSec,
        buoyancy: 0.25,
        densityDissipation: 0.985,
        velocityDamping: 0.997,
      });

      volumetricPass.setUniforms({
        densityAtlas: sim.getDensityTexture(),
        tileMin,
        tileMax,
        projectionMatrix: camera.projectionMatrix,
        invProjectionMatrix: camera.projectionMatrixInverse,
        viewMatrix: camera.matrixWorldInverse,
        invViewMatrix: camera.matrixWorld,
        voxelWorldSize: (tileMax.x - tileMin.x) / GRID,
      });

      composer.render();
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      destroyBtn?.removeEventListener("click", destroyBrick);
      controls.dispose();
      composer.dispose();
      sim.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      if (overlay.parentElement === container) {
        container.removeChild(overlay);
      }
    };
  }, []);

  return <div ref={containerRef} style={FULL_HEIGHT_STYLE} />;
}
