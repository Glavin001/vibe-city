/**
 * WGSL Render Shaders
 *
 * WebGPU shaders for rendering rigid bodies as instanced geometry.
 * Reads body transforms directly from the physics buffer.
 */

export const instanceShader = /* wgsl */ `

// ============================================================================
// Uniforms
// ============================================================================

struct CameraUniforms {
  view : mat4x4<f32>,
  projection : mat4x4<f32>,
  viewProjection : mat4x4<f32>,
  cameraPosition : vec3<f32>,
  geometryType : f32, // 0 = sphere, 1 = box
}

struct Body {
  pos_invMass    : vec4<f32>,
  vel_type       : vec4<f32>,
  rotation       : vec4<f32>,
  angVel_flags   : vec4<f32>,
  shape_params   : vec4<f32>,
  extra_params   : vec4<f32>,
}

@group(0) @binding(0) var<uniform> camera : CameraUniforms;
@group(0) @binding(1) var<storage, read> bodies : array<Body>;

// ============================================================================
// Vertex Input/Output
// ============================================================================

struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @builtin(instance_index) instanceId : u32,
}

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) velocity : vec3<f32>,
  @location(3) @interpolate(flat) shapeType : u32,
  @location(4) @interpolate(flat) instanceId : u32,
  @location(5) @interpolate(flat) bodyType : u32,
}

// ============================================================================
// Quaternion Operations
// ============================================================================

fn quatRotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

// ============================================================================
// Vertex Shader
// ============================================================================

@vertex
fn vs_main(input : VertexInput) -> VertexOutput {
  var output : VertexOutput;

  let body = bodies[input.instanceId];
  let pos = body.pos_invMass.xyz;
  let rot = body.rotation;
  let shapeType = u32(body.shape_params.x);
  let geometryType = u32(camera.geometryType);

  // Check if this geometry pass matches the shape type
  // geometryType 0 = sphere geometry, shapeType 0 = ball
  // geometryType 1 = box geometry, shapeType 1 = box
  let shouldRender = (geometryType == 0u && shapeType == 0u) ||
                     (geometryType == 1u && shapeType == 1u) ||
                     (geometryType == 0u && shapeType == 2u); // Capsules use sphere geometry

  if (!shouldRender) {
    // Move vertex far away (effectively culling it)
    output.position = vec4<f32>(0.0, 0.0, -1000.0, 1.0);
    output.worldPos = vec3<f32>(0.0);
    output.normal = vec3<f32>(0.0, 1.0, 0.0);
    output.velocity = vec3<f32>(0.0);
    output.shapeType = shapeType;
    output.instanceId = input.instanceId;
    output.bodyType = 0u;
    return output;
  }

  // Scale vertex based on shape
  var scaledPos = input.position;
  var scaledNormal = input.normal;

  if (shapeType == 0u) {
    // Ball: uniform scale by radius
    let radius = body.shape_params.y;
    scaledPos *= radius;
  } else if (shapeType == 1u) {
    // Box: scale by half extents
    let halfExtents = vec3<f32>(body.shape_params.y, body.shape_params.z, body.shape_params.w);
    scaledPos *= halfExtents;
  } else if (shapeType == 2u) {
    // Capsule: scale differently
    let radius = body.shape_params.y;
    let halfHeight = body.shape_params.z;
    scaledPos.x *= radius;
    scaledPos.z *= radius;
    scaledPos.y *= (halfHeight + radius);
  }

  // Rotate vertex
  let rotatedPos = quatRotate(rot, scaledPos);
  let rotatedNormal = quatRotate(rot, scaledNormal);

  // Translate to world position
  let worldPos = pos + rotatedPos;

  output.position = camera.viewProjection * vec4<f32>(worldPos, 1.0);
  output.worldPos = worldPos;
  output.normal = rotatedNormal;
  output.velocity = body.vel_type.xyz;
  output.shapeType = shapeType;
  output.instanceId = input.instanceId;
  output.bodyType = u32(body.vel_type.w); // 0=dynamic, 1=fixed

  return output;
}

// ============================================================================
// Fragment Shader
// ============================================================================

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
  let normal = normalize(input.normal);

  // Light direction
  let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));

  // Basic lighting
  let ambient = 0.2;
  let diffuse = max(dot(normal, lightDir), 0.0) * 0.7;

  // View direction for specular
  let viewDir = normalize(camera.cameraPosition - input.worldPos);
  let halfDir = normalize(lightDir + viewDir);
  let specular = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.3;

  // Check if this is a static obstacle (bodyType == 1 means fixed)
  let isStatic = input.bodyType == 1u;

  // Color based on body type and shape type
  var baseColor : vec3<f32>;

  if (isStatic) {
    // Static obstacles: darker, grayish colors
    if (input.shapeType == 0u) {
      // Static sphere: dark gray-blue
      baseColor = vec3<f32>(0.4, 0.45, 0.55);
    } else if (input.shapeType == 1u) {
      // Static box: dark gray-brown (like concrete/stone)
      baseColor = vec3<f32>(0.5, 0.48, 0.45);
    } else {
      // Static cylinder: dark gray
      baseColor = vec3<f32>(0.45, 0.45, 0.5);
    }

    // Add slight variation based on instance
    let instanceVar = f32(input.instanceId % 20u) / 20.0;
    baseColor *= (0.9 + instanceVar * 0.2);

  } else {
    // Dynamic bodies: colorful
    if (input.shapeType == 0u) {
      // Ball: blue
      baseColor = vec3<f32>(0.3, 0.5, 0.9);
    } else if (input.shapeType == 1u) {
      // Box: orange
      baseColor = vec3<f32>(0.9, 0.6, 0.2);
    } else {
      // Capsule: green
      baseColor = vec3<f32>(0.3, 0.8, 0.4);
    }

    // Velocity-based color variation (only for dynamic)
    let speed = length(input.velocity);
    let speedFactor = min(speed / 20.0, 1.0);
    baseColor = mix(baseColor, vec3<f32>(1.0, 0.3, 0.2), speedFactor * 0.3);

    // Instance-based color variation
    let instanceHue = f32(input.instanceId % 360u) / 360.0;
    let hueShift = vec3<f32>(
      sin(instanceHue * 6.28) * 0.1,
      sin((instanceHue + 0.33) * 6.28) * 0.1,
      sin((instanceHue + 0.67) * 6.28) * 0.1
    );
    baseColor += hueShift;
  }

  let finalColor = baseColor * (ambient + diffuse) + vec3<f32>(1.0) * specular;

  return vec4<f32>(finalColor, 1.0);
}
`;

