/**
 * WGSL Physics Compute Shader
 *
 * GPU-based rigid body physics with SDF collision detection.
 * Supports spheres, boxes, and capsules colliding against a static SDF environment.
 */

export const physicsComputeShader = /* wgsl */ `

// ============================================================================
// Uniforms
// ============================================================================

struct Uniforms {
  worldToSdf : mat4x4<f32>,
  sdfToWorld : mat4x4<f32>,
  dt         : f32,
  gravity    : f32,
  numBodies  : u32,
  sdfDim     : u32,
}

// ============================================================================
// Body Structure (96 bytes = 24 floats per body)
// ============================================================================

struct Body {
  // vec4 0: position.xyz, invMass
  pos_invMass    : vec4<f32>,
  // vec4 1: velocity.xyz, bodyType
  vel_type       : vec4<f32>,
  // vec4 2: rotation quaternion (x, y, z, w)
  rotation       : vec4<f32>,
  // vec4 3: angular velocity.xyz, flags
  angVel_flags   : vec4<f32>,
  // vec4 4: shapeType, param0, param1, param2
  shape_params   : vec4<f32>,
  // vec4 5: gravityScale, linearDamping, angularDamping, restitution
  extra_params   : vec4<f32>,
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var sdfTex : texture_3d<f32>;
@group(0) @binding(1) var sdfSampler : sampler;
@group(0) @binding(2) var<uniform> uniforms : Uniforms;
@group(0) @binding(3) var<storage, read_write> bodies : array<Body>;

// ============================================================================
// Constants
// ============================================================================

const SHAPE_BALL : f32 = 0.0;
const SHAPE_BOX : f32 = 1.0;
const SHAPE_CAPSULE : f32 = 2.0;

const BODY_DYNAMIC : f32 = 0.0;
const BODY_FIXED : f32 = 1.0;
const BODY_KINEMATIC_POS : f32 = 2.0;
const BODY_KINEMATIC_VEL : f32 = 3.0;

const PI : f32 = 3.14159265359;

// ============================================================================
// Quaternion Operations
// ============================================================================

fn quatMul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let w = a.w * b.w - dot(a.xyz, b.xyz);
  let v = a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz);
  return vec4<f32>(v, w);
}

fn quatConjugate(q: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(-q.xyz, q.w);
}

fn quatRotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let qv = vec4<f32>(v, 0.0);
  let qi = quatConjugate(q);
  return quatMul(quatMul(q, qv), qi).xyz;
}

fn quatFromAxisAngle(axis: vec3<f32>, angle: f32) -> vec4<f32> {
  let halfAngle = angle * 0.5;
  let s = sin(halfAngle);
  return vec4<f32>(axis * s, cos(halfAngle));
}

fn quatNormalize(q: vec4<f32>) -> vec4<f32> {
  let len = length(q);
  if (len < 0.0001) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  return q / len;
}

// ============================================================================
// SDF Sampling
// ============================================================================

fn worldToSdfCoord(p: vec3<f32>) -> vec3<f32> {
  let hp = uniforms.worldToSdf * vec4<f32>(p, 1.0);
  // worldToSdf maps to [-0.5, 0.5]^3; convert to [0, 1]^3
  let q = hp.xyz + vec3<f32>(0.5);
  return clamp(q, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn sampleSdf(p: vec3<f32>) -> f32 {
  let uvw = worldToSdfCoord(p);
  return textureSampleLevel(sdfTex, sdfSampler, uvw, 0.0).r;
}

fn sdfGradient(p: vec3<f32>) -> vec3<f32> {
  let eps = 0.05;
  let dx = vec3<f32>(eps, 0.0, 0.0);
  let dy = vec3<f32>(0.0, eps, 0.0);
  let dz = vec3<f32>(0.0, 0.0, eps);

  let gx = sampleSdf(p + dx) - sampleSdf(p - dx);
  let gy = sampleSdf(p + dy) - sampleSdf(p - dy);
  let gz = sampleSdf(p + dz) - sampleSdf(p - dz);

  let grad = vec3<f32>(gx, gy, gz);
  let len = length(grad);
  if (len < 0.0001) {
    return vec3<f32>(0.0, 1.0, 0.0); // Default up
  }
  return grad / len;
}

// ============================================================================
// Analytic Shape SDFs
// ============================================================================

fn sphereSdf(p: vec3<f32>, radius: f32) -> f32 {
  return length(p) - radius;
}

fn boxSdf(p: vec3<f32>, halfExtents: vec3<f32>) -> f32 {
  let q = abs(p) - halfExtents;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn capsuleSdf(p: vec3<f32>, halfHeight: f32, radius: f32) -> f32 {
  // Capsule along Y axis
  let py = clamp(p.y, -halfHeight, halfHeight);
  let closestPoint = vec3<f32>(0.0, py, 0.0);
  return length(p - closestPoint) - radius;
}

// ============================================================================
// Collision Detection and Response
// ============================================================================

struct ContactInfo {
  hit : bool,
  penetration : f32,
  normal : vec3<f32>,
  contactPoint : vec3<f32>,
}

fn detectBallCollision(center: vec3<f32>, radius: f32) -> ContactInfo {
  var info : ContactInfo;
  info.hit = false;

  let phi = sampleSdf(center);

  if (phi < radius) {
    info.hit = true;
    info.penetration = radius - phi;
    info.normal = sdfGradient(center);
    info.contactPoint = center - info.normal * phi;
  }

  return info;
}

fn detectBoxCollision(center: vec3<f32>, rotation: vec4<f32>, halfExtents: vec3<f32>) -> ContactInfo {
  var info : ContactInfo;
  info.hit = false;

  // Sample corners and center
  var bestPhi : f32 = 1e9;
  var bestPoint = center;

  // 8 corners
  let corners = array<vec3<f32>, 8>(
    vec3<f32>(-1.0, -1.0, -1.0),
    vec3<f32>(-1.0, -1.0,  1.0),
    vec3<f32>(-1.0,  1.0, -1.0),
    vec3<f32>(-1.0,  1.0,  1.0),
    vec3<f32>( 1.0, -1.0, -1.0),
    vec3<f32>( 1.0, -1.0,  1.0),
    vec3<f32>( 1.0,  1.0, -1.0),
    vec3<f32>( 1.0,  1.0,  1.0),
  );

  for (var c = 0u; c < 8u; c++) {
    let local = corners[c] * halfExtents;
    let worldP = center + quatRotate(rotation, local);
    let phi = sampleSdf(worldP);

    if (phi < bestPhi) {
      bestPhi = phi;
      bestPoint = worldP;
    }
  }

  // Also check center
  let centerPhi = sampleSdf(center);
  if (centerPhi < bestPhi) {
    bestPhi = centerPhi;
    bestPoint = center;
  }

  // Check edge midpoints for better coverage
  let edges = array<vec3<f32>, 12>(
    vec3<f32>(-1.0, -1.0,  0.0),
    vec3<f32>(-1.0,  1.0,  0.0),
    vec3<f32>( 1.0, -1.0,  0.0),
    vec3<f32>( 1.0,  1.0,  0.0),
    vec3<f32>(-1.0,  0.0, -1.0),
    vec3<f32>(-1.0,  0.0,  1.0),
    vec3<f32>( 1.0,  0.0, -1.0),
    vec3<f32>( 1.0,  0.0,  1.0),
    vec3<f32>( 0.0, -1.0, -1.0),
    vec3<f32>( 0.0, -1.0,  1.0),
    vec3<f32>( 0.0,  1.0, -1.0),
    vec3<f32>( 0.0,  1.0,  1.0),
  );

  for (var e = 0u; e < 12u; e++) {
    let local = edges[e] * halfExtents;
    let worldP = center + quatRotate(rotation, local);
    let phi = sampleSdf(worldP);

    if (phi < bestPhi) {
      bestPhi = phi;
      bestPoint = worldP;
    }
  }

  if (bestPhi < 0.0) {
    info.hit = true;
    info.penetration = -bestPhi;
    info.normal = sdfGradient(bestPoint);
    info.contactPoint = bestPoint;
  }

  return info;
}

fn detectCapsuleCollision(center: vec3<f32>, rotation: vec4<f32>, halfHeight: f32, radius: f32) -> ContactInfo {
  var info : ContactInfo;
  info.hit = false;

  // Sample top, bottom, and middle spheres
  let up = quatRotate(rotation, vec3<f32>(0.0, 1.0, 0.0));
  let top = center + up * halfHeight;
  let bottom = center - up * halfHeight;
  let mid = center;

  var bestPhi : f32 = 1e9;
  var bestPoint = center;

  // Check top sphere
  let topPhi = sampleSdf(top);
  if (topPhi < bestPhi) {
    bestPhi = topPhi;
    bestPoint = top;
  }

  // Check bottom sphere
  let bottomPhi = sampleSdf(bottom);
  if (bottomPhi < bestPhi) {
    bestPhi = bottomPhi;
    bestPoint = bottom;
  }

  // Check middle
  let midPhi = sampleSdf(mid);
  if (midPhi < bestPhi) {
    bestPhi = midPhi;
    bestPoint = mid;
  }

  if (bestPhi < radius) {
    info.hit = true;
    info.penetration = radius - bestPhi;
    info.normal = sdfGradient(bestPoint);
    info.contactPoint = bestPoint - info.normal * bestPhi;
  }

  return info;
}

// ============================================================================
// Physics Response
// ============================================================================

fn applyCollisionResponse(
  body: ptr<function, Body>,
  contact: ContactInfo,
  dt: f32
) {
  let invMass = (*body).pos_invMass.w;
  let restitution = (*body).extra_params.w;

  if (invMass <= 0.0) {
    return; // Fixed body
  }

  let vel = (*body).vel_type.xyz;
  let angVel = (*body).angVel_flags.xyz;
  let pos = (*body).pos_invMass.xyz;

  // Relative velocity at contact point
  let r = contact.contactPoint - pos;
  let velAtContact = vel + cross(angVel, r);

  // Normal velocity
  let vn = dot(velAtContact, contact.normal);

  // Only respond if moving into surface
  if (vn < 0.0) {
    // Impulse magnitude (simplified, ignoring inertia tensor)
    let j = -(1.0 + restitution) * vn;

    // Apply linear impulse
    let linearImpulse = contact.normal * j * invMass;
    (*body).vel_type = vec4<f32>(vel + linearImpulse, (*body).vel_type.w);

    // Apply angular impulse (simplified)
    let angularImpulse = cross(r, contact.normal * j) * invMass * 0.5;
    (*body).angVel_flags = vec4<f32>(angVel + angularImpulse, (*body).angVel_flags.w);
  }

  // Positional correction (depenetration)
  let correction = contact.normal * contact.penetration * 0.8;
  (*body).pos_invMass = vec4<f32>(pos + correction, invMass);
}

// ============================================================================
// Integration
// ============================================================================

fn integrateBody(body: ptr<function, Body>, dt: f32) {
  let invMass = (*body).pos_invMass.w;
  let bodyType = (*body).vel_type.w;

  // Skip fixed bodies
  if (invMass <= 0.0 || bodyType == BODY_FIXED) {
    return;
  }

  let gravityScale = (*body).extra_params.x;
  let linearDamping = (*body).extra_params.y;
  let angularDamping = (*body).extra_params.z;

  // Get current state
  var pos = (*body).pos_invMass.xyz;
  var vel = (*body).vel_type.xyz;
  var rot = (*body).rotation;
  var angVel = (*body).angVel_flags.xyz;

  // Apply gravity
  let gravity = vec3<f32>(0.0, -uniforms.gravity * gravityScale, 0.0);
  vel += gravity * dt;

  // Apply damping
  vel *= (1.0 - linearDamping * dt);
  angVel *= (1.0 - angularDamping * dt);

  // Integrate position
  pos += vel * dt;

  // Integrate rotation
  let omega = angVel;
  let omegaLen = length(omega);
  if (omegaLen > 0.0001) {
    let axis = omega / omegaLen;
    let angle = omegaLen * dt;
    let dq = quatFromAxisAngle(axis, angle);
    rot = quatNormalize(quatMul(dq, rot));
  }

  // Write back
  (*body).pos_invMass = vec4<f32>(pos, invMass);
  (*body).vel_type = vec4<f32>(vel, bodyType);
  (*body).rotation = rot;
  (*body).angVel_flags = vec4<f32>(angVel, (*body).angVel_flags.w);
}

// ============================================================================
// Simple Ground Plane Check (fallback for SDF issues)
// ============================================================================

fn detectGroundCollision(center: vec3<f32>, radius: f32, groundY: f32) -> ContactInfo {
  var info : ContactInfo;
  info.hit = false;

  let bottomY = center.y - radius;

  if (bottomY < groundY) {
    info.hit = true;
    info.penetration = groundY - bottomY;
    info.normal = vec3<f32>(0.0, 1.0, 0.0);
    info.contactPoint = vec3<f32>(center.x, groundY, center.z);
  }

  return info;
}

fn detectBoxGroundCollision(center: vec3<f32>, rotation: vec4<f32>, halfExtents: vec3<f32>, groundY: f32) -> ContactInfo {
  var info : ContactInfo;
  info.hit = false;

  // Check all 8 corners against ground
  let corners = array<vec3<f32>, 8>(
    vec3<f32>(-1.0, -1.0, -1.0),
    vec3<f32>(-1.0, -1.0,  1.0),
    vec3<f32>(-1.0,  1.0, -1.0),
    vec3<f32>(-1.0,  1.0,  1.0),
    vec3<f32>( 1.0, -1.0, -1.0),
    vec3<f32>( 1.0, -1.0,  1.0),
    vec3<f32>( 1.0,  1.0, -1.0),
    vec3<f32>( 1.0,  1.0,  1.0),
  );

  var deepestPenetration : f32 = 0.0;
  var deepestPoint = center;

  for (var c = 0u; c < 8u; c++) {
    let local = corners[c] * halfExtents;
    let worldP = center + quatRotate(rotation, local);

    if (worldP.y < groundY) {
      let pen = groundY - worldP.y;
      if (pen > deepestPenetration) {
        deepestPenetration = pen;
        deepestPoint = worldP;
      }
    }
  }

  if (deepestPenetration > 0.0) {
    info.hit = true;
    info.penetration = deepestPenetration;
    info.normal = vec3<f32>(0.0, 1.0, 0.0);
    info.contactPoint = deepestPoint;
  }

  return info;
}

// ============================================================================
// Physics Constants
// ============================================================================

const BAUMGARTE_FACTOR : f32 = 0.5;          // Penetration correction rate (higher = faster correction)
const MAX_CORRECTION : f32 = 0.2;            // Max correction per frame (meters)
const SLEEP_LINEAR_THRESHOLD : f32 = 0.12;   // Linear velocity sleep threshold
const SLEEP_ANGULAR_THRESHOLD : f32 = 0.08;  // Angular velocity sleep threshold
const MIN_BOUNCE_VELOCITY : f32 = 0.4;       // Min velocity to apply restitution
const FRICTION_COEFFICIENT : f32 = 0.5;      // Ground friction (higher = more friction)
const CONTACT_SLOP : f32 = 0.005;            // Allowed penetration before correction
const FLAT_SURFACE_THRESHOLD : f32 = 0.97;   // Normal.y > this = flat surface (cos ~14 degrees)

// ============================================================================
// Main Compute Entry Point
// ============================================================================

@compute @workgroup_size(64)
fn stepBodies(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;

  if (i >= uniforms.numBodies) {
    return;
  }

  var body = bodies[i];

  let bodyType = body.vel_type.w;

  // Skip fixed/kinematic bodies for physics sim
  if (bodyType != BODY_DYNAMIC) {
    bodies[i] = body;
    return;
  }

  let dt = uniforms.dt;
  let invMass = body.pos_invMass.w;
  let gravityScale = body.extra_params.x;
  let linearDamping = body.extra_params.y;
  let angularDamping = body.extra_params.z;
  let restitution = body.extra_params.w;

  // Get current state
  var pos = body.pos_invMass.xyz;
  var vel = body.vel_type.xyz;
  var rot = body.rotation;
  var angVel = body.angVel_flags.xyz;

  // Gravity vector
  let gravityVec = vec3<f32>(0.0, -uniforms.gravity * gravityScale, 0.0);
  let shapeType = body.shape_params.x;

  // ========================================================================
  // STEP 1: Collision detection at current position
  // ========================================================================
  var contact : ContactInfo;

  if (shapeType == SHAPE_BALL) {
    let radius = body.shape_params.y;
    contact = detectBallCollision(pos, radius);
  } else if (shapeType == SHAPE_BOX) {
    let halfExtents = vec3<f32>(body.shape_params.y, body.shape_params.z, body.shape_params.w);
    contact = detectBoxCollision(pos, rot, halfExtents);
  } else if (shapeType == SHAPE_CAPSULE) {
    let radius = body.shape_params.y;
    let halfHeight = body.shape_params.z;
    contact = detectCapsuleCollision(pos, rot, halfHeight, radius);
  }

  // ========================================================================
  // STEP 2: Position correction FIRST (before velocity changes)
  // This prevents the oscillation caused by: correct position -> add velocity -> penetrate again
  // ========================================================================
  if (contact.hit && contact.penetration > CONTACT_SLOP) {
    let correction = min((contact.penetration - CONTACT_SLOP) * BAUMGARTE_FACTOR, MAX_CORRECTION);
    pos = pos + contact.normal * correction;
  }

  // ========================================================================
  // STEP 3: Determine surface type and contact state
  // ========================================================================
  let isOnFlatSurface = contact.hit && contact.normal.y > FLAT_SURFACE_THRESHOLD;
  let isOnSlope = contact.hit && contact.normal.y <= FLAT_SURFACE_THRESHOLD && contact.normal.y > 0.1;
  let isOnSteepSurface = contact.hit && contact.normal.y <= 0.1; // Nearly vertical or overhang
  
  // Decompose gravity into normal and tangential components relative to surface
  var gravityNormal = vec3<f32>(0.0);
  var gravityTangent = gravityVec;
  if (contact.hit) {
    gravityNormal = dot(gravityVec, contact.normal) * contact.normal;
    gravityTangent = gravityVec - gravityNormal;
  }

  // ========================================================================
  // STEP 4: Apply damping
  // ========================================================================
  let linearDampFactor = 1.0 - min(linearDamping * dt, 0.3);
  let angularDampFactor = 1.0 - min(angularDamping * dt, 0.3);
  vel *= linearDampFactor;
  angVel *= angularDampFactor;

  // ========================================================================
  // STEP 5: Physics response based on contact state
  // ========================================================================
  if (contact.hit) {
    let r = contact.contactPoint - pos;
    let velAtContact = vel + cross(angVel, r);
    let vn = dot(vel, contact.normal);
    let speed = length(vel);
    
    if (isOnFlatSurface) {
      // ====================================================================
      // FLAT SURFACE: Body should settle and come to rest
      // ====================================================================
      
      // Cancel normal velocity component (surface support)
      if (vn < 0.0) {
        vel = vel - contact.normal * vn;
      }
      
      // Apply gravity (will be mostly cancelled by surface next frame)
      vel += gravityVec * dt;
      
      // Re-cancel any normal velocity that would push into surface
      let vnAfter = dot(vel, contact.normal);
      if (vnAfter < 0.0) {
        vel = vel - contact.normal * vnAfter;
      }
      
      // Strong friction on flat surfaces
      let tangentVel = vel - contact.normal * dot(vel, contact.normal);
      let tangentSpeed = length(tangentVel);
      if (tangentSpeed > 0.001) {
        let frictionForce = min(tangentSpeed, FRICTION_COEFFICIENT * uniforms.gravity * dt);
        vel = vel - normalize(tangentVel) * frictionForce;
      }
      
      // Aggressive settling damping
      let finalSpeed = length(vel);
      if (finalSpeed < 0.3) {
        vel *= 0.7;  // Strong damping for slow bodies
        angVel *= 0.7;
      }
      if (finalSpeed < 0.1) {
        vel *= 0.5;  // Even stronger for very slow
        angVel *= 0.5;
      }
      if (finalSpeed < 0.05) {
        vel = vec3<f32>(0.0);
        angVel = vec3<f32>(0.0);
      }
      
    } else if (isOnSlope) {
      // ====================================================================
      // SLOPE: Body should roll/slide down
      // ====================================================================
      
      // Apply full gravity
      vel += gravityVec * dt;
      
      // Only cancel velocity component that would push INTO the surface
      let vnNew = dot(vel, contact.normal);
      if (vnNew < 0.0) {
        vel = vel - contact.normal * vnNew;
      }
      
      // Rolling physics for spheres on slopes
      if (shapeType == SHAPE_BALL) {
        let radius = body.shape_params.y;
        let tangentVel = vel - contact.normal * dot(vel, contact.normal);
        let tangentSpeed = length(tangentVel);
        
        if (tangentSpeed > 0.05) {
          let tangentDir = tangentVel / tangentSpeed;
          let rollAxis = cross(contact.normal, tangentDir);
          let targetAngVel = tangentSpeed / radius;
          // Blend toward rolling (pure rolling = no slip)
          angVel = angVel * 0.8 + rollAxis * targetAngVel * 0.2;
        }
      }
      
      // Rolling/tumbling for boxes on slopes
      if (shapeType == SHAPE_BOX) {
        let tangentVel = vel - contact.normal * dot(vel, contact.normal);
        let tangentSpeed = length(tangentVel);
        
        if (tangentSpeed > 0.1) {
          let tangentDir = tangentVel / tangentSpeed;
          let rollAxis = cross(contact.normal, tangentDir);
          // Boxes tumble more chaotically
          angVel = angVel * 0.9 + rollAxis * tangentSpeed * 0.3;
        }
      }
      
      // Light friction on slopes (allows rolling but prevents infinite acceleration)
      let tangentVel = vel - contact.normal * dot(vel, contact.normal);
      let tangentSpeed = length(tangentVel);
      if (tangentSpeed > 0.01) {
        let frictionForce = FRICTION_COEFFICIENT * 0.3 * uniforms.gravity * dt;
        if (frictionForce < tangentSpeed) {
          vel = vel - normalize(tangentVel) * frictionForce;
        }
      }
      
    } else if (isOnSteepSurface) {
      // ====================================================================
      // STEEP/VERTICAL: Body slides off, minimal support
      // ====================================================================
      
      // Apply full gravity
      vel += gravityVec * dt;
      
      // Only prevent penetration, don't provide support
      let vnNew = dot(vel, contact.normal);
      if (vnNew < 0.0) {
        // Partial reflection for bouncing off walls
        vel = vel - contact.normal * vnNew * 1.1;
      }
      
    } else {
      // ====================================================================
      // COLLISION: Impact response
      // ====================================================================
      
      // Apply gravity
      vel += gravityVec * dt;
      
      let vnImpact = dot(vel, contact.normal);
      
      if (vnImpact < 0.0) {
        let impactSpeed = -vnImpact;
        
        // Reduced restitution for slow impacts
        var effectiveRestitution = restitution;
        if (impactSpeed < MIN_BOUNCE_VELOCITY) {
          effectiveRestitution = 0.0;
        } else if (impactSpeed < MIN_BOUNCE_VELOCITY * 2.0) {
          let t = (impactSpeed - MIN_BOUNCE_VELOCITY) / MIN_BOUNCE_VELOCITY;
          effectiveRestitution = restitution * t * t; // Quadratic falloff
        }
        
        // Impulse
        let j = -(1.0 + effectiveRestitution) * vnImpact;
        vel = vel + contact.normal * j;
        
        // Angular impulse from off-center contact
        let rCrossN = cross(r, contact.normal);
        angVel = angVel + rCrossN * j * invMass * 0.3;
        
        // Friction impulse
        let tangentVel = vel - contact.normal * dot(vel, contact.normal);
        let tangentSpeed = length(tangentVel);
        if (tangentSpeed > 0.01) {
          let tangentDir = tangentVel / tangentSpeed;
          let frictionImpulse = min(tangentSpeed * 0.5, j * FRICTION_COEFFICIENT);
          vel = vel - tangentDir * frictionImpulse;
        }
      }
    }
    
  } else {
    // ========================================================================
    // NO CONTACT: Free fall
    // ========================================================================
    vel += gravityVec * dt;
  }

  // ========================================================================
  // STEP 6: Global sleep detection
  // ========================================================================
  let linearSpeed = length(vel);
  let angularSpeed = length(angVel);
  
  // Bodies in contact with low velocity get aggressive damping
  if (contact.hit && linearSpeed < SLEEP_LINEAR_THRESHOLD && angularSpeed < SLEEP_ANGULAR_THRESHOLD) {
    vel *= 0.6;
    angVel *= 0.6;
    
    // Zero out very small velocities
    if (linearSpeed < SLEEP_LINEAR_THRESHOLD * 0.25) {
      vel = vec3<f32>(0.0);
    }
    if (angularSpeed < SLEEP_ANGULAR_THRESHOLD * 0.25) {
      angVel = vec3<f32>(0.0);
    }
  }

  // ========================================================================
  // STEP 7: Position integration
  // ========================================================================
  pos = pos + vel * dt;

  // ========================================================================
  // STEP 8: Rotation integration
  // ========================================================================
  let omegaLen = length(angVel);
  if (omegaLen > 0.0001) {
    let axis = angVel / omegaLen;
    let angle = omegaLen * dt;
    let dq = quatFromAxisAngle(axis, angle);
    rot = quatNormalize(quatMul(dq, rot));
  }

  // ========================================================================
  // STEP 9: Write back
  // ========================================================================
  body.pos_invMass = vec4<f32>(pos, invMass);
  body.vel_type = vec4<f32>(vel, bodyType);
  body.rotation = rot;
  body.angVel_flags = vec4<f32>(angVel, body.angVel_flags.w);

  bodies[i] = body;
}
`;




