import { FOG, LIGHT, LOOK, PALETTE, SUN, VIEW, WATER } from '../game/constants';
import { mixRgb, rgb, smoothstep } from './math';
import { THREE } from './three';

/**
 * The one material everything in the world uses. It produces the
 * PlayStation look in the shader rather than as a filter:
 *
 *  - vertex snapping: clip-space positions are snapped to the low-res pixel
 *    grid, so polygons jitter as they move (uSnap, LOOK.snap)
 *  - affine texture mapping: uv*w and w are interpolated and divided in the
 *    fragment, which is screen-linear rather than perspective-correct, so
 *    textures warp on polygons seen at an angle (uAffine, LOOK.affine)
 *  - Gouraud lighting: one sun plus ambient, evaluated per vertex, times
 *    vertex colours, times an optional nearest-filtered texture
 *  - linear fog to the sunset colour (the short draw distance)
 *  - 5-bit colour quantisation (banding) (uQuantize, LOOK.quantize)
 *
 * Every geometry must carry a `color` attribute (see colorGeometry).
 */
export const sharedUniforms = {
  uSnap: { value: new THREE.Vector2(VIEW.width / 2, VIEW.height / 2) },
  uAffine: { value: 1 },
  uQuantize: { value: 1 },
  uDither: { value: 1 },
  uFogColor: { value: new THREE.Color(FOG.color) },
  uHorizon: { value: new THREE.Color(PALETTE.horizon) },
  uSkyMid: { value: new THREE.Color(PALETTE.skyMid) },
  uSkyTop: { value: new THREE.Color(PALETTE.skyTop) },
  uFogNear: { value: FOG.near },
  uFogFar: { value: FOG.far },
  uSunDir: { value: new THREE.Vector3(...LIGHT.sun).normalize() },
  uAmbient: { value: LIGHT.ambient },
};

/**
 * The sea's own uniforms (the PS1_WATER block, `water` option): the
 * glitter direction (towards the drawn sun), the near and far tints and the
 * foam colours. Shared by the sea and the foam laid on it; the ocean
 * advances `uTime`.
 */
export const waterUniforms = {
  uTime: { value: 0 },
  uGlintDir: { value: new THREE.Vector3(...SUN.dir).normalize() },
  uGlintColor: { value: new THREE.Color(WATER.glint) },
  uWaterNear: { value: new THREE.Vector3(...WATER.nearTint) },
  uWaterFar: { value: new THREE.Vector3(...WATER.farTint) },
  uFoamColor: { value: new THREE.Color(PALETTE.foam) },
  uFoamShade: { value: new THREE.Color(WATER.foamShade) },
};

/** Push the LOOK toggles into the shared uniforms (called every frame; cheap). */
export function syncLook(): void {
  sharedUniforms.uSnap.value.set(LOOK.snap ? VIEW.width / 2 : 0, LOOK.snap ? VIEW.height / 2 : 0);
  sharedUniforms.uAffine.value = LOOK.affine ? 1 : 0;
  sharedUniforms.uQuantize.value = LOOK.quantize ? 1 : 0;
  sharedUniforms.uDither.value = LOOK.dither ? 1 : 0;
}

/**
 * The sky's colour by elevation (the y of a unit view direction): fog
 * orange at and below the horizon, a yellow glow just above it, orange, then
 * purple overhead. The fog in the shader uses the same ramp (skyAt in GLSL
 * below), so anything fully fogged matches the sky behind it at any
 * elevation and the far plane never shows a cut-out.
 */
export function skyColorAt(e: number): [number, number, number] {
  const fog = rgb(FOG.color);
  const horizon = rgb(PALETTE.horizon);
  const mid = rgb(PALETTE.skyMid);
  const top = rgb(PALETTE.skyTop);
  if (e <= 0) return fog;
  if (e < 0.05) return mixRgb(fog, horizon, e / 0.05);
  if (e < 0.15) return mixRgb(horizon, mid, (e - 0.05) / 0.1);
  return mixRgb(mid, top, smoothstep(0.15, 0.6, e));
}