// Keep backward compatibility exports
export const instanceVertexShader = instanceShader;
export const instanceFragmentShader = "";

// ============================================================================
// SDF Environment Rendering (Ray Marching)
// ============================================================================

export const sdfEnvironmentVertexShader = /* wgsl */ `

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
}

@vertex
fn main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  var output : VertexOutput;

  // Fullscreen triangle
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);

  output.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  output.uv = vec2<f32>(x, y);

  return output;
}
`;

export const sdfEnvironmentFragmentShader = /* wgsl */ `

struct CameraUniforms {
  view : mat4x4<f32>,
  projection : mat4x4<f32>,
  viewProjection : mat4x4<f32>,
  cameraPosition : vec3<f32>,
  _pad : f32,
}

struct SdfUniforms {
  worldToSdf : mat4x4<f32>,
  sdfToWorld : mat4x4<f32>,
  dt : f32,
  gravity : f32,
  numBodies : u32,
  sdfDim : u32,
}

@group(0) @binding(0) var<uniform> camera : CameraUniforms;
@group(1) @binding(0) var sdfTex : texture_3d<f32>;
@group(1) @binding(1) var sdfSampler : sampler;
@group(1) @binding(2) var<uniform> sdfUniforms : SdfUniforms;

struct FragmentInput {
  @location(0) uv : vec2<f32>,
}

fn worldToSdfCoord(p: vec3<f32>) -> vec3<f32> {
  let hp = sdfUniforms.worldToSdf * vec4<f32>(p, 1.0);
  let q = hp.xyz + vec3<f32>(0.5);
  return clamp(q, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn sampleSdf(p: vec3<f32>) -> f32 {
  let uvw = worldToSdfCoord(p);
  // Check if outside bounds
  if (uvw.x <= 0.01 || uvw.x >= 0.99 ||
      uvw.y <= 0.01 || uvw.y >= 0.99 ||
      uvw.z <= 0.01 || uvw.z >= 0.99) {
    return 1000.0;
  }
  return textureSampleLevel(sdfTex, sdfSampler, uvw, 0.0).r;
}

fn sdfNormal(p: vec3<f32>) -> vec3<f32> {
  let eps = 0.02;
  let dx = vec3<f32>(eps, 0.0, 0.0);
  let dy = vec3<f32>(0.0, eps, 0.0);
  let dz = vec3<f32>(0.0, 0.0, eps);

  let n = vec3<f32>(
    sampleSdf(p + dx) - sampleSdf(p - dx),
    sampleSdf(p + dy) - sampleSdf(p - dy),
    sampleSdf(p + dz) - sampleSdf(p - dz)
  );

  return normalize(n);
}

fn getRayDirection(uv: vec2<f32>) -> vec3<f32> {
  // Convert UV to clip space
  let clipPos = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);

  // Get inverse view-projection
  let invViewProj = sdfUniforms.sdfToWorld; // Placeholder - should use actual inverse

  // For now, compute ray direction from camera uniforms
  let invView = transpose(mat3x3<f32>(
    camera.view[0].xyz,
    camera.view[1].xyz,
    camera.view[2].xyz
  ));

  // Approximate focal length
  let fov = 1.0;
  let aspect = 16.0 / 9.0;

  let rayDir = normalize(vec3<f32>(
    clipPos.x * aspect * fov,
    clipPos.y * fov,
    -1.0
  ));

  return invView * rayDir;
}

@fragment
fn main(input : FragmentInput) -> @location(0) vec4<f32> {
  let rayOrigin = camera.cameraPosition;
  let rayDir = getRayDirection(input.uv);

  // Ray march
  var t = 0.0;
  let maxT = 200.0;
  let minDist = 0.001;
  var hit = false;
  var hitPos = rayOrigin;

  for (var i = 0; i < 128; i++) {
    hitPos = rayOrigin + rayDir * t;
    let d = sampleSdf(hitPos);

    if (d < minDist) {
      hit = true;
      break;
    }

    if (t > maxT) {
      break;
    }

    t += max(d * 0.9, 0.01);
  }

  if (!hit) {
    // Sky gradient
    let skyTop = vec3<f32>(0.4, 0.6, 0.9);
    let skyBottom = vec3<f32>(0.8, 0.85, 0.95);
    let skyColor = mix(skyBottom, skyTop, max(rayDir.y * 0.5 + 0.5, 0.0));
    return vec4<f32>(skyColor, 1.0);
  }

  // Hit - compute shading
  let normal = sdfNormal(hitPos);
  let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));

  // Lighting
  let ambient = 0.3;
  let diffuse = max(dot(normal, lightDir), 0.0) * 0.6;

  // Shadow ray
  var shadow = 1.0;
  let shadowStart = hitPos + normal * 0.02;
  var shadowT = 0.0;
  for (var j = 0; j < 32; j++) {
    let shadowPos = shadowStart + lightDir * shadowT;
    let sd = sampleSdf(shadowPos);
    if (sd < 0.001) {
      shadow = 0.3;
      break;
    }
    shadowT += max(sd, 0.05);
    if (shadowT > 50.0) { break; }
  }

  // Base color - brownish terrain
  let baseColor = vec3<f32>(0.6, 0.5, 0.4);

  // Add some variation based on height
  let heightFactor = clamp((hitPos.y + 10.0) / 20.0, 0.0, 1.0);
  let coloredBase = mix(
    vec3<f32>(0.4, 0.35, 0.3), // Low - darker
    vec3<f32>(0.7, 0.65, 0.5), // High - lighter
    heightFactor
  );

  let finalColor = coloredBase * (ambient + diffuse * shadow);

  // Fog
  let fogDist = length(hitPos - rayOrigin);
  let fogFactor = 1.0 - exp(-fogDist * 0.01);
  let fogColor = vec3<f32>(0.7, 0.75, 0.85);
  let withFog = mix(finalColor, fogColor, fogFactor);

  return vec4<f32>(withFog, 1.0);
}
`;

