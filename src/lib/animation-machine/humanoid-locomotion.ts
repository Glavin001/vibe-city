import type { AnimGraphConfig } from './index'

/**
 * Humanoid locomotion animation graph configuration
 * 
 * This defines a 2-layer animation system:
 * - Base Layer: Full-body locomotion with 2D blend space
 * - Upper Body Layer: Masked to spine/arms for independent actions
 */
export function createHumanoidLocomotionGraph(): AnimGraphConfig {
  return {
    parameters: {
      // Locomotion parameters
      speedX: { type: 'float', default: 0, min: -1, max: 1, damp: 0.15 },
      speedY: { type: 'float', default: 0, min: -1, max: 1, damp: 0.15 },
      
      // State triggers
      jump: { type: 'trigger' },
      grounded: { type: 'bool', default: true },
      attack: { type: 'trigger' },
      crouch: { type: 'bool', default: false },
      
      // Upper body parameters
      upperBodyWeight: { type: 'float', default: 1, min: 0, max: 1, damp: 0.1 },
    },
    layers: [
      {
        name: 'Base',
        entry: 'Idle',
        weight: 1,
        states: {
          // IDLE STATE - standing still
          Idle: {
            node: {
              type: 'clip',
              motion: { clip: 'Idle_Loop', loop: 'repeat', speed: 1 }
            },
            transitions: [
              {
                to: 'Moving',
                conditions: [{ param: 'speedY', op: '>', value: 0.05 }],
                duration: 0.15,
                priority: 5
              },
              {
                to: 'MovingBackward',
                conditions: [{ param: 'speedY', op: '<', value: -0.05 }],
                duration: 0.15,
                priority: 5
              },
              {
                to: 'JumpStart',
                conditions: [
                  { trigger: 'jump' },
                  { param: 'grounded', op: '==', value: true }
                ],
                logic: 'all',
                duration: 0.1,
                priority: 10
              },
              {
                to: 'Crouching',
                conditions: [{ param: 'crouch', op: '==', value: true }],
                duration: 0.2,
                priority: 5
              }
            ],
            tags: ['idle']
          },
          
          // MOVING FORWARD STATE - blend space for Walk → Sprint (Jog removed due to gait mismatch)
          Moving: {
            node: {
              type: 'blend1d',
              parameter: 'speedY',
              children: [
                // Walk at various speeds (0.1 to 0.6)
                // Minimum animation speed is 0.7 to avoid slow-motion look
                { pos: 0.1, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: 0.7 } },
                { pos: 0.2, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: 0.7 } },
                { pos: 0.3, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: 0.7 } },
                { pos: 0.4, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: 0.85 } },
                { pos: 0.5, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: 1.0 } },
                { pos: 0.6, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: 1.15 } },
                // Sprint at various speeds (0.7 to 1.0)
                { pos: 0.7, motion: { clip: 'Sprint_Loop', loop: 'repeat', speed: 0.8 } },
                { pos: 0.8, motion: { clip: 'Sprint_Loop', loop: 'repeat', speed: 0.9 } },
                { pos: 0.9, motion: { clip: 'Sprint_Loop', loop: 'repeat', speed: 0.95 } },
                { pos: 1.0, motion: { clip: 'Sprint_Loop', loop: 'repeat', speed: 1.0 } },
              ]
            },
            transitions: [
              {
                to: 'Idle',
                conditions: [
                  { param: 'speedY', op: '<=', value: 0.05 },
                  { param: 'speedY', op: '>=', value: -0.05 }
                ],
                logic: 'all',
                duration: 0.2,
                priority: 5
              },
              {
                to: 'MovingBackward',
                conditions: [{ param: 'speedY', op: '<', value: -0.05 }],
                duration: 0.2,
                priority: 5
              },
              {
                to: 'JumpStart',
                conditions: [
                  { trigger: 'jump' },
                  { param: 'grounded', op: '==', value: true }
                ],
                logic: 'all',
                duration: 0.1,
                priority: 10
              },
              {
                to: 'Crouching',
                conditions: [{ param: 'crouch', op: '==', value: true }],
                duration: 0.2,
                priority: 5
              }
            ],
            tags: ['movement']
          },
          
          // MOVING BACKWARD STATE - reversed walk animation with speed scaling
          // Mirror the forward movement granularity (6 samples for walk range)
          MovingBackward: {
            node: {
              type: 'blend1d',
              parameter: 'speedY',
              children: [
                // Minimum animation speed is 0.7 (absolute value) to avoid slow-motion look
                { pos: -0.1, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: -0.7 } },
                { pos: -0.2, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: -0.7 } },
                { pos: -0.3, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: -0.7 } },
                { pos: -0.4, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: -0.85 } },
                { pos: -0.5, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: -1.0 } },
                { pos: -0.6, motion: { clip: 'Walk_Loop', loop: 'repeat', speed: -1.15 } },
              ]
            },
            transitions: [
              {
                to: 'Idle',
                conditions: [
                  { param: 'speedY', op: '<=', value: 0.05 },
                  { param: 'speedY', op: '>=', value: -0.05 }
                ],
                logic: 'all',
                duration: 0.2,
                priority: 5
              },
              {
                to: 'Moving',
                conditions: [{ param: 'speedY', op: '>', value: 0.05 }],
                duration: 0.2,
                priority: 5
              },
              {
                to: 'JumpStart',
                conditions: [
                  { trigger: 'jump' },
                  { param: 'grounded', op: '==', value: true }
                ],
                logic: 'all',
                duration: 0.1,
                priority: 10
              },
              {
                to: 'Crouching',
                conditions: [{ param: 'crouch', op: '==', value: true }],
                duration: 0.2,
                priority: 5
              }
            ],
            tags: ['movement']
          },
          
          // Crouch state
          Crouching: {
            node: {
              type: 'blend1d',
              parameter: 'speedY',
              children: [
                // Backwards
                { pos: -1, motion: { clip: 'Crouch_Fwd_Loop', loop: 'repeat', speed: -1 } },
                { pos: -0.5, motion: { clip: 'Crouch_Fwd_Loop', loop: 'repeat', speed: -0.7 } },
                // Idle
                { pos: 0, motion: { clip: 'Crouch_Idle_Loop', loop: 'repeat' } },
                // Forward
                { pos: 0.5, motion: { clip: 'Crouch_Fwd_Loop', loop: 'repeat' } },
                { pos: 1, motion: { clip: 'Crouch_Fwd_Loop', loop: 'repeat', speed: 1.2 } },
              ]
            },
            transitions: [
              {
                to: 'Idle',
                conditions: [{ param: 'crouch', op: '==', value: false }],
                duration: 0.2,
                priority: 5
              }
            ]
          },
          
          // Jump sequence
          JumpStart: {
            node: {
              type: 'clip',
              motion: { clip: 'Jump_Start', loop: 'once', speed: 1.2 }
            },
            transitions: [
              {
                to: 'JumpLoop',
                hasExitTime: true,
                exitTime: 0.9,
                duration: 0.1,
                priority: 10
              }
            ]
          },
          
          JumpLoop: {
            node: {
              type: 'clip',
              motion: { clip: 'Jump_Loop', loop: 'repeat', speed: 1 }
            },
            transitions: [
              {
                to: 'JumpLand',
                conditions: [{ param: 'grounded', op: '==', value: true }],
                duration: 0.1,
                priority: 10
              }
            ]
          },
          
          JumpLand: {
            node: {
              type: 'clip',
              motion: { clip: 'Jump_Land', loop: 'once', speed: 1.2 }
            },
            transitions: [
              {
                to: 'Moving',
                hasExitTime: true,
                exitTime: 0.85,
                conditions: [{ param: 'speedY', op: '>', value: 0.05 }],
                duration: 0.15,
                priority: 10
              },
              {
                to: 'MovingBackward',
                hasExitTime: true,
                exitTime: 0.85,
                conditions: [{ param: 'speedY', op: '<', value: -0.05 }],
                duration: 0.15,
                priority: 9
              },
              {
                to: 'Idle',
                hasExitTime: true,
                exitTime: 0.85,
                duration: 0.15,
                priority: 8
              }
            ]
          }
        }
      },
      
      // Upper body layer for attacks
      {
        name: 'UpperBody',
        entry: 'Idle',
        weight: 1,
        mask: {
          bones: ['Spine', 'Chest', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 
                  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'],
          includeChildren: true
        },
        states: {
          Idle: {
            node: {
              type: 'clip',
              motion: { clip: 'Idle_Loop', loop: 'repeat' }
            },
            transitions: [
              {
                to: 'Attack',
                conditions: [{ trigger: 'attack' }],
                duration: 0.08,
                priority: 10
              }
            ]
          },
          
          Attack: {
            node: {
              type: 'clip',
              motion: { clip: 'Punch_Jab', loop: 'once', speed: 0.6 }
            },
            transitions: [
              {
                to: 'Idle',
                hasExitTime: true,
                exitTime: 0.95,
                duration: 0.15
              }
            ]
          }
        }
      }
    ]
  }
}

/**
 * Get all required clip names for this animation graph
 */
export function getRequiredClipNames(): string[] {
  return [
    // Base layer
    'Idle_Loop',
    'Walk_Loop',
    // 'Jog_Fwd_Loop', // Removed: gait mismatch with Walk/Sprint
    'Sprint_Loop',
    'Crouch_Idle_Loop',
    'Crouch_Fwd_Loop',
    'Jump_Start',
    'Jump_Loop',
    'Jump_Land',
    // Upper body
    'Punch_Jab',
  ]
}

/**
 * Get blend space clip names (used in Moving state blend)
 */
export function getBlendSpaceClipNames(): string[] {
  return ['Walk_Loop', 'Sprint_Loop']
}

