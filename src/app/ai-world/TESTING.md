# AI World Testing Guide

## What Should Work Now

### ✅ Confirmed Working (via browser testing)
1. **3D Scene Rendering**: Buildings, NPCs, items, and grid all render correctly
2. **World State Display**: Complete world state with positions, inventories, and NPC info
3. **AI Chat**: Chat interface integrated with Gemini 2.0 Flash
4. **UI Layout**: Responsive layout with proper scrolling and sizing

### ⚠️ Requires Manual Testing (Cannot test via automation)
1. **Player Movement (WASD)**
2. **Mouse Look**
3. **Physics Interactions**

## How Player Controls Work

### Architecture
There are **TWO COMPLEMENTARY SYSTEMS** (not conflicting):

1. **PointerLockControls** (`@react-three/drei`)
   - Handles mouse look (camera rotation)
   - Takes control when pointer is locked
   - Updates Three.js camera rotation directly

2. **PlayerKCC** (`src/components/physics/PlayerKCC.tsx`)
   - Reads camera rotation from Three.js camera
   - Handles WASD keyboard input
   - Controls camera **position** via Rapier physics
   - Uses camera direction to determine forward/backward movement

### How They Work Together
1. User clicks on 3D view → Pointer locks
2. Mouse movement → PointerLockControls → Updates camera rotation
3. WASD keys → PlayerKCC → Reads camera rotation → Moves in that direction
4. PlayerKCC → Updates camera position based on physics

## Manual Testing Steps

### 1. Test Pointer Lock
1. Open http://localhost:3000/ai-world
2. Wait for world to load (see buildings and NPCs)
3. Click on the 3D view
4. **Expected**: Overlay message disappears, cursor is hidden
5. **If not working**: Check browser console for pointer lock errors

### 2. Test Mouse Look
1. After locking pointer, move mouse
2. **Expected**: Camera rotates smoothly
3. **Expected**: View changes based on mouse movement

### 3. Test Player Movement
1. After locking pointer, press **W** key
2. **Expected**: Camera moves forward in the direction you're looking
3. Try **A** (left), **S** (backward), **D** (right)
4. **Expected**: Player position in World State updates in real-time

### 4. Test Physics
1. Walk into a building wall
2. **Expected**: You stop, can't walk through
3. Press **Space** (jump)
4. **Expected**: Camera moves up then falls back down

### 5. Test Sprint
1. Hold **Shift** while pressing **W**
2. **Expected**: Move faster (9 m/s vs 5 m/s)

## Troubleshooting

### Mouse Look Not Working
- **Symptom**: Mouse moves but camera doesn't rotate
- **Check**: Is pointer locked? Should see no cursor
- **Fix**: Click on 3D view again to lock pointer

### Keyboard Not Working
- **Symptom**: WASD keys don't move player
- **Check**: Browser console for errors
- **Check**: Is focus on the page (not in chat input)?
- **Fix**: Click on 3D view to ensure focus

### Player Falls Through Ground
- **Symptom**: Camera keeps falling
- **Check**: Physics system initialized?
- **Fix**: Refresh page, ensure no console errors

### Camera Jitters or Rotates Incorrectly
- **Symptom**: Camera shakes or rotates unexpectedly
- **Check**: Player spawn position correct? Should be `[0, 0.9, 0]` (capsule center)
- **Fix**: Already fixed in current code

## Expected Console Messages

### Normal (Safe to Ignore)
- `using deprecated parameters for the initialization function` (Rapier warning)
- `unsupported GPOS/GSUB table LookupType` (Font rendering warnings)

### Errors to Fix
- `PointerLockControls: Unable to use Pointer Lock API` - Means pointer lock failed
- `THREE.WebGLProgram: shader error` - WebGL issue
- Any React errors - Code issues

## Comparison with Working Reference

### Reference: `npc-chat-physics/page.tsx`
- Uses same `PlayerKCC` component ✓
- Uses same `PointerLockControls` pattern ✓
- Uses same `KeyboardControls` wrapper ✓
- Uses same physics setup (Rapier) ✓
- Uses same spawn position pattern ✓

### Key Differences
- `ai-world` uses more advanced world system (actions.ts)
- `ai-world` has Gemini AI integration
- Otherwise, player controls should be **identical**

## If Still Not Working

### 1. Compare Side-by-Side
1. Open http://localhost:3000/npc-chat-physics in one tab
2. Open http://localhost:3000/ai-world in another tab
3. Test both - if npc-chat-physics works but ai-world doesn't, there's a code issue

### 2. Check Browser Compatibility
- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Pointer lock may have issues

### 3. Check Console
- Look for any red errors
- Share errors for debugging

## Current Status

✅ **Code Review**: Setup matches working reference exactly
✅ **3D Rendering**: Confirmed working via automation
✅ **UI Layout**: Confirmed working via automation
⏳ **Player Controls**: Requires manual testing (pointer lock restriction in automation)

## Next Steps

1. **YOU**: Manually test player controls following steps above
2. **YOU**: Report back which specific behaviors are not working
3. **ME**: Fix any identified issues