// ============================================================================
// Ground Plane / Terrain Rendering
// ============================================================================

export const groundPlaneShader = /* wgsl */ `

struct CameraUniforms {
  view : mat4x4<f32>,
  projection : mat4x4<f32>,
  viewProjection : mat4x4<f32>,
  cameraPosition : vec3<f32>,
  _pad : f32,
}

@group(0) @binding(0) var<uniform> camera : CameraUniforms;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
  @location(1) uv : vec2<f32>,
  @location(2) normal : vec3<f32>,
}

// Terrain height function - must match physics SDF!
const TERRAIN_AMPLITUDE : f32 = 3.0;
const TERRAIN_FREQ : f32 = 0.08;

fn terrainHeight(x: f32, z: f32) -> f32 {
  return sin(x * TERRAIN_FREQ) * cos(z * TERRAIN_FREQ) * TERRAIN_AMPLITUDE
       + sin(x * TERRAIN_FREQ * 2.3 + 1.5) * sin(z * TERRAIN_FREQ * 1.7) * (TERRAIN_AMPLITUDE * 0.5)
       + sin(x * TERRAIN_FREQ * 0.5) * cos(z * TERRAIN_FREQ * 0.7 + 2.0) * (TERRAIN_AMPLITUDE * 0.3);
}

fn terrainNormal(x: f32, z: f32) -> vec3<f32> {
  let eps = 0.1;
  let hL = terrainHeight(x - eps, z);
  let hR = terrainHeight(x + eps, z);
  let hD = terrainHeight(x, z - eps);
  let hU = terrainHeight(x, z + eps);
  return normalize(vec3<f32>(hL - hR, 2.0 * eps, hD - hU));
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  var output : VertexOutput;

  // Create a tessellated terrain grid
  // 64x64 grid = 4096 quads = 8192 triangles = 24576 vertices
  let gridRes = 64u;
  let gridSize = 100.0;

  let triIndex = vertexIndex / 3u;
  let vertInTri = vertexIndex % 3u;

  let quadIndex = triIndex / 2u;
  let triInQuad = triIndex % 2u;

  let qx = quadIndex % gridRes;
  let qz = quadIndex / gridRes;

  // Quad corners in grid space (0 to gridRes)
  var lx : f32;
  var lz : f32;

  if (triInQuad == 0u) {
    // First triangle: 0-1-2 (bottom-left, bottom-right, top-right)
    if (vertInTri == 0u) { lx = f32(qx); lz = f32(qz); }
    else if (vertInTri == 1u) { lx = f32(qx + 1u); lz = f32(qz); }
    else { lx = f32(qx + 1u); lz = f32(qz + 1u); }
  } else {
    // Second triangle: 0-2-3 (bottom-left, top-right, top-left)
    if (vertInTri == 0u) { lx = f32(qx); lz = f32(qz); }
    else if (vertInTri == 1u) { lx = f32(qx + 1u); lz = f32(qz + 1u); }
    else { lx = f32(qx); lz = f32(qz + 1u); }
  }

  // Convert to world space (-gridSize/2 to gridSize/2)
  let worldX = (lx / f32(gridRes) - 0.5) * gridSize;
  let worldZ = (lz / f32(gridRes) - 0.5) * gridSize;
  let worldY = terrainHeight(worldX, worldZ);

  let worldPos = vec3<f32>(worldX, worldY, worldZ);
  let normal = terrainNormal(worldX, worldZ);

  output.position = camera.viewProjection * vec4<f32>(worldPos, 1.0);
  output.worldPos = worldPos;
  output.uv = vec2<f32>(lx, lz) / f32(gridRes) * 10.0;
  output.normal = normal;

  return output;
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
  let normal = normalize(input.normal);

  // Lighting
  let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));
  let ambient = 0.25;
  let diffuse = max(dot(normal, lightDir), 0.0) * 0.65;

  // View direction for specular
  let viewDir = normalize(camera.cameraPosition - input.worldPos);
  let halfDir = normalize(lightDir + viewDir);
  let specular = pow(max(dot(normal, halfDir), 0.0), 16.0) * 0.15;

  // Height-based coloring
  let height = input.worldPos.y;
  let heightNorm = clamp((height + 5.0) / 10.0, 0.0, 1.0);

  // Color gradient: dark green -> brown -> tan
  let lowColor = vec3<f32>(0.15, 0.2, 0.12);  // Dark green/brown
  let midColor = vec3<f32>(0.35, 0.28, 0.18); // Brown
  let highColor = vec3<f32>(0.5, 0.45, 0.35); // Tan/sand

  var baseColor : vec3<f32>;
  if (heightNorm < 0.5) {
    baseColor = mix(lowColor, midColor, heightNorm * 2.0);
  } else {
    baseColor = mix(midColor, highColor, (heightNorm - 0.5) * 2.0);
  }

  // Grid pattern for visual reference
  let grid = fract(input.uv);
  let lineWidth = 0.02;
  var gridFactor = 0.0;
  if (grid.x < lineWidth || grid.x > (1.0 - lineWidth) ||
      grid.y < lineWidth || grid.y > (1.0 - lineWidth)) {
    gridFactor = 0.15;
  }

  baseColor = mix(baseColor, vec3<f32>(0.2, 0.25, 0.2), gridFactor);

  // Final color with lighting
  let finalColor = baseColor * (ambient + diffuse) + vec3<f32>(0.9, 0.85, 0.7) * specular;

  // Distance fog
  let dist = length(input.worldPos.xz - camera.cameraPosition.xz);
  let fogFactor = 1.0 - exp(-dist * 0.015);
  let fogColor = vec3<f32>(0.12, 0.12, 0.16);
  let withFog = mix(finalColor, fogColor, fogFactor * 0.7);

  return vec4<f32>(withFog, 1.0);
}
`;

