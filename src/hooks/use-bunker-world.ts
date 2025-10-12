import { useState, useRef, useEffect, useCallback } from 'react'
import type { Vec3 } from '../lib/bunker-world'
import { NODE_POS, N } from '../lib/bunker-world'
import type { Inventory } from '../lib/npc-commands'

export type WorldState = {
  keyOnTable: boolean
  c4Available: boolean
  starPresent: boolean
  hasKey: boolean
  hasC4: boolean
  hasStar: boolean
  storageUnlocked: boolean
  c4Placed: boolean
  bunkerBreached: boolean
}

export type { Inventory }

export type BoomEffect = {
  at?: Vec3
  t?: number
}

function distance2D(a: Vec3, b: Vec3) {
  const dx = a[0] - b[0]
  const dz = a[2] - b[2]
  return Math.hypot(dx, dz)
}

export function useBunkerWorld() {
  const [world, setWorld] = useState<WorldState>({
    keyOnTable: true,
    c4Available: true,
    starPresent: true,
    hasKey: false,
    hasC4: false,
    hasStar: false,
    storageUnlocked: false,
    c4Placed: false,
    bunkerBreached: false,
  })
  
  const worldRef = useRef(world)
  useEffect(() => { worldRef.current = world }, [world])
  
  const [boom, setBoom] = useState<BoomEffect>({})
  const [playerInv, setPlayerInv] = useState<Inventory>({ hasKey: false, hasC4: false, hasStar: false })
  const playerInvRef = useRef(playerInv)
  useEffect(() => { playerInvRef.current = playerInv }, [playerInv])
  
  const [npcInventories, setNpcInventories] = useState<Record<string, Inventory>>({})
  const npcInventoriesRef = useRef(npcInventories)
  useEffect(() => { npcInventoriesRef.current = npcInventories }, [npcInventories])
  
  const setNpcInventory = useCallback((id: string, next: Partial<Inventory>) => {
    setNpcInventories((prev) => {
      const existing = prev[id] || { hasKey: false, hasC4: false, hasStar: false }
      const merged = { ...existing, ...next }
      return { ...prev, [id]: merged }
    })
  }, [])
  
  const worldOps = useRef({
    getWorld: () => worldRef.current,
    
    pickupKey: async (by: string, getPose: (id: string) => Vec3) => {
      const pos = getPose(by)
      const near = distance2D(pos, NODE_POS[N.TABLE]) <= 1.6
      if (!worldRef.current.keyOnTable || !near) return false
      setWorld((w) => ({ ...w, keyOnTable: false }))
      if (by === 'player') setPlayerInv((i) => ({ ...i, hasKey: true }))
      return true
    },
    
    unlockStorage: async (by: string, getPose: (id: string) => Vec3) => {
      const pos = getPose(by)
      const near = distance2D(pos, NODE_POS[N.STORAGE_DOOR]) <= 1.8
      const hasKey = by === 'player' 
        ? playerInvRef.current.hasKey 
        : (npcInventoriesRef.current[by]?.hasKey === true)
      if (worldRef.current.storageUnlocked || !hasKey || !near) return false
      await new Promise((r) => setTimeout(r, 150))
      setWorld((w) => ({ ...w, storageUnlocked: true }))
      return true
    },
    
    pickupC4: async (by: string, getPose: (id: string) => Vec3) => {
      const pos = getPose(by)
      const near = distance2D(pos, NODE_POS[N.C4_TABLE]) <= 1.6
      if (!worldRef.current.c4Available || !near) return false
      setWorld((w) => ({ ...w, c4Available: false }))
      if (by === 'player') setPlayerInv((i) => ({ ...i, hasC4: true }))
      return true
    },
    
    placeC4: async (by: string, getPose: (id: string) => Vec3) => {
      const pos = getPose(by)
      const near = distance2D(pos, NODE_POS[N.BUNKER_DOOR]) <= 1.8
      const hasC4 = by === 'player' 
        ? playerInvRef.current.hasC4 
        : (npcInventoriesRef.current[by]?.hasC4 === true)
      if (worldRef.current.c4Placed || worldRef.current.bunkerBreached || !hasC4 || !near) return false
      setWorld((w) => ({ ...w, c4Placed: true }))
      if (by === 'player') setPlayerInv((i) => ({ ...i, hasC4: false }))
      return true
    },
    
    detonate: async () => {
      if (!worldRef.current.c4Placed || worldRef.current.bunkerBreached) return false
      setBoom({ at: [NODE_POS[N.BUNKER_DOOR][0], NODE_POS[N.BUNKER_DOOR][1] + 0.6, NODE_POS[N.BUNKER_DOOR][2]], t: performance.now() })
      await new Promise((r) => setTimeout(r, 380))
      setBoom({})
      setWorld((w) => ({ ...w, bunkerBreached: true, c4Placed: false }))
      return true
    },
    
    pickupStar: async (by: string, getPose: (id: string) => Vec3) => {
      const pos = getPose(by)
      const near = distance2D(pos, NODE_POS[N.STAR]) <= 1.6
      if (!worldRef.current.starPresent || !near) return false
      setWorld((w) => ({ ...w, starPresent: false }))
      if (by === 'player') setPlayerInv((i) => ({ ...i, hasStar: true }))
      return true
    },
    
    setNpcInventory,
  })
  
  return {
    world,
    setWorld,
    boom,
    playerInv,
    setPlayerInv,
    npcInventories,
    setNpcInventory,
    worldOps,
  }
}

