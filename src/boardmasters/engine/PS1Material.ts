import { FOG, LIGHT, LOOK, PALETTE, VIEW } from '../game/constants';
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
  uSnap: { value: new THREE.Vector2(VIEW.snapGrid.x, VIEW.snapGrid.y) },
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

/** Push the LOOK toggles into the shared uniforms (called every frame; cheap). Vertices snap to one rendered pixel of the world buffer (VIEW.snapGrid, kept by Renderer.fit). */
export function syncLook(): void {
  sharedUniforms.uSnap.value.set(LOOK.snap ? VIEW.snapGrid.x : 0, LOOK.snap ? VIEW.snapGrid.y : 0);
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

void main() {
  vec4 localPosition = vec4(position, 1.0);
  vec3 localNormal = normal;
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

// The sky by elevation; keep in step with skyColorAt() above.
vec3 skyAt(float e) {
  if (e <= 0.0) return uFogColor;
  if (e < 0.05) return mix(uFogColor, uHorizon, e / 0.05);
  if (e < 0.15) return mix(uHorizon, uSkyMid, (e - 0.05) / 0.1);
  return mix(uSkyMid, uSkyTop, smoothstep(0.15, 0.6, e));
}

void main() {
  vec2 uv = mix(vUvPersp, vUvAffine.xy / vUvAffine.z, uAffine);
  vec3 base = uColor * vColor;
  if (uUseMap > 0.5) base *= texture2D(uMap, uv).rgb;
  vec3 lit = mix(base * vLight, vec3(1.0), uFlash);
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
}

export function createPS1Material(options: PS1MaterialOptions = {}): THREE.ShaderMaterial {
  const { map, color = 0xffffff, unlit = false, fog = true, opacity = 1, side = THREE.FrontSide, depthWrite = true, flat } = options;
  return new THREE.ShaderMaterial({
    defines: flat !== undefined ? { PS1_FLAT: 1 } : {},
    uniforms: {
      uFacet: { value: flat ?? 0 },
      ...sharedUniforms,
      uMap: { value: map ?? null },
      uUseMap: { value: map ? 1 : 0 },
      uColor: { value: new THREE.Color(color) },
      uUnlit: { value: unlit ? 1 : 0 },
      uUseFog: { value: fog ? 1 : 0 },
      uOpacity: { value: opacity },
      uFlash: { value: 0 },
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
