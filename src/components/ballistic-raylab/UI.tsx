"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Crosshair,
  Smartphone,
  Info,
  Monitor,
  RotateCcw,
  Zap,
} from "lucide-react";

interface UIProps {
  isMobile: boolean;
  onSetMobile: (val: boolean) => void;
  onJoystickMove: (x: number, y: number) => void;
  onLookDrag: (x: number, y: number) => void;
  onFireStart: () => void;
  onFireEnd: () => void;
  onClearTraces: () => void;
  infiniteEnergy: boolean;
  onToggleEnergy: () => void;
}

export const UI: React.FC<UIProps> = ({
  isMobile,
  onSetMobile,
  onJoystickMove,
  onLookDrag,
  onFireStart,
  onFireEnd,
  onClearTraces,
  infiniteEnergy,
  onToggleEnergy,
}) => {
  const [showInfo, setShowInfo] = useState(true);

  // Auto-hide info on mobile after a delay to clear view
  useEffect(() => {
    if (isMobile) {
      const timer = setTimeout(() => setShowInfo(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [isMobile]);

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between z-10 select-none overflow-hidden touch-none">
      {/* --- HEADER --- */}
      <div
        className={`flex justify-between items-start pointer-events-auto bg-gradient-to-b from-black/80 to-transparent transition-all duration-300 ${isMobile ? "p-2 pt-safe-top" : "p-4"}`}
      >
        <div>
          <h1
            className={`text-white font-bold tracking-wider uppercase drop-shadow-md ${isMobile ? "text-sm" : "text-xl"}`}
          >
            Ballistic<span className="text-red-500">Ray</span>
          </h1>
          {!isMobile && (
            <p className="text-xs text-gray-400">Physics Sandbox</p>
          )}
        </div>
        <div className="flex gap-2">
          {/* Infinite Energy Toggle */}
          <button
            type="button"
            onClick={onToggleEnergy}
            className={`rounded backdrop-blur-md border transition-colors ${
              infiniteEnergy
                ? "bg-yellow-500/80 border-yellow-400 text-black"
                : "bg-gray-800/80 border-gray-700 text-white hover:bg-gray-700"
            } ${isMobile ? "p-1" : "p-2"}`}
            title="Toggle Infinite Penetration Energy"
          >
            <Zap
              size={isMobile ? 16 : 20}
              fill={infiniteEnergy ? "currentColor" : "none"}
            />
          </button>

          <button
            type="button"
            onClick={() => setShowInfo(!showInfo)}
            className={`text-white rounded hover:bg-gray-700 backdrop-blur-md border border-gray-700 bg-gray-800/80 ${isMobile ? "p-1" : "p-2"}`}
          >
            <Info size={isMobile ? 16 : 20} />
          </button>

          <button
            type="button"
            onClick={onClearTraces}
            className={`text-white rounded hover:bg-red-900/50 backdrop-blur-md border border-gray-700 bg-gray-800/80 ${isMobile ? "p-1" : "p-2"}`}
            title="Reset Physics & Lines"
          >
            <RotateCcw size={isMobile ? 16 : 20} />
          </button>

          {/* Debug toggle still useful for testing on desktop */}
          <button
            type="button"
            onClick={() => onSetMobile(!isMobile)}
            className={`text-white rounded hover:bg-gray-700 backdrop-blur-md border border-gray-700 bg-gray-800/80 ${isMobile ? "p-1" : "p-2"}`}
          >
            {isMobile ? (
              <Monitor size={isMobile ? 16 : 20} />
            ) : (
              <Smartphone size={20} />
            )}
          </button>
        </div>
      </div>

      {/* --- INFO PANEL --- */}
      {showInfo && (
        <div
          className={`absolute left-4 bg-black/90 text-gray-200 rounded-lg pointer-events-auto backdrop-blur-md border border-gray-700 shadow-xl transition-all ${isMobile ? "top-12 w-48 p-2 text-[10px]" : "top-20 w-64 p-4 text-xs"}`}
        >
          <h3 className="font-bold mb-2 text-white border-b border-gray-700 pb-1">
            Ballistics Legend
          </h3>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-yellow-400 rounded-full shadow-[0_0_8px_yellow]" />
              Air Travel
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_8px_red]" />
              Penetration
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_8px_cyan]" />
              Ricochet
            </div>
          </div>
          {!isMobile && (
            <p className="mt-4 text-gray-400 leading-relaxed">
              <span className="text-white font-bold">Controls:</span> WASD to
              Move, Mouse to Look, Left Click to Shoot.
            </p>
          )}
        </div>
      )}

      {/* --- MOBILE CONTROLS --- */}
      {isMobile && (
        <div className="absolute inset-0 pointer-events-none flex items-end justify-between pb-8 px-4 sm:pb-12 sm:px-8">
          {/* Movement Joystick Area */}
          <div className="pointer-events-auto relative z-30">
            <Joystick onMove={onJoystickMove} />
          </div>

          {/* Look & Fire Area */}
          <div className="flex flex-col items-center gap-4 pointer-events-auto relative z-30">
            <FireButton
              onFireStart={onFireStart}
              onFireEnd={onFireEnd}
              onLookDrag={onLookDrag}
            />
          </div>

          {/* Invisible Look Touchpad (Right Half Screen) */}
          <div className="absolute right-0 top-1/4 bottom-0 w-1/2 z-20 pointer-events-auto">
            <LookPad onLookDrag={onLookDrag} />
          </div>
        </div>
      )}

      {!isMobile && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/50 text-sm font-mono pointer-events-none">
          [HOLD LEFT CLICK TO FIRE AUTOMATICALLY]
        </div>
      )}

      {/* Crosshair */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/80 pointer-events-none drop-shadow-md">
        <Crosshair size={24} strokeWidth={1.5} />
      </div>
    </div>
  );
};

// --- SUBCOMPONENTS ---

const Joystick: React.FC<{ onMove: (x: number, y: number) => void }> = ({
  onMove,
}) => {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const touchId = useRef<number | null>(null);

  const handleStart = (e: React.TouchEvent) => {
    // Only accept if not already active
    if (active) return;

    const touch = e.changedTouches[0];
    touchId.current = touch.identifier;

    setActive(true);
    startPos.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleMove = (e: React.TouchEvent) => {
    if (!active) return;

    // Find our specific touch
    const touch = Array.from(e.changedTouches).find(
      (t) => t.identifier === touchId.current
    );
    if (!touch) return;

    const dx = touch.clientX - startPos.current.x;
    const dy = touch.clientY - startPos.current.y;

    // Clamp magnitude
    const maxDist = 40;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const clampedDist = Math.min(distance, maxDist);
    const angle = Math.atan2(dy, dx);

    const finalX = Math.cos(angle) * clampedDist;
    const finalY = Math.sin(angle) * clampedDist;

    setPos({ x: finalX, y: finalY });

    // Send normalized -1 to 1
    onMove(finalX / maxDist, -finalY / maxDist); // Invert Y for forward
  };

  const handleEnd = (e: React.TouchEvent) => {
    const touch = Array.from(e.changedTouches).find(
      (t) => t.identifier === touchId.current
    );
    if (!touch) return;

    setActive(false);
    setPos({ x: 0, y: 0 });
    onMove(0, 0);
    touchId.current = null;
  };

  return (
    <div
      className="w-32 h-32 bg-white/10 backdrop-blur-sm rounded-full border border-white/20 flex items-center justify-center touch-none"
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
      onTouchCancel={handleEnd}
      style={{ touchAction: "none" }}
    >
      <div
        className={`w-12 h-12 bg-white/80 rounded-full shadow-lg transition-transform duration-75 ${!active && "transition-all duration-300"}`}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      />
    </div>
  );
};

const LookPad: React.FC<{ onLookDrag: (x: number, y: number) => void }> = ({
  onLookDrag,
}) => {
  const lastPos = useRef({ x: 0, y: 0 });
  const touchId = useRef<number | null>(null);

  const handleStart = (e: React.TouchEvent) => {
    // Don't interfere with other touches if we are already tracking one
    if (touchId.current !== null) return;

    const touch = e.changedTouches[0];
    touchId.current = touch.identifier;
    lastPos.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleMove = (e: React.TouchEvent) => {
    const touch = Array.from(e.changedTouches).find(
      (t) => t.identifier === touchId.current
    );
    if (!touch) return;

    const curX = touch.clientX;
    const curY = touch.clientY;
    const dx = curX - lastPos.current.x;
    const dy = curY - lastPos.current.y;

    onLookDrag(dx * 0.005, dy * 0.005);

    lastPos.current = { x: curX, y: curY };
  };

  const handleEnd = (e: React.TouchEvent) => {
    const touch = Array.from(e.changedTouches).find(
      (t) => t.identifier === touchId.current
    );
    if (touch) {
      touchId.current = null;
    }
  };

  return (
    <div
      className="w-full h-full touch-none"
      style={{ touchAction: "none" }}
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
      onTouchCancel={handleEnd}
    />
  );
};

const FireButton: React.FC<{
  onFireStart: () => void;
  onFireEnd: () => void;
  onLookDrag: (x: number, y: number) => void;
}> = ({ onFireStart, onFireEnd, onLookDrag }) => {
  const [pressed, setPressed] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const touchId = useRef<number | null>(null);

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();

    if ("touches" in e) {
      const touch = e.changedTouches[0];
      touchId.current = touch.identifier;
      lastPos.current = { x: touch.clientX, y: touch.clientY };
    }

    setPressed(true);
    onFireStart();
  };

  const handleMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (!pressed) return;

    // Check if this move event is for our fire finger
    const touch = Array.from(e.changedTouches).find(
      (t) => t.identifier === touchId.current
    );

    if (touch && lastPos.current) {
      const curX = touch.clientX;
      const curY = touch.clientY;
      const dx = curX - lastPos.current.x;
      const dy = curY - lastPos.current.y;

      // Apply aiming delta
      onLookDrag(dx * 0.005, dy * 0.005);

      lastPos.current = { x: curX, y: curY };
    }
  };

  const handleEnd = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();

    // For touches, verify it's the right finger
    if ("touches" in e) {
      const touch = Array.from(e.changedTouches).find(
        (t) => t.identifier === touchId.current
      );
      if (!touch) return; // Ignore if it's another finger lifting
      touchId.current = null;
    }

    setPressed(false);
    onFireEnd();
    lastPos.current = null;
  };

  return (
    <button
      type="button"
      className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-all duration-100 shadow-xl touch-none ${pressed ? "bg-red-600 scale-95 border-red-300" : "bg-red-500/80 border-red-400"}`}
      style={{ touchAction: "none" }}
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
      onTouchCancel={handleEnd}
      onMouseDown={handleStart}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
    >
      <div className="w-16 h-16 rounded-full border-2 border-dashed border-white/50 animate-[spin_10s_linear_infinite]" />
      <div className="absolute text-white font-bold tracking-widest text-xs">
        FIRE
      </div>
    </button>
  );
};



