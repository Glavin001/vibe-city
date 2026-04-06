"use client";

import {
  type MutableRefObject,
  type ReactNode,
  memo,
  useState,
} from "react";
import type { TabId } from "./types";

// ============================================================================
// TabBar Component
// ============================================================================

type TabConfig = {
  id: TabId;
  label: string;
};

const TABS: TabConfig[] = [
  { id: "scene", label: "Scene" },
  { id: "interaction", label: "Interaction" },
  { id: "physics", label: "Physics" },
  { id: "damage", label: "Damage" },
  { id: "debug", label: "Debug" },
];

type TabBarProps = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
};

export const TabBar = memo(function TabBar({
  activeTab,
  onTabChange,
}: TabBarProps) {
  return (
    <div className="flex gap-0.5 border-b border-neutral-700 pb-2 mb-3 overflow-x-auto shrink-0">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={`px-3 py-1 text-[13px] rounded cursor-pointer whitespace-nowrap transition-all duration-150 border-none ${
            activeTab === tab.id
              ? "font-semibold text-blue-400 bg-blue-500/10"
              : "font-normal text-gray-400 bg-transparent"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
});

// ============================================================================
// Section Component (Collapsible)
// ============================================================================

type SectionProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  description?: string;
  disabled?: boolean;
};

export const Section = memo(function Section({
  title,
  children,
  defaultOpen = true,
  description,
  disabled = false,
}: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`mb-3 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full py-1 bg-transparent border-none cursor-pointer text-left"
      >
        <span
          className={`text-[11px] text-gray-400 transition-transform duration-150 ${
            isOpen ? "rotate-90" : "rotate-0"
          }`}
        >
          ▶
        </span>
        <span className="text-[13px] text-gray-400 font-medium">{title}</span>
      </button>
      {description && isOpen && (
        <p className="m-0 mb-2 ml-4 text-xs text-gray-500 leading-snug">
          {description}
        </p>
      )}
      {isOpen && (
        <div className="flex flex-col gap-2 pl-4">{children}</div>
      )}
    </div>
  );
});

// ============================================================================
// Slider Component
// ============================================================================

type SliderProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  formatValue?: (v: number) => string;
  valueWidth?: number;
};

export const Slider = memo(function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  formatValue,
  valueWidth = 70,
}: SliderProps) {
  const displayValue = formatValue ? formatValue(value) : value.toString();

  return (
    <label
      className={`flex items-center gap-2 text-gray-200 text-sm ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <span className="min-w-[100px] shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="flex-1"
      />
      <span
        className="text-gray-400 text-right tabular-nums text-[13px]"
        style={{ width: valueWidth }}
      >
        {displayValue}
      </span>
    </label>
  );
});

// ============================================================================
// NumberInput Component
// ============================================================================

type NumberInputProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  formatValue?: (v: number) => string;
  valueWidth?: number;
};

export const NumberInput = memo(function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  step = 0.01,
  disabled = false,
  formatValue,
  valueWidth = 90,
}: NumberInputProps) {
  const displayValue = formatValue ? formatValue(value) : `${value.toFixed(2)}`;

  return (
    <label
      className={`flex items-center gap-2 text-gray-200 text-sm ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <span className="min-w-[140px] shrink-0">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => {
          const next = e.target.valueAsNumber;
          onChange(Number.isFinite(next) ? Math.max(min, next) : min);
        }}
        disabled={disabled}
        className="flex-1 bg-neutral-900 text-gray-100 border border-neutral-700 rounded-md px-2 py-1.5"
      />
      <span
        className="text-gray-400 text-right tabular-nums text-[13px]"
        style={{ width: valueWidth }}
      >
        {displayValue}
      </span>
    </label>
  );
});

// ============================================================================
// Toggle Component
// ============================================================================

type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
};