const vertexShader = /* glsl */ `
uniform vec2 uSnap;
uniform float uFacet;
uniform vec2 uUvOffset;
uniform vec3 uSunDir;
uniform float uAmbient;
uniform float uUnlit;
uniform float uFogNear;
uniform float uFogFar;
uniform float uUseFog;

// Faceted (flat) materials take the provoking vertex's colour and light for the whole triangle.
#ifdef PS1_FLAT
flat varying vec3 vColor;
flat varying float vLight;
#else
varying vec3 vColor;
varying float vLight;
#endif
varying vec2 vUvPersp;
varying vec3 vUvAffine;
varying float vFog;
varying float vElevation;

// Skinned riders (Three defines USE_SKINNING for a SkinnedMesh and binds the bone texture).
#include <skinning_pars_vertex>

#ifdef PS1_WATER
// The sea and the foam laid on it (wakes, rings): a per-vertex foam amount and the world position for the foam's cells; the
// distance tint and the sun's glitter are worked out here, per vertex, so each pixel only adds its twinkle.
attribute float foam;
uniform float uTime;
uniform vec3 uGlintDir;
uniform vec3 uWaterNear;
uniform vec3 uWaterFar;
varying float vFoam;
varying vec3 vWorld;
varying float vDepth;
varying vec3 vTint;
// The glitter column (x), the warm halo round it (y), and how much the column breaks into twinkles close by (z).
varying vec3 vGlint;
// Sparkle off each facet turned to the sun: one value per facet on the faceted sea.
#ifdef PS1_FLAT
flat varying float vSparkle;
#else
varying float vSparkle;
#endif
float waterHashV(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void waterVertex(vec3 world, vec3 worldNormal, float depth) {
  vFoam = foam;
  vWorld = world;
  vDepth = depth;
  // Turquoise and cyan close to the camera, deep blue further out.
  vTint = mix(uWaterNear, uWaterFar, smoothstep(4.0, 40.0, depth));
  vGlint = vec3(0.0);
  vSparkle = 0.0;
  // The sun's glitter path: a column of light down the water to the sun, narrow across and long towards the camera (the swell
  // tilts the reflection up and down more than sideways), compared with the sun across (azimuth) and up and down (elevation)
  // off the mean surface. Only the water roughly towards the sun can glitter.
  vec3 v = normalize(world - cameraPosition);
  vec2 toSun = normalize(uGlintDir.xz);
  vec2 across = normalize(v.xz);
  float side = abs(across.x * toSun.y - across.y * toSun.x);
  if (side < 0.2 && depth > 2.0 && dot(across, toSun) > 0.0) {
    float near = 1.0 - smoothstep(30.0, 70.0, depth);
    float rise = abs(-v.y - uGlintDir.y);
    vGlint = vec3(
      (1.0 - smoothstep(0.0, 0.055, side)) * (1.0 - smoothstep(0.0, 0.16, rise)),
      (1.0 - smoothstep(0.0, 0.13, side)) * (1.0 - smoothstep(0.0, 0.25, rise)),
      (1.0 - smoothstep(20.0, 45.0, depth)) * smoothstep(3.0, 9.0, depth)
    );
    // Facet sparkles: the reflection off the vertex normal, jittered per spot and per moment near the camera, to the 32nd power.
    float flick = floor(uTime * 7.0);
    vec2 cell = floor(world.xz * vec2(1.6, 0.9));
    vec3 jitter = vec3(waterHashV(cell + flick) - 0.5, 0.0, waterHashV(cell.yx + flick * 1.3) - 0.5) * 0.34 * near;
    float g = max(dot(reflect(v, normalize(worldNormal + jitter)), uGlintDir), 0.0);
    g *= g;
    g *= g;
    g *= g;
    g *= g;
    g *= g;
    // Only near and mid water sparkles: further out every flattened facet would catch the sun at once (the column covers it).
    vSparkle = g * 1.6 * smoothstep(4.0, 12.0, depth) * (1.0 - smoothstep(35.0, 60.0, depth));
  }
}
#endif

void main() {
  vec3 transformed = vec3(position);
  vec3 objectNormal = vec3(normal);
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 localPosition = vec4(transformed, 1.0);
  vec3 localNormal = objectNormal;
  #ifdef USE_INSTANCING
    localPosition = instanceMatrix * localPosition;
    localNormal = mat3(instanceMatrix) * localNormal;
  #endif
  vec4 mvPosition = modelViewMatrix * localPosition;
  vec4 worldPosition = modelMatrix * localPosition;
  vElevation = normalize(worldPosition.xyz - cameraPosition).y;
  vec4 clip = projectionMatrix * mvPosition;

  // PS1 vertex snapping: round the projected position to the pixel grid.
  if (uSnap.x > 0.0 && clip.w > 0.0) {
    vec2 ndc = clip.xy / clip.w;
    ndc = floor(ndc * uSnap + 0.5) / uSnap;
    clip.xy = ndc * clip.w;
  }
  gl_Position = clip;

  vec2 uvo = uv + uUvOffset;
  vUvPersp = uvo;
  vUvAffine = vec3(uvo * clip.w, clip.w);

  float depth = -mvPosition.z;
  vFog = uUseFog * clamp((depth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);

  vec3 worldNormal = normalize(mat3(modelMatrix) * localNormal);
  float diffuse = max(dot(worldNormal, uSunDir), 0.0);
  vLight = mix(uAmbient + (1.0 - uAmbient) * diffuse, 1.0, uUnlit);
  #ifdef PS1_FLAT
    // Each facet its own shade, like crystal: a hash of the provoking vertex. Fades out with depth so the far water does not sparkle.
    float facet = fract(sin(float(gl_VertexID) * 12.9898) * 43758.5453);
    vLight *= 1.0 + (facet - 0.5) * uFacet * (1.0 - smoothstep(18.0, 60.0, depth));
  #endif
  vColor = color;
  #ifdef PS1_WATER
    waterVertex(worldPosition.xyz, worldNormal, depth);
  #endif
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uUseMap;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform vec3 uHorizon;
uniform vec3 uSkyMid;
uniform vec3 uSkyTop;
uniform float uAffine;
uniform float uQuantize;
uniform float uDither;
uniform float uFlash;
uniform float uOpacity;
uniform float uFade;

#ifdef PS1_FLAT
flat varying vec3 vColor;
flat varying float vLight;
#else
varying vec3 vColor;
varying float vLight;
#endif
varying vec2 vUvPersp;
varying vec3 vUvAffine;
varying float vFog;
varying float vElevation;

#ifdef PS1_WATER
uniform float uTime;
uniform vec3 uGlintColor;
uniform vec3 uFoamColor;
uniform vec3 uFoamShade;
varying float vFoam;
varying vec3 vWorld;
varying float vDepth;
varying vec3 vTint;
varying vec3 vGlint;
#ifdef PS1_FLAT
flat varying float vSparkle;
#else
varying float vSparkle;
#endif

// A cheap hash without a sine (Dave Hoskins' hash12): the CPU rasterisers some phones fall back to pay for every transcendental.
float waterHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Chunky whitewater: the foam amount against a world-space cell hash plus a fixed screen-space order (interleaved gradient
// noise, cheaper than indexing a Bayer matrix), so foam breaks up into pixel clumps.
float foamPattern() {
  float order = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  // Cells grow in steps with distance so a clump stays a few screen pixels across near and far. They travel with the swell
  // (towards the rider) and each re-rolls at its own moment, so the foam churns without the whole sea flickering at once.
  float level = max(1.0, floor(vDepth / 6.0));
  vec2 cell = floor((vWorld.xz + vec2(0.0, uTime * 3.0)) * vec2(5.0, 3.4) / level);
  float churn = floor(uTime * 2.0 + fract(dot(cell, vec2(0.371, 0.613))) * 4.0);
  float cells = waterHash(cell + vec2(level * 17.0, churn * 7.0));
  return 0.08 + 0.7 * cells + 0.22 * order;
}

vec3 waterShade(vec3 lit) {
  float pattern = foamPattern();
  #ifdef PS1_FOAM
    // Foam laid on the water: screen-door transparency, white over a pale cyan shade.
    if (vFoam < pattern) discard;
    return mix(uFoamShade, uFoamColor, step(pattern + 0.18, vFoam));
  #else
    // Whitewater on crests and breaking faces.
    if (vFoam > pattern) return mix(uFoamShade, uFoamColor, step(pattern + 0.2, vFoam)) * clamp(0.5 + 0.55 * vLight, 0.0, 1.0);
    vec3 col = lit * vTint;
    // The sun's glitter (worked out per vertex): a warm halo, the column breaking into twinkling pixels close by, and
    // sparkles off the facets turned to the sun.
    if (vGlint.y + vSparkle > 0.004) {
      float twinkle = waterHash(floor(gl_FragCoord.xy * 0.5) + floor(uTime * 7.0));
      float column = vGlint.x * mix(1.0, 0.25 + 1.1 * step(0.45, twinkle), vGlint.z);
      col = mix(col, col * vec3(1.35, 1.05, 0.8) + vec3(0.1, 0.04, 0.0), vGlint.y * 0.6);
      col = mix(col, uGlintColor, clamp(column * 0.95 + vSparkle * mix(0.6, step(0.3, twinkle), vGlint.z), 0.0, 1.0));
    }
    return col;
  #endif
}
#endif

// The sky by elevation; keep in step with skyColorAt() above.
vec3 skyAt(float e) {
  if (e <= 0.0) return uFogColor;
  if (e < 0.05) return mix(uFogColor, uHorizon, e / 0.05);
  if (e < 0.15) return mix(uHorizon, uSkyMid, (e - 0.05) / 0.1);
  return mix(uSkyMid, uSkyTop, smoothstep(0.15, 0.6, e));
}

void main() {
  // Screen-door fade (a rider between the camera and the player): drop pixels through a 4x4 Bayer threshold.
  if (uFade > 0.0) {
    mat4 door = mat4(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0) / 16.0;
    if (door[int(mod(gl_FragCoord.x, 4.0))][int(mod(gl_FragCoord.y, 4.0))] + 0.03125 < uFade) discard;
  }
  vec2 uv = mix(vUvPersp, vUvAffine.xy / vUvAffine.z, uAffine);
  vec3 base = uColor * vColor;
  if (uUseMap > 0.5) base *= texture2D(uMap, uv).rgb;
  vec3 lit = mix(base * vLight, vec3(1.0), uFlash);
  #ifdef PS1_WATER
    lit = waterShade(lit);
  #endif
  vec3 col = mix(lit, skyAt(vElevation), vFog);
  if (uQuantize > 0.5) {
    // 4x4 ordered dither, then 5 bits per channel: the PlayStation's framebuffer write.
    mat4 bayer = mat4(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0) / 16.0;
    float d = (bayer[int(mod(gl_FragCoord.x, 4.0))][int(mod(gl_FragCoord.y, 4.0))] - 0.5) * uDither;
    col = floor(col * 31.0 + 0.5 + d) / 31.0;
  }
  gl_FragColor = vec4(col, uOpacity);
}
`;

