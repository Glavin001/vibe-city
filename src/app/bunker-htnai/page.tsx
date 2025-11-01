"use client";

import { CameraControls, Line, StatsGl } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type {
  BunkerGoals,
  BunkerWorldOverrides,
  NodeId,
  Vec3,
} from "../../lib/bunker-domain";
import { BUILDINGS, N, NODE_POS, planUsingPlanner } from "../../lib/bunker-domain";

// Shared node display utilities
const nodeOptions = [
  { id: N.COURTYARD, label: "Courtyard", category: "outdoor" },
  { id: N.TABLE, label: "Table", category: "outdoor" },
  { id: N.STORAGE_DOOR, label: "Storage Door", category: "storage" },
  { id: N.STORAGE_INT, label: "Storage Interior", category: "storage" },
  { id: N.C4_TABLE, label: "C4 Table", category: "storage" },
  { id: N.BUNKER_DOOR, label: "Bunker Door", category: "bunker" },
  { id: N.BUNKER_INT, label: "Bunker Interior", category: "bunker" },
  { id: N.STAR, label: "Star Location", category: "bunker" },
  { id: N.SAFE, label: "Safe Zone", category: "outdoor" },
];

const categoryColors = {
  outdoor: "bg-emerald-100 text-emerald-800",
  storage: "bg-amber-100 text-amber-800",
  bunker: "bg-purple-100 text-purple-800",
};

const categoryIcons = {
  outdoor: "🌿",
  storage: "📦",
  bunker: "🏰",
};

