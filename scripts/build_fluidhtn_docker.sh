#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
DOCKERFILE_PATH="$REPO_ROOT/src/lib/planner/Dockerfile"
DOCKER_BUILD_CONTEXT_DIR="$REPO_ROOT/src/lib/planner/bridge"
WEBAPP_PUBLIC_BASE_DIR="$REPO_ROOT/public"

# GEN_DST="$REPO_ROOT/src/lib/generated/fluidhtn"
echo "[fluidhtn] SCRIPT_DIR: $SCRIPT_DIR"
echo "[fluidhtn] REPO_ROOT: $REPO_ROOT"
echo "[fluidhtn] WEBAPP_PUBLIC_BASE_DIR: $WEBAPP_PUBLIC_BASE_DIR"

# Output directory for exported artifacts
BUILD_DIR="${1:-$REPO_ROOT/build/fluidhtn}"
GEN_SRC="$BUILD_DIR/generated/fluidhtn"
GEN_DST="$REPO_ROOT/src/lib/planner/types"

# Optional: enable AOT via env or second arg: true|false (default false)
AOT_ARG="${2:-${AOT:-false}}"

echo "[fluidhtn] Build Output directory: $BUILD_DIR"
echo "[fluidhtn] Generated types source: $GEN_SRC"
echo "[fluidhtn] Generated types destination: $GEN_DST"
echo "[fluidhtn] AOT: $AOT_ARG"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is required but not found in PATH." >&2
  exit 1
fi

# Ensure destination exists so users can see it being populated
mkdir -p "$BUILD_DIR"

echo "[fluidhtn] Building via Docker (this may take a few minutes)..."
DOCKER_BUILDKIT=1 docker build \
  -f "$DOCKERFILE_PATH" \
  --build-arg AOT="$AOT_ARG" \
  -o "$BUILD_DIR" \
  "$DOCKER_BUILD_CONTEXT_DIR"

echo "[fluidhtn] Build complete. Verifying artifacts..."

if [[ -f "$BUILD_DIR/dotnet.js" || -f "$BUILD_DIR/_framework/dotnet.js" ]]; then
  echo "[fluidhtn] Found runtime: dotnet.js"
  if [[ -f "$BUILD_DIR/FluidHtnWasm.dll" ]]; then
    echo "[fluidhtn] Found assembly: FluidHtnWasm.dll"
  fi
  echo "[fluidhtn] Artifacts are ready in: $BUILD_DIR"

  # If generated TS exists, sync it to Next app for DX
  if [[ -d "$GEN_SRC" ]]; then
    echo "[fluidhtn] Found generated TS types; copying to $GEN_DST"
    mkdir -p "$GEN_DST"
    rsync -a --delete "$GEN_SRC/" "$GEN_DST/"
  else
    echo "[fluidhtn] No generated TS types found (optional)."
  fi

  # Auto-sync AppBundle into Next.js public folder for local dev
  if [[ -d "$WEBAPP_PUBLIC_BASE_DIR" ]]; then
    echo "[fluidhtn] Syncing AppBundle into Next public (/fluidhtn)..."
    # bash "$REPO_ROOT/scripts/copy_fluidhtn_to_next_public.sh" || echo "[fluidhtn] Warning: sync to Next public failed"

    # Inline copy of AppBundle to Next.js public folder for local dev
    PUBLIC_SUB_DIR="planner"
    PUBLIC_DIR="$WEBAPP_PUBLIC_BASE_DIR/$PUBLIC_SUB_DIR"

    if [[ ! -f "$BUILD_DIR/_framework/dotnet.js" ]]; then
      echo "[fluidhtn] Error: AppBundle not found at $BUILD_DIR. Build it first."
    else
      echo "[fluidhtn] Copying AppBundle -> $PUBLIC_DIR"
      mkdir -p "$PUBLIC_DIR"
      rsync -a --delete "$BUILD_DIR"/ "$PUBLIC_DIR"/
      echo "[fluidhtn] Done. Next.js can now serve /$PUBLIC_SUB_DIR/_framework/dotnet.js"
    fi
    
  fi
else
  echo "Warning: Expected artifacts not found in $OUT_DIR" >&2
  echo "Look for build errors above. The Docker build should export files from the published output." >&2
  exit 1
fi


