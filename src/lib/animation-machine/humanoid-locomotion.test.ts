import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHumanoidLocomotionGraph, getRequiredClipNames, getBlendSpaceClipNames } from './humanoid-locomotion'
import { Animator } from './index'
import * as THREE from 'three'

// Mock Three.js AnimationMixer and related classes
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof THREE>('three')
  
  class MockAnimationAction {
    private _weight = 0
    private _time = 0
    private _running = false
    private _clip: THREE.AnimationClip
    
    constructor(clip: THREE.AnimationClip) {
      this._clip = clip
    }
    
    play() {
      this._running = true
      return this
    }
    
    stop() {
      this._running = false
      return this
    }
    
    reset() {
      this._time = 0
      return this
    }
    
    fadeIn(duration: number) {
      this._weight = 1
      return this
    }
    
    fadeOut(duration: number) {
      this._weight = 0
      return this
    }
    
    setEffectiveWeight(weight: number) {
      this._weight = weight
      return this
    }
    
    getEffectiveWeight() {
      return this._weight
    }
    
    setEffectiveTimeScale(scale: number) {
      return this
    }
    
    setLoop(mode: any, count: number) {
      return this
    }
    
    get time() {
      return this._time
    }
    
    set time(value: number) {
      this._time = value
    }
    
    get clampWhenFinished() {
      return false
    }
    
    set clampWhenFinished(value: boolean) {}
    
    get enabled() {
      return true
    }
    
    set enabled(value: boolean) {}
    
    isRunning() {
      return this._running
    }
    
    getClip() {
      return this._clip
    }
    
    crossFadeFrom(action: any, duration: number, warp: boolean) {
      return this
    }
  }
  
  class MockAnimationMixer {
    private _actions: Map<string, MockAnimationAction> = new Map()
    _root: any
    
    constructor(root: any) {
      this._root = root
    }
    
    clipAction(clip: THREE.AnimationClip, root?: any) {
      const key = clip.uuid
      if (!this._actions.has(key)) {
        this._actions.set(key, new MockAnimationAction(clip))
      }
      return this._actions.get(key)!
    }
    
    update(deltaTime: number) {}
    
    stopAllAction() {
      this._actions.clear()
    }
    
    uncacheAction(clip: THREE.AnimationClip, root: any) {}
    
    uncacheClip(clip: THREE.AnimationClip) {}
    
    uncacheRoot(root: any) {}
  }
  
  return {
    ...actual,
    AnimationMixer: MockAnimationMixer as any,
    LoopOnce: 2200,
    LoopRepeat: 2201,
    LoopPingPong: 2202,
    NormalAnimationBlendMode: 2500,
    AdditiveAnimationBlendMode: 2501,
  }
})

// Helper to create mock clips
function createMockClip(name: string, duration = 1.0): THREE.AnimationClip {
  return new THREE.AnimationClip(name, duration, [
    new THREE.VectorKeyframeTrack('dummy.position', [0, duration], [0, 0, 0, 1, 1, 1])
  ])
}

// Helper to create a mock object3D with clips
function createMockCharacter(clipNames: string[]): { object: THREE.Group; clips: THREE.AnimationClip[] } {
  const object = new THREE.Group()
  const clips = clipNames.map(name => createMockClip(name))
  return { object, clips }
}