const NodeDisplay: FC<{ nodeId: NodeId }> = ({ nodeId }) => {
  const nodeOption = nodeOptions.find((opt) => opt.id === nodeId);

  if (!nodeOption) return <span className="text-white">Unknown</span>;

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${categoryColors[nodeOption.category as keyof typeof categoryColors]}`}
    >
      <span>
        {categoryIcons[nodeOption.category as keyof typeof categoryIcons]}
      </span>
      {nodeOption.label}
    </span>
  );
};

import PlannerControls from "../../components/PlannerControls";
import {
  AgentMesh,
  BoxMarker,
  Building,
  EnhancedObject,
  Ground,
  InventoryItem,
  LabelSprite,
  PickupAnimation,
  SmallSphere,
} from "../../lib/bunker-scene";

export default function BunkerHtnAiPage() {
  const [agentPos, setAgentPos] = useState<Vec3>(NODE_POS[N.COURTYARD]);
  const agentPosRef = useRef<Vec3>(agentPos);
  const [status, setStatus] = useState<string>("Idle");
  const [lastMs, setLastMs] = useState<number | null>(null);

  const [world, setWorld] = useState({
    agentAt: N.COURTYARD as NodeId,
    keyOnTable: true,
    c4Available: true,
    starPresent: true,
    hasKey: false,
    hasC4: false,
    hasStar: false,
    storageUnlocked: false,
    c4Placed: false,
    bunkerBreached: false,
  });

  const [boom, setBoom] = useState<{ at?: Vec3; t?: number }>({});
  const [pickupAnimations, setPickupAnimations] = useState<{
    [key: string]: {
      active: boolean;
      startPos: Vec3;
      endPos: Vec3;
      startTime: number;
      duration: number;
      type: "key" | "c4" | "star";
      color: string;
    };
  }>({});
  const [showPlanVis, setShowPlanVis] = useState(true);
  const [planLinePoints, setPlanLinePoints] = useState<Vec3[]>([]);
  const [planNodeMarkers, setPlanNodeMarkers] = useState<
    Array<{
      node: NodeId;
      pos: Vec3;
      steps: Array<{ step: number; text: string }>;
    }>
  >([]);
  const [hoveredNode, setHoveredNode] = useState<NodeId | null>(null);
  const PLAN_Y_OFFSET = 1.9;

  const nodeTitle: Record<NodeId, string> = {
    [N.COURTYARD]: "Courtyard",
    [N.TABLE]: "Table",
    [N.STORAGE_DOOR]: "Storage Door",
    [N.STORAGE_INT]: "Storage Interior",
    [N.C4_TABLE]: "C4 Table",
    [N.BUNKER_DOOR]: "Bunker Door",
    [N.BUNKER_INT]: "Bunker Interior",
    [N.STAR]: "Star",
    [N.SAFE]: "Blast Safe Zone",
  };

  const [autoRun, setAutoRun] = useState(false);
  const [initialState, setInitialState] = useState({
    agentAt: N.COURTYARD as NodeId,
    keyOnTable: true,
    c4Available: true,
    starPresent: true,
    hasKey: false,
    hasC4: false,
    hasStar: false,
    storageUnlocked: false,
    c4Placed: false,
    bunkerBreached: false,
  });
  const [goalState, setGoalState] = useState<{
    agentAt?: NodeId;
    hasKey?: boolean;
    hasC4?: boolean;
    bunkerBreached?: boolean;
    hasStar?: boolean;
  }>({
    hasStar: true,
  });

  useEffect(() => {
    agentPosRef.current = agentPos;
  }, [agentPos]);

  const apiRef = useRef<{
    moveTo: (n: NodeId) => Promise<void>;
    explodeAt: (n: NodeId) => Promise<void>;
    startPickupAnimation: (
      fromPos: Vec3,
      type: "key" | "c4" | "star",
      color: string,
    ) => Promise<void>;
    startPlacementAnimation: (
      toPos: Vec3,
      type: "key" | "c4" | "star",
      color: string,
    ) => Promise<void>;
  } | null>(null);

  if (apiRef.current == null) {
    apiRef.current = {
      moveTo: (n: NodeId) => animateMove(n),
      explodeAt: async (n: NodeId) => {
        const at = NODE_POS[n];
        setBoom({ at, t: performance.now() });
        await new Promise((r) => setTimeout(r, 500));
        setBoom({});
      },
      startPickupAnimation: (
        fromPos: Vec3,
        type: "key" | "c4" | "star",
        color: string,
      ) => {
        const animId = `${type}_${performance.now()}`;
        const agent = agentPosRef.current;
        const endPos: Vec3 = [agent[0], agent[1] + 1.5, agent[2]];
        return new Promise<void>((resolve) => {
          setPickupAnimations((prev) => ({
            ...prev,
            [animId]: {
              active: true,
              startPos: fromPos,
              endPos,
              startTime: performance.now(),
              duration: 800,
              type,
              color,
            },
          }));
          setTimeout(() => {
            setPickupAnimations((prev) => {
              const next = { ...prev };
              delete next[animId];
              return next;
            });
            resolve();
          }, 800);
        });
      },
      startPlacementAnimation: (
        toPos: Vec3,
        type: "key" | "c4" | "star",
        color: string,
      ) => {
        const animId = `${type}_placement_${performance.now()}`;
        const agent = agentPosRef.current;
        const startPos: Vec3 = [agent[0], agent[1] + 1.2, agent[2]];
        return new Promise<void>((resolve) => {
          setPickupAnimations((prev) => ({
            ...prev,
            [animId]: {
              active: true,
              startPos,
              endPos: toPos,
              startTime: performance.now(),
              duration: 600,
              type,
              color,
            },
          }));
          setTimeout(() => {
            setPickupAnimations((prev) => {
              const next = { ...prev };
              delete next[animId];
              return next;
            });
            resolve();
          }, 600);
        });
      },
    };
  }

  async function runHtnPlan() {
    setStatus("Planning...");
    setLastMs(null);
    const t0 = performance.now();

    const nextWorld = { ...initialState };
    setWorld(nextWorld);
    const startPos = NODE_POS[nextWorld.agentAt];
    agentPosRef.current = startPos;
    setAgentPos(startPos);

    const overrides: BunkerWorldOverrides = {
      agentAt: nextWorld.agentAt,
      keyOnTable: nextWorld.keyOnTable,
      c4Available: nextWorld.c4Available,
      starPresent: nextWorld.starPresent,
      hasKey: nextWorld.hasKey,
      hasC4: nextWorld.hasC4,
      hasStar: nextWorld.hasStar,
      storageUnlocked: nextWorld.storageUnlocked,
      c4Placed: nextWorld.c4Placed,
      bunkerBreached: nextWorld.bunkerBreached,
    };

    const goal: BunkerGoals = {};
    if (goalState.agentAt) goal.agentAt = goalState.agentAt;
    if (goalState.hasKey === true) goal.hasKey = true;
    if (goalState.hasC4 === true) goal.hasC4 = true;
    if (goalState.bunkerBreached === true) goal.bunkerBreached = true;
    if (goalState.hasStar === true) goal.hasStar = true;

    let steps: string[] = [];
    try {
      const { plan } = planUsingPlanner(goal, { initial: overrides });
      steps = Array.isArray(plan) ? plan : [];
    } catch (err) {
      console.error("[bunker-htnai] planning failed", err);
      setPlanLinePoints([]);
      setPlanNodeMarkers([]);
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const elapsedMs = Math.round(performance.now() - t0);
    setLastMs(elapsedMs);

    if (!steps.length) {
      setPlanLinePoints([]);
      setPlanNodeMarkers([]);
      setStatus("No plan found");
      return;
    }

    setStatus(`Executing plan (${elapsedMs} ms to plan)`);

    try {
      const raise = (p: Vec3): Vec3 => [p[0], p[1] + PLAN_Y_OFFSET, p[2]];
      const linePts: Vec3[] = [raise(NODE_POS[nextWorld.agentAt])];
      const nodeSteps: Record<string, Array<{ step: number; text: string }>> = {};

      const pretty = (op: string, arg?: string) => {
        switch (op) {
          case "MOVE":
            return `Move to ${nodeTitle[arg as NodeId] ?? arg}`;
          case "PICKUP_KEY":
            return "Pick up key";
          case "UNLOCK_STORAGE":
            return "Unlock storage";
          case "PICKUP_C4":
            return "Pick up C4";
          case "PLACE_C4":
            return "Place C4";
          case "DETONATE":
            return "Detonate";
          case "PICKUP_STAR":
            return "Pick up star";
          default:
            return op;
        }
      };

      const actionNode = (op: string, arg?: string): NodeId | null => {
        if (op === "MOVE" && arg) return arg as NodeId;
        switch (op) {
          case "PICKUP_KEY":
            return N.TABLE;
          case "UNLOCK_STORAGE":
            return N.STORAGE_DOOR;
          case "PICKUP_C4":
            return N.C4_TABLE;
          case "PLACE_C4":
            return N.BUNKER_DOOR;
          case "DETONATE":
            return N.SAFE;
          case "PICKUP_STAR":
            return N.STAR;
          default:
            return null;
        }
      };

      let stepIndex = 0;
      for (const s of steps) {
        stepIndex += 1;
        const [op, arg] = s.split(" ");
        const n = actionNode(op, arg);
        if (n) {
          if (op === "MOVE") {
            linePts.push(raise(NODE_POS[n]));
          }
          if (!nodeSteps[n]) nodeSteps[n] = [];
          nodeSteps[n].push({ step: stepIndex, text: pretty(op, arg) });
        }
      }
      const markers = Object.keys(nodeSteps).map((k) => {
        const node = k as NodeId;
        return {
          node,
          pos: raise(NODE_POS[node]),
          steps: nodeSteps[k].sort((a, b) => a.step - b.step),
        };
      });
      setPlanLinePoints(linePts);
      setPlanNodeMarkers(markers);
    } catch (err) {
      console.warn("[bunker-htnai] plan visualization failed", err);
    }

    for (const s of steps) {
      const [op, arg] = s.split(" ");
      if (op === "MOVE" && arg) {
        await apiRef.current!.moveTo(arg as NodeId);
        setWorld((w) => ({ ...w, agentAt: arg as NodeId }));
        continue;
      }
      if (op === "PICKUP_KEY") {
        setWorld((w) => ({ ...w, keyOnTable: false }));
        await apiRef.current!.startPickupAnimation(
          [
            NODE_POS[N.TABLE][0],
            NODE_POS[N.TABLE][1] + 0.6,
            NODE_POS[N.TABLE][2],
          ],
          "key",
          "#fbbf24",
        );
        setWorld((w) => ({ ...w, hasKey: true }));
        continue;
      }
      if (op === "UNLOCK_STORAGE") {
        await new Promise((r) => setTimeout(r, 200));
        setWorld((w) => ({ ...w, storageUnlocked: true }));
        continue;
      }
      if (op === "PICKUP_C4") {
        setWorld((w) => ({ ...w, c4Available: false }));
        await apiRef.current!.startPickupAnimation(
          [
            NODE_POS[N.C4_TABLE][0],
            NODE_POS[N.C4_TABLE][1] + 0.6,
            NODE_POS[N.C4_TABLE][2],
          ],
          "c4",
          "#ef4444",
        );
        setWorld((w) => ({ ...w, hasC4: true }));
        continue;
      }
      if (op === "PLACE_C4") {
        setWorld((w) => ({ ...w, hasC4: false }));
        const doorPos: Vec3 = [
          NODE_POS[N.BUNKER_DOOR][0],
          NODE_POS[N.BUNKER_DOOR][1] + 0.4,
          NODE_POS[N.BUNKER_DOOR][2],
        ];
        await apiRef.current!.startPlacementAnimation(doorPos, "c4", "#ef4444");
        setWorld((w) => ({ ...w, c4Placed: true }));
        continue;
      }
      if (op === "DETONATE") {
        await apiRef.current!.explodeAt(N.BUNKER_DOOR);
        setWorld((w) => ({ ...w, bunkerBreached: true, c4Placed: false }));
        continue;
      }
      if (op === "PICKUP_STAR") {
        setWorld((w) => ({ ...w, starPresent: false }));
        await apiRef.current!.startPickupAnimation(
          [NODE_POS[N.STAR][0], NODE_POS[N.STAR][1] + 0.5, NODE_POS[N.STAR][2]],
          "star",
          "#fde68a",
        );
        setWorld((w) => ({ ...w, hasStar: true }));
        continue;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    setStatus("Done");
  }

  function animateMove(target: NodeId) {
    const start = agentPosRef.current;
    const end = NODE_POS[target];
    const startVec = new THREE.Vector3(...start);
    const endVec = new THREE.Vector3(...end);
    const durationMs = 800;
    const startTime = performance.now();
    return new Promise<void>((resolve) => {
      function tick() {
        const t = Math.min(1, (performance.now() - startTime) / durationMs);
        const cur = startVec.clone().lerp(endVec, t);
        const v: Vec3 = [cur.x, cur.y, cur.z];
        agentPosRef.current = v;
        setAgentPos(v);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-white mb-2">
          Bunker (HTN-AI Planner)
        </h1>
        <p className="text-gray-300 mb-4">
          Status: {status} {lastMs != null ? `(plan ${lastMs} ms)` : ""}
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-4">
          <div className="lg:col-span-2">
            <PlannerControls
              initialState={initialState}
              goalState={goalState}
              autoRun={autoRun}
              showPlanVis={showPlanVis}
              isPlanning={status === "Planning..."}
              onInitialStateChange={(state) => {
                setInitialState(state);
                if (autoRun) {
                setTimeout(() => runHtnPlan(), 0);
                }
              }}
              onGoalStateChange={(goal) => {
                setGoalState(goal);
                if (autoRun) {
                setTimeout(() => runHtnPlan(), 0);
                }
              }}
              onAutoRunChange={setAutoRun}
              onShowPlanVisChange={setShowPlanVis}
              onRunPlan={runHtnPlan}
            />
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="bg-gray-750 px-3 py-2 border-b border-gray-700">
              <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <span className="text-green-400 text-sm">📊</span>
                Current State
              </h2>
            </div>
            <div className="p-3">
              <div className="space-y-1">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">Agent At</span>
                  <NodeDisplay nodeId={world.agentAt} />
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">Key On Table</span>
                  <span
                    className={`text-xs font-mono ${world.keyOnTable ? "text-green-400" : "text-red-400"}`}
                  >
                    {String(world.keyOnTable)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">C4 Available</span>
                  <span
                    className={`text-xs font-mono ${world.c4Available ? "text-green-400" : "text-red-400"}`}
                  >
                    {String(world.c4Available)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">Star Present</span>
                  <span
                    className={`text-xs font-mono ${world.starPresent ? "text-green-400" : "text-red-400"}`}
                  >
                    {String(world.starPresent)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">Has Key</span>
                  <span
                    className={`text-xs font-mono ${world.hasKey ? "text-green-400" : "text-red-400"}`}
                  >
                    {String(world.hasKey)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">Has C4</span>
                  <span
                    className={`text-xs font-mono ${world.hasC4 ? "text-green-400" : "text-red-400"}`}
                  >
                    {String(world.hasC4)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">Has Star</span>
                  <span
                    className={`text-xs font-mono ${world.hasStar ? "text-green-400" : "text-red-400"}`}
                  >
                    {String(world.hasStar)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">
                    Storage Unlocked
                  </span>
                  <span
                    className={`text-xs font-mono ${world.storageUnlocked ? "text-green-400" : "text-red-400"}`}
                  >
                    {String(world.storageUnlocked)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">C4 Placed</span>
                  <span
                    className={`text-xs font-mono ${world.c4Placed ? "text-green-400" : "text-red-400"}`}
                  >
                    {String(world.c4Placed)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-xs text-gray-400">Bunker Breached</span>
                  <span
                    className={`text-xs font-mono ${world.bunkerBreached ? "text-green-400" : "text-red-400"}`}
                  >
                    {String(world.bunkerBreached)}
                  </span>
                </div>
              </div>
            </div>
            <div className="bg-gray-750 px-3 py-2 border-t border-gray-700">
              <a
                href="/"
                className="inline-block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-3 rounded-lg transition-colors text-sm"
              >
                ← Back to Home
              </a>
            </div>
          </div>
        </div>

        <div className="w-full h-[80vh] bg-black rounded-lg overflow-hidden">
          <Canvas shadows camera={{ position: [0, 12, 24], fov: 50 }}>
            <CameraControls makeDefault />
            <StatsGl className="absolute top-4 left-4" />
            <ambientLight intensity={0.6} />
            <directionalLight
              position={[10, 20, 10]}
              intensity={0.9}
              castShadow
            />

            <Ground />
            <gridHelper
              args={[60, 60, "#4b5563", "#374151"]}
              position={[0, 0.01, 0]}
            />

            {/* Plan visualization */}
            {showPlanVis && planLinePoints.length >= 2 && (
              <Line
                points={planLinePoints}
                color="#22d3ee"
                lineWidth={2}
                dashed={false}
              />
            )}
            {showPlanVis &&
              planNodeMarkers.map((m) => (
                <group
                  key={`nodept_${m.node}`}
                  position={m.pos}
                  onPointerOver={() => setHoveredNode(m.node)}
                  onPointerOut={() => setHoveredNode(null)}
                >
                  <mesh>
                    <sphereGeometry args={[0.12, 12, 12]} />
                    <meshStandardMaterial
                      color={hoveredNode === m.node ? "#22d3ee" : "#0ea5e9"}
                    />
                  </mesh>
                  {/* Step list (multi-line) */}
                  <LabelSprite
                    position={[0, 0.5, 0]}
                    text={m.steps.map((s) => `${s.step}. ${s.text}`).join("\n")}
                  />
                  {hoveredNode === m.node && (
                    <LabelSprite
                      position={[0, 1.1, 0]}
                      text={nodeTitle[m.node]}
                    />
                  )}
                </group>
              ))}

            {/* Reference markers and buildings */}
            <BoxMarker
              position={NODE_POS[N.COURTYARD]}
              color="#2c3e50"
              label="Courtyard"
            />
            <BoxMarker
              position={NODE_POS[N.TABLE]}
              color="#2f74c0"
              label="Table"
            />

            {/* Storage building */}
            <Building
              center={BUILDINGS.STORAGE.center}
              size={BUILDINGS.STORAGE.size}
              color="#3f6212"
              label="Storage"
              doorFace={BUILDINGS.STORAGE.doorFace}
              doorSize={BUILDINGS.STORAGE.doorSize}
              doorColor={world.storageUnlocked ? "#16a34a" : "#a16207"}
              showDoor={!world.storageUnlocked}
              opacity={
                world.agentAt === N.STORAGE_INT ||
                world.agentAt === N.C4_TABLE ||
                world.agentAt === N.STORAGE_DOOR
                  ? 0.5
                  : 1
              }
              debug={false}
            />
            <BoxMarker
              position={NODE_POS[N.STORAGE_DOOR]}
              color={world.storageUnlocked ? "#16a34a" : "#a16207"}
              label="Storage Door"
            />
            <BoxMarker
              position={NODE_POS[N.C4_TABLE]}
              color="#7f1d1d"
              label="C4 Table"
            />

            {/* Bunker building */}
            <Building
              center={BUILDINGS.BUNKER.center}
              size={BUILDINGS.BUNKER.size}
              color="#374151"
              label="Bunker"
              doorFace={BUILDINGS.BUNKER.doorFace}
              doorSize={BUILDINGS.BUNKER.doorSize}
              doorColor={world.bunkerBreached ? "#16a34a" : "#7c2d12"}
              showDoor={!world.bunkerBreached}
              opacity={
                world.agentAt === N.BUNKER_INT ||
                world.agentAt === N.STAR ||
                world.agentAt === N.BUNKER_DOOR
                  ? 0.5
                  : 1
              }
              debug={false}
            />
            <BoxMarker
              position={NODE_POS[N.BUNKER_DOOR]}
              color={world.bunkerBreached ? "#16a34a" : "#7c2d12"}
              label="Bunker Door"
            />

            <BoxMarker
              position={NODE_POS[N.STAR]}
              color="#6b21a8"
              label="Star"
            />
            <BoxMarker
              position={NODE_POS[N.SAFE]}
              color="#0ea5e9"
              label="Blast Safe Zone"
            />

            {/* Objects in world */}
            <EnhancedObject
              position={[
                NODE_POS[N.TABLE][0],
                NODE_POS[N.TABLE][1] + 0.6,
                NODE_POS[N.TABLE][2],
              ]}
              color="#fbbf24"
              type="key"
              visible={world.keyOnTable}
            />
            <EnhancedObject
              position={[
                NODE_POS[N.C4_TABLE][0],
                NODE_POS[N.C4_TABLE][1] + 0.6,
                NODE_POS[N.C4_TABLE][2],
              ]}
              color="#ef4444"
              type="c4"
              visible={world.c4Available}
            />
            <SmallSphere
              position={[
                NODE_POS[N.BUNKER_DOOR][0],
                NODE_POS[N.BUNKER_DOOR][1] + 0.4,
                NODE_POS[N.BUNKER_DOOR][2],
              ]}
              color="#ef4444"
              visible={world.c4Placed}
              size={0.3}
            />
            <EnhancedObject
              position={[
                NODE_POS[N.STAR][0],
                NODE_POS[N.STAR][1] + 0.5,
                NODE_POS[N.STAR][2],
              ]}
              color="#fde68a"
              type="star"
              visible={world.starPresent}
            />

            {/* Agent */}
            <group>
              <AgentMesh getPos={() => agentPos} />
              <LabelSprite
                position={[agentPos[0], 1.2, agentPos[2]]}
                text="Agent"
              />
            </group>

            {/* Inventory items */}
            {world.hasKey && (
              <InventoryItem
                agentPos={agentPos}
                type="key"
                color="#fbbf24"
                index={0}
              />
            )}
            {world.hasC4 && (
              <InventoryItem
                agentPos={agentPos}
                type="c4"
                color="#ef4444"
                index={1}
              />
            )}
            {world.hasStar && (
              <InventoryItem
                agentPos={agentPos}
                type="star"
                color="#fde68a"
                index={2}
              />
            )}

            {/* Pickup animations */}
            {Object.entries(pickupAnimations).map(([id, animation]) => (
              <PickupAnimation
                key={id}
                animation={animation}
                onComplete={() => {
                  setPickupAnimations((prev) => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                  });
                }}
              />
            ))}

            {/* Explosion VFX */}
            {boom.at && (
              <mesh position={boom.at}>
                <sphereGeometry args={[0.4, 16, 16]} />
                <meshStandardMaterial
                  color="#f97316"
                  emissive="#dc2626"
                  emissiveIntensity={1.2}
                  transparent
                  opacity={0.7}
                />
              </mesh>
            )}
          </Canvas>
        </div>

        <div className="mt-4 text-gray-300">
          <div>
            Inventory: <span>Key: {world.hasKey ? "true" : "false"}</span>
            {" | "}
            <span>C4: {world.hasC4 ? "true" : "false"}</span>
            {" | "}
            <span>Star: {world.hasStar ? "true" : "false"}</span>
          </div>
          <a
            href="/"
            className="inline-block mt-3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}