export const Toggle = memo(function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: ToggleProps) {
  return (
    <label
      className={`flex items-center gap-2 text-gray-200 text-sm ${
        disabled ? "opacity-50 cursor-default" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-4 h-4 accent-blue-400"
      />
      {label}
    </label>
  );
});

// ============================================================================
// Select Component
// ============================================================================

type SelectOption<T extends string> = {
  value: T;
  label: string;
};

type SelectProps<T extends string> = {
  label?: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly SelectOption<T>[];
  disabled?: boolean;
  fullWidth?: boolean;
};

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
  fullWidth = false,
}: SelectProps<T>) {
  const selectElement = (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      disabled={disabled}
      className={`bg-neutral-900 text-gray-100 border border-neutral-700 rounded-md px-2.5 py-2 ${
        fullWidth ? "flex-1" : ""
      } ${fullWidth && !label ? "w-full" : ""}`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );

  if (!label) return selectElement;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-gray-200 text-sm">{label}</span>
      {selectElement}
    </div>
  );
}

// ============================================================================
// StatRow Component
// ============================================================================

type StatRowProps = {
  label: string;
  valueRef?: MutableRefObject<HTMLSpanElement | null>;
  value?: string | number;
};

export const StatRow = memo(function StatRow({
  label,
  valueRef,
  value,
}: StatRowProps) {
  return (
    <div className="flex items-center justify-between text-gray-200 text-sm tabular-nums">
      <span>{label}</span>
      {valueRef ? (
        <span ref={valueRef}>-</span>
      ) : (
        <span>{value ?? "-"}</span>
      )}
    </div>
  );
});

// ============================================================================
// Button Components
// ============================================================================

type ButtonProps = {
  children: ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  className?: string;
};

export const Button = memo(function Button({
  children,
  onClick,
  variant = "default",
  className = "",
}: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-2 text-[13px] rounded-md cursor-pointer flex items-center gap-1.5 ${
        variant === "danger"
          ? "border border-red-700 bg-red-700 text-gray-50"
          : "border border-neutral-700 bg-neutral-950 text-white"
      } ${className}`}
    >
      {children}
    </button>
  );
});

// ============================================================================
// Panel Container
// ============================================================================

type PanelContainerProps = {
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onReset: () => void;
  panelTop: number;
  bodyCountRef?: MutableRefObject<HTMLSpanElement | null>;
  activeBodyCountRef?: MutableRefObject<HTMLSpanElement | null>;
  colliderCountRef?: MutableRefObject<HTMLSpanElement | null>;
  bondsCountRef?: MutableRefObject<HTMLSpanElement | null>;
};

export const PanelContainer = memo(function PanelContainer({
  children,
  collapsed,
  onToggleCollapse,
  onReset,
  panelTop,
  bodyCountRef,
  activeBodyCountRef,
  colliderCountRef,
  bondsCountRef,
}: PanelContainerProps) {
  // Compact stats bar component
  const StatsBar = (
    <div className="flex items-center gap-3 text-xs text-gray-400 tabular-nums">
      <span className="flex items-center gap-1">
        <span className="text-gray-500">Bodies:</span>
        <span ref={bodyCountRef} className="text-gray-300">-</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="text-gray-500">Active:</span>
        <span ref={activeBodyCountRef} className="text-gray-300">-</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="text-gray-500">Colliders:</span>
        <span ref={colliderCountRef} className="text-gray-300">-</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="text-gray-500">Bonds:</span>
        <span ref={bondsCountRef} className="text-gray-300">-</span>
      </span>
    </div>
  );

  if (collapsed) {
    return (
      <div
        className="absolute left-2 z-20 flex flex-col gap-2"
        style={{ top: panelTop }}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="px-3 py-2 bg-gray-800 text-gray-200 rounded-md border border-gray-600 cursor-pointer text-sm font-medium flex items-center gap-1.5 shadow-lg"
          aria-label="Show controls"
        >
          <span className="text-base">☰</span>
          <span>Controls</span>
        </button>
        <div className="px-3 py-2 bg-neutral-950/90 rounded-md border border-neutral-700 shadow-lg">
          {StatsBar}
        </div>
      </div>
    );
  }

  return (
    <div
      id="control-panel"
      className="absolute left-2 right-2 bottom-4 z-10 flex flex-col max-w-[360px] bg-neutral-950/95 p-3 rounded-lg border border-neutral-700"
      style={{ top: panelTop }}
    >
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="px-3 py-1.5 bg-neutral-950 text-white rounded-md border border-neutral-700 cursor-pointer flex items-center gap-1.5 text-[13px]"
        >
          <span>✕</span>
          <span>Hide</span>
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-3 py-1.5 bg-neutral-950 text-white rounded-md border border-neutral-700 cursor-pointer flex items-center gap-1.5 text-[13px]"
        >
          <span>↺</span>
          <span>Reset</span>
        </button>
      </div>
      <div className="mb-3 pb-2 border-b border-neutral-700">
        {StatsBar}
      </div>
      {children}
    </div>
  );
});

// ============================================================================
// Tab Content Container
// ============================================================================

type TabContentProps = {
  children: ReactNode;
};

export const TabContent = memo(function TabContent({
  children,
}: TabContentProps) {
  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-2">{children}</div>
  );
});

// ============================================================================
// Row Component for inline groupings
// ============================================================================

type RowProps = {
  children: ReactNode;
  gap?: number;
};

export const Row = memo(function Row({ children, gap = 8 }: RowProps) {
  return (
    <div className="flex items-center" style={{ gap }}>
      {children}
    </div>
  );
});

// ============================================================================
// Separator
// ============================================================================

export const Separator = memo(function Separator() {
  return <div className="h-px bg-neutral-700 my-2" />;
});