describe('Humanoid Locomotion Animation Graph', () => {
  describe('Configuration Validation', () => {
    it('should create a valid animation graph config', () => {
      const config = createHumanoidLocomotionGraph()
      
      expect(config).toBeDefined()
      expect(config.parameters).toBeDefined()
      expect(config.layers).toHaveLength(2)
    })
    
    it('should have all required parameters', () => {
      const config = createHumanoidLocomotionGraph()
      
      expect(config.parameters.speedX).toBeDefined()
      expect(config.parameters.speedY).toBeDefined()
      expect(config.parameters.jump).toBeDefined()
      expect(config.parameters.grounded).toBeDefined()
      expect(config.parameters.attack).toBeDefined()
      expect(config.parameters.crouch).toBeDefined()
    })
    
    it('should have Base and UpperBody layers', () => {
      const config = createHumanoidLocomotionGraph()
      
      expect(config.layers[0].name).toBe('Base')
      expect(config.layers[1].name).toBe('UpperBody')
    })
    
    it('should have Idle as entry state for Base layer', () => {
      const config = createHumanoidLocomotionGraph()
      
      expect(config.layers[0].entry).toBe('Idle')
      expect(config.layers[0].states.Idle).toBeDefined()
    })
    
    it('should have separate Idle, Moving, and MovingBackward states', () => {
      const config = createHumanoidLocomotionGraph()
      
      expect(config.layers[0].states.Idle).toBeDefined()
      expect(config.layers[0].states.Moving).toBeDefined()
      expect(config.layers[0].states.MovingBackward).toBeDefined()
      
      // Idle should be a simple clip
      expect(config.layers[0].states.Idle.node.type).toBe('clip')
      
      // Moving should be a 1D blend space
      expect(config.layers[0].states.Moving.node.type).toBe('blend1d')
      if (config.layers[0].states.Moving.node.type === 'blend1d') {
        // 6 Walk samples + 4 Sprint samples = 10 total
        expect(config.layers[0].states.Moving.node.children).toHaveLength(10)
      }
      
      // MovingBackward should be a 1D blend space
      expect(config.layers[0].states.MovingBackward.node.type).toBe('blend1d')
      if (config.layers[0].states.MovingBackward.node.type === 'blend1d') {
        // 6 Walk samples at different speeds for granular control
        expect(config.layers[0].states.MovingBackward.node.children).toHaveLength(6)
      }
    })
    
    it('should use 2 unique clips in Moving blend space (Walk, Sprint)', () => {
      const clipNames = getBlendSpaceClipNames()
      expect(clipNames).toEqual([
        'Walk_Loop', 
        'Sprint_Loop',
      ])
    })
  })
  
  describe('Blend Space Weight Calculations', () => {
    let animator: Animator
    let mockObject: THREE.Group
    
    beforeEach(() => {
      const requiredClips = getRequiredClipNames()
      const { object, clips } = createMockCharacter(requiredClips)
      mockObject = object
      
      const config = createHumanoidLocomotionGraph()
      animator = new Animator(object, clips, config)
    })
    
    it('should initialize with speedX=0, speedY=0 (idle)', () => {
      expect(animator.get('speedX')).toBe(0)
      expect(animator.get('speedY')).toBe(0)
    })
    
    it('should sum blend weights to 1.0 at idle (0, 0)', () => {
      animator.set('speedX', 0)
      animator.set('speedY', 0)
      animator.update(0.016)
      
      const mixer = animator.mixer as any
      const actions = Array.from(mixer._actions.values())
      const baseLayerActions = actions.filter((a: any) => 
        a.isRunning() && 
        !a.getClip().name.includes('masked') &&
        a.getEffectiveWeight() > 0.001
      )
      
      const totalWeight = baseLayerActions.reduce((sum: number, a: any) => 
        sum + a.getEffectiveWeight(), 0
      )
      
      expect(totalWeight).toBeGreaterThanOrEqual(0.95)
      expect(totalWeight).toBeLessThanOrEqual(1.05)
    })
    
    it('should sum blend weights to 1.0 at small forward movement (0, 0.1)', () => {
      animator.set('speedX', 0)
      animator.set('speedY', 0.1)
      animator.update(0.016)
      
      const mixer = animator.mixer as any
      const actions = Array.from(mixer._actions.values())
      const baseLayerActions = actions.filter((a: any) => 
        a.isRunning() && 
        !a.getClip().name.includes('masked') &&
        a.getEffectiveWeight() > 0.001
      )
      
      const totalWeight = baseLayerActions.reduce((sum: number, a: any) => 
        sum + a.getEffectiveWeight(), 0
      )
      
      // THIS IS THE BUG BEING REPORTED: Weight should be ~1.0, not 0.47
      expect(totalWeight).toBeGreaterThanOrEqual(0.95)
      expect(totalWeight).toBeLessThanOrEqual(1.05)
    })
    
    it('should sum blend weights to 1.0 at full forward (0, 1.0)', () => {
      animator.set('speedX', 0)
      animator.set('speedY', 1.0)
      animator.update(0.016)
      
      const mixer = animator.mixer as any
      const actions = Array.from(mixer._actions.values())
      const baseLayerActions = actions.filter((a: any) => 
        a.isRunning() && 
        !a.getClip().name.includes('masked') &&
        a.getEffectiveWeight() > 0.001
      )
      
      const totalWeight = baseLayerActions.reduce((sum: number, a: any) => 
        sum + a.getEffectiveWeight(), 0
      )
      
      expect(totalWeight).toBeGreaterThanOrEqual(0.95)
      expect(totalWeight).toBeLessThanOrEqual(1.05)
    })
    
    it('should sum blend weights to 1.0 at diagonal movement (0.5, 0.5)', () => {
      animator.set('speedX', 0.5)
      animator.set('speedY', 0.5)
      animator.update(0.016)
      
      const mixer = animator.mixer as any
      const actions = Array.from(mixer._actions.values())
      const baseLayerActions = actions.filter((a: any) => 
        a.isRunning() && 
        !a.getClip().name.includes('masked') &&
        a.getEffectiveWeight() > 0.001
      )
      
      const totalWeight = baseLayerActions.reduce((sum: number, a: any) => 
        sum + a.getEffectiveWeight(), 0
      )
      
      expect(totalWeight).toBeGreaterThanOrEqual(0.95)
      expect(totalWeight).toBeLessThanOrEqual(1.05)
    })
    
    it('should sum blend weights to 1.0 across the entire parameter space', () => {
      const testPoints = [
        [0, 0], [0, 0.1], [0, 0.5], [0, 1],
        [0.5, 0], [0.5, 0.5], [0.5, 1],
        [1, 0], [1, 0.5], [1, 1],
        [-0.5, 0], [-0.5, 0.5], [-0.5, -0.5],
        [0, -0.5], [0, -1]
      ]
      
      for (const [x, y] of testPoints) {
        animator.set('speedX', x)
        animator.set('speedY', y)
        animator.update(0.016)
        
        const mixer = animator.mixer as any
        const actions = Array.from(mixer._actions.values())
        const baseLayerActions = actions.filter((a: any) => 
          a.isRunning() && 
          !a.getClip().name.includes('masked') &&
          a.getEffectiveWeight() > 0.001
        )
        
        const totalWeight = baseLayerActions.reduce((sum: number, a: any) => 
          sum + a.getEffectiveWeight(), 0
        )
        
        expect(totalWeight).toBeGreaterThanOrEqual(0.95)
        expect(totalWeight).toBeLessThanOrEqual(1.05)
      }
    })
  })
  
  describe('Missing Clips Handling', () => {
    it('should warn when blend space clip is missing', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      // Only provide Idle_Loop, missing Walk_Loop and Sprint_Loop
      const { object, clips } = createMockCharacter(['Idle_Loop'])
      const config = createHumanoidLocomotionGraph()
      const animator = new Animator(object, clips, config)
      
      animator.set('speedY', 0.5) // Try to transition to Moving state
      
      // Update multiple frames to complete transition (0.15s transition time)
      for (let i = 0; i < 15; i++) {
        animator.update(0.016)
      }
      
      // Should have warned about missing clips in the Moving state
      expect(consoleWarnSpy).toHaveBeenCalled()
      
      consoleWarnSpy.mockRestore()
    })
    
    it('should still produce weights summing to 1.0 even with missing clips', () => {
      // Only provide 2 out of 3 blend space clips
      const { object, clips } = createMockCharacter(['Idle_Loop', 'Walk_Loop'])
      const config = createHumanoidLocomotionGraph()
      const animator = new Animator(object, clips, config)
      
      animator.set('speedY', 0.5)
      
      // Update multiple frames to complete transition (0.15s transition time)
      for (let i = 0; i < 15; i++) {
        animator.update(0.016)
      }
      
      const mixer = animator.mixer as any
      const actions = Array.from(mixer._actions.values())
      const baseLayerActions = actions.filter((a: any) => 
        a.isRunning() && 
        !a.getClip().name.includes('masked') &&
        a.getEffectiveWeight() > 0.001
      )
      
      const totalWeight = baseLayerActions.reduce((sum: number, a: any) => 
        sum + a.getEffectiveWeight(), 0
      )
      
      // Even with missing clips, weights should be renormalized to sum to 1.0
      expect(totalWeight).toBeGreaterThanOrEqual(0.95)
      expect(totalWeight).toBeLessThanOrEqual(1.05)
    })
  })
  
  describe('Parameter Damping', () => {
    let animator: Animator
    
    beforeEach(() => {
      const requiredClips = getRequiredClipNames()
      const { object, clips } = createMockCharacter(requiredClips)
      const config = createHumanoidLocomotionGraph()
      animator = new Animator(object, clips, config)
    })
    
    it('should smoothly interpolate speedY with damping', () => {
      animator.set('speedY', 1.0)
      
      // After one frame, should not have reached target immediately
      animator.update(0.016)
      const speed1 = animator.get('speedY') as number
      expect(speed1).toBeGreaterThan(0)
      expect(speed1).toBeLessThan(1.0)
      
      // After many frames, should approach target
      for (let i = 0; i < 100; i++) {
        animator.update(0.016)
      }
      const speedFinal = animator.get('speedY') as number
      expect(speedFinal).toBeCloseTo(1.0, 1)
    })
  })
  
  describe('State Transitions', () => {
    let animator: Animator
    
    beforeEach(() => {
      const requiredClips = getRequiredClipNames()
      const { object, clips } = createMockCharacter(requiredClips)
      const config = createHumanoidLocomotionGraph()
      animator = new Animator(object, clips, config)
    })
    
    it('should transition to crouch when crouch parameter is true', () => {
      animator.set('crouch', true)
      
      // Update multiple frames to allow transition
      for (let i = 0; i < 10; i++) {
        animator.update(0.016)
      }
      
      // Should be in crouching state (verify by checking active clips)
      const mixer = animator.mixer as any
      const actions = Array.from(mixer._actions.values())
      const activeClipNames = actions
        .filter((a: any) => a.isRunning() && a.getEffectiveWeight() > 0.1)
        .map((a: any) => a.getClip().name)
      
      const hasCrouchClip = activeClipNames.some((name: string) => 
        name.includes('Crouch')
      )
      
      expect(hasCrouchClip).toBe(true)
    })
    
    it('should respect trigger for jump', () => {
      animator.set('grounded', true)
      animator.trigger('jump')
      
      // Triggers should be consumed after one frame
      animator.update(0.016)
      
      // Should have jump clip active
      const mixer = animator.mixer as any
      const actions = Array.from(mixer._actions.values())
      const activeClipNames = actions
        .filter((a: any) => a.isRunning() && a.getEffectiveWeight() > 0.1)
        .map((a: any) => a.getClip().name)
      
      const hasJumpClip = activeClipNames.some((name: string) => 
        name.includes('Jump')
      )
      
      expect(hasJumpClip).toBe(true)
    })
  })
})