export interface PS1MaterialOptions {
  map?: THREE.Texture;
  color?: number;
  /** Skip lighting (sky, sun, spray, shadows). */
  unlit?: boolean;
  /** Fog off for things that sit at the horizon. */
  fog?: boolean;
  opacity?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
  /** Faceted: one colour and shade per triangle, with this much brightness variation between facets (0 for none). */
  flat?: number;
  /** The PS1_WATER block: 'sea' (distance tint, glitter, dithered whitewater) or 'foam' (dithered foam on the water, discarding where thin). Needs a float `foam` attribute. */
  water?: 'sea' | 'foam';
}

export function createPS1Material(options: PS1MaterialOptions = {}): THREE.ShaderMaterial {
  const { map, color = 0xffffff, unlit = false, fog = true, opacity = 1, side = THREE.FrontSide, depthWrite = true, flat, water } = options;
  return new THREE.ShaderMaterial({
    defines: { ...(flat !== undefined ? { PS1_FLAT: 1 } : {}), ...(water ? { PS1_WATER: 1 } : {}), ...(water === 'foam' ? { PS1_FOAM: 1 } : {}) },
    uniforms: {
      uFacet: { value: flat ?? 0 },
      ...sharedUniforms,
      ...(water ? waterUniforms : {}),
      uMap: { value: map ?? null },
      uUseMap: { value: map ? 1 : 0 },
      uColor: { value: new THREE.Color(color) },
      uUnlit: { value: unlit ? 1 : 0 },
      uUseFog: { value: fog ? 1 : 0 },
      uOpacity: { value: opacity },
      uFlash: { value: 0 },
      uFade: { value: 0 },
      uUvOffset: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader,
    fragmentShader,
    vertexColors: true,
    transparent: opacity < 1,
    depthWrite,
    side,
  });
}

/** Give a geometry a solid vertex colour (the shader requires the attribute). */
export function colorGeometry<T extends THREE.BufferGeometry>(geometry: T, color: number): T {
  const count = geometry.getAttribute('position').count;
  const [r, g, b] = rgb(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Per-vertex colours from a function of the vertex position. */
export function paintGeometry<T extends THREE.BufferGeometry>(geometry: T, paint: (x: number, y: number, z: number) => [number, number, number]): T {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const [r, g, b] = paint(position.getX(i), position.getY(i), position.getZ(i));
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