// Keep backward compatibility exports
export const groundPlaneVertexShader = groundPlaneShader;
export const groundPlaneFragmentShader = "";

// ============================================================================
// SDF Visualization Overlay Shader
// ============================================================================

export const sdfVisualizerShader = /* wgsl */ `

struct CameraUniforms {
  view : mat4x4<f32>,
  projection : mat4x4<f32>,
  viewProjection : mat4x4<f32>,
  cameraPosition : vec3<f32>,
  _pad : f32,
}

struct SdfUniforms {
  worldToSdf : mat4x4<f32>,
  sdfMin : vec3<f32>,
  _pad1 : f32,
  sdfMax : vec3<f32>,
  _pad2 : f32,
}

@group(0) @binding(0) var<uniform> camera : CameraUniforms;
@group(0) @binding(1) var<uniform> sdfParams : SdfUniforms;
@group(0) @binding(2) var sdfTex : texture_3d<f32>;
@group(0) @binding(3) var sdfSampler : sampler;
@group(0) @binding(4) var depthTex : texture_depth_2d;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) rayDir : vec3<f32>,
  @location(1) screenUV : vec2<f32>,
}

// Fullscreen triangle
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  var output : VertexOutput;
  
  // Fullscreen triangle vertices
  var pos : array<vec2<f32>, 3> = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  
  let clipPos = pos[vertexIndex];
  output.position = vec4<f32>(clipPos, 0.0, 1.0);
  output.screenUV = clipPos * 0.5 + 0.5;
  output.screenUV.y = 1.0 - output.screenUV.y; // Flip Y for texture sampling
  
  // Calculate ray direction from camera through this pixel
  // Unproject to view space
  let viewPos = vec4<f32>(clipPos.x / camera.projection[0][0], 
                          clipPos.y / camera.projection[1][1], 
                          -1.0, 1.0);
  
  // Extract view matrix basis vectors
  // The view matrix is stored row-major in the buffer, so we access:
  // view[row][col] where view[0] = [rx, upx, -fx, 0], view[1] = [ry, upy, -fy, 0], etc.
  // Right vector: first element of each row
  let viewRight = vec3<f32>(camera.view[0][0], camera.view[1][0], camera.view[2][0]);
  // Up vector: second element of each row
  let viewUp = vec3<f32>(camera.view[0][1], camera.view[1][1], camera.view[2][1]);
  // Forward vector: third element of each row (negated because it stores -forward)
  let viewForward = vec3<f32>(-camera.view[0][2], -camera.view[1][2], -camera.view[2][2]);
  
  output.rayDir = normalize(viewRight * viewPos.x + viewUp * viewPos.y + viewForward);
  
  return output;
}

// Transform world position to SDF texture coordinates [0,1]
fn worldToSdfCoord(p: vec3<f32>) -> vec3<f32> {
  let hp = sdfParams.worldToSdf * vec4<f32>(p, 1.0);
  // worldToSdf maps to [-0.5,0.5]^3; convert to [0,1]^3
  return clamp(hp.xyz + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Sample SDF value at world position
fn sampleSdf(p: vec3<f32>) -> f32 {
  let uvw = worldToSdfCoord(p);
  return textureSampleLevel(sdfTex, sdfSampler, uvw, 0.0).r;
}

// Compute SDF gradient (normal)
fn sdfNormal(p: vec3<f32>) -> vec3<f32> {
  let eps = 0.05;
  let dx = vec3<f32>(eps, 0.0, 0.0);
  let dy = vec3<f32>(0.0, eps, 0.0);
  let dz = vec3<f32>(0.0, 0.0, eps);
  
  let gx = sampleSdf(p + dx) - sampleSdf(p - dx);
  let gy = sampleSdf(p + dy) - sampleSdf(p - dy);
  let gz = sampleSdf(p + dz) - sampleSdf(p - dz);
  
  return normalize(vec3<f32>(gx, gy, gz));
}

// Convert depth buffer value to linear depth (world units)
fn linearizeDepth(d: f32, near: f32, far: f32) -> f32 {
  return near * far / (far - d * (far - near));
}

// Color mapping for SDF distance - more subtle for overlay
fn distanceToColor(d: f32) -> vec3<f32> {
  // Inside: red tint
  if (d < 0.0) {
    let t = clamp(-d / 2.0, 0.0, 1.0);
    return mix(vec3<f32>(1.0, 0.3, 0.2), vec3<f32>(0.9, 0.1, 0.1), t);
  }
  
  // Near surface: cyan/green
  let t = clamp(d / 5.0, 0.0, 1.0);
  if (t < 0.5) {
    return mix(vec3<f32>(0.0, 1.0, 0.9), vec3<f32>(0.2, 0.9, 0.3), t * 2.0);
  } else {
    return mix(vec3<f32>(0.2, 0.9, 0.3), vec3<f32>(0.3, 0.4, 0.8), (t - 0.5) * 2.0);
  }
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
  let rayOrigin = camera.cameraPosition;
  let rayDir = normalize(input.rayDir);
  
  // Sample depth from the scene render pass
  let depthCoord = vec2<i32>(input.position.xy);
  let sceneDepth = textureLoad(depthTex, depthCoord, 0);
  
  // Convert depth to world distance along ray
  let near = 0.1;
  let far = 1000.0;
  let linearDepth = linearizeDepth(sceneDepth, near, far);
  
  // Raymarch settings
  let maxSteps = 96;
  let maxT = min(linearDepth + 1.0, 150.0); // Stop at scene geometry (with small margin)
  let hitThreshold = 0.02;
  
  var t = 0.2;
  var hit = false;
  var hitPos = vec3<f32>(0.0);
  var hitDist = 0.0;
  var minDist = 1000.0;
  var minDistPos = vec3<f32>(0.0);
  
  // Raymarch through SDF
  for (var i = 0; i < maxSteps; i++) {
    let p = rayOrigin + rayDir * t;
    let d = sampleSdf(p);
    
    // Track closest approach for visualization
    if (abs(d) < minDist) {
      minDist = abs(d);
      minDistPos = p;
    }
    
    if (d < hitThreshold) {
      hit = true;
      hitPos = p;
      hitDist = d;
      break;
    }
    
    if (t > maxT) {
      break;
    }
    
    // Adaptive step size
    t += max(d * 0.7, 0.05);
  }
  
  // Calculate overlay opacity and color
  var overlayColor = vec3<f32>(0.0);
  var overlayAlpha = 0.0;
  
  if (hit) {
    // Surface hit - show SDF surface with transparency
    let normal = sdfNormal(hitPos);
    let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));
    
    // Base color from distance
    let baseColor = distanceToColor(hitDist);
    
    // Lighting
    let ambient = 0.4;
    let diffuse = max(dot(normal, lightDir), 0.0) * 0.5;
    let lighting = ambient + diffuse;
    
    // Fresnel for edge highlighting
    let viewDir = -rayDir;
    let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    
    overlayColor = baseColor * lighting;
    overlayColor += vec3<f32>(0.5, 0.8, 1.0) * fresnel * 0.4;
    
    // Contour lines
    let contourScale = 0.5;
    let contour = fract(sampleSdf(hitPos) / contourScale);
    let contourLine = smoothstep(0.0, 0.08, contour) * smoothstep(0.15, 0.08, contour);
    overlayColor = mix(overlayColor, vec3<f32>(0.0, 0.0, 0.0), contourLine * 0.6);
    
    // Alpha based on whether we hit before scene geometry
    let distToScene = linearDepth - t;
    if (distToScene > 0.5) {
      // SDF surface is in front of scene - more visible
      overlayAlpha = 0.5;
    } else {
      // SDF surface is at/behind scene - less visible
      overlayAlpha = 0.25;
    }
  } else {
    // No direct hit - show distance field as subtle overlay
    // Visualize how close the ray got to surfaces
    if (minDist < 3.0) {
      let intensity = 1.0 - (minDist / 3.0);
      overlayColor = distanceToColor(minDist) * 0.5;
      overlayAlpha = intensity * 0.15;
    }
  }
  
  return vec4<f32>(overlayColor, overlayAlpha);
}
`;




