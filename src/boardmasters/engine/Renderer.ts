import { CAMERA, FOG, RENDER_BLEED_MAX, RENDER_SCALE, RENDER_SCALE_FORCED, RENDER_SCALES, VIEW } from '../game/constants';
import { THREE } from './three';

/**
 * The 3D canvas and the 2D HUD canvas.
 *
 * The HUD is drawn at the internal resolution (VIEW: 426x240, or 240x426
 * upright) and scaled up with nearest-neighbour sampling to the largest fit
 * in the page, centred like the original game's FIT scaling: the HUD
 * rectangle. Pointers, touch buttons and the HUD layout all live in it.
 *
 * The world renders at a multiple of VIEW (renderScale, 1.5 by default) on
 * the same pixel grid as the HUD rectangle, and bleeds past it to the page
 * edges: on a phone taller than 16:9 the sea and sky fill what used to be
 * black letterbox bars while the HUD stays put. The camera's projection is
 * offset (setViewOffset) so the HUD rectangle shows exactly the framing it
 * would show alone; the bleed only adds more sky above and more sea below.
 * There is no post-processing pass: the low resolution and the PS1 shader
 * (PS1Material.ts) do all the work.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly hudCanvas: HTMLCanvasElement;
  /** The HUD's (internal) resolution; pointers, touch buttons and the HUD layout use it. */
  readonly width = VIEW.width;
  readonly height = VIEW.height;
  /** World pixels per VIEW pixel (Renderer.fit picks it so world pixels cover whole device pixels; `?res=N` forces it). */
  renderScale: number = RENDER_SCALE;
  /** The 3D canvas's drawing-buffer size: VIEW times renderScale, plus the bleed past the HUD rectangle. */
  renderWidth = Math.round(VIEW.width * RENDER_SCALE);
  renderHeight = Math.round(VIEW.height * RENDER_SCALE);
  /** CSS pixels per internal pixel after fitting, and the HUD rectangle's offset in the parent; input maps pointers with these. */
  cssScale = 1;
  offsetX = 0;
  offsetY = 0;

  /** Three's renderer needs WebGL 2. */
  static supported(): boolean {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext(); // do not keep a context alive just for the probe
      return gl !== null;
    } catch {
      return false;
    }
  }

  constructor(private parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(1);
    this.gl.setSize(this.renderWidth, this.renderHeight, false);
    this.gl.setClearColor(FOG.color, 1);

    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.width = this.width;
    this.hudCanvas.height = this.height;
    parent.append(this.canvas, this.hudCanvas);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, this.width / this.height, CAMERA.near, CAMERA.far);
    this.scene.add(this.camera);

    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  /**
   * Fit the HUD rectangle (the largest fit in the parent's padding-free
   * area, which boardmasters.html sets to the safe area), pick the render
   * scale, and size the world canvas to cover the parent on the same pixel
   * grid.
   */
  fit(): void {
    const style = getComputedStyle(this.parent);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const padT = parseFloat(style.paddingTop) || 0;
    const padB = parseFloat(style.paddingBottom) || 0;
    const pw = this.parent.clientWidth || this.width;
    const ph = this.parent.clientHeight || this.height;
    const aw = Math.max(1, pw - padL - padR);
    const ah = Math.max(1, ph - padT - padB);
    const fit = Math.max(0.1, Math.min(aw / this.width, ah / this.height));
    // Whole device pixels per internal pixel keep the texture and dither even; take the loss of
    // screen only when it is small, so phones still fill their width.
    const dpr = window.devicePixelRatio || 1;
    const whole = Math.floor(fit * dpr) / dpr;
    const useWhole = whole >= 1 && whole / fit >= 0.85;
    const scale = useWhole ? whole : fit;
    const w = this.width * scale;
    const h = this.height * scale;
    this.cssScale = scale;
    // Offsets on whole device pixels, so the grid stays even from the canvas edge in.
    this.offsetX = Math.round((padL + (aw - w) / 2) * dpr) / dpr;
    this.offsetY = Math.round((padT + (ah - h) / 2) * dpr) / dpr;
    const hud = this.hudCanvas.style;
    hud.width = `${w}px`;
    hud.height = `${h}px`;
    hud.left = `${this.offsetX}px`;
    hud.top = `${this.offsetY}px`;

    // The world's scale: the first of RENDER_SCALES that gives a whole number of device pixels per world pixel.
    let rs = RENDER_SCALE_FORCED ?? RENDER_SCALES[0];
    if (RENDER_SCALE_FORCED === null && useWhole) {
      const devPerView = Math.round(whole * dpr);
      for (const s of RENDER_SCALES) {
        const d = devPerView / s;
        if (Math.abs(d - Math.round(d)) < 1e-6) {
          rs = s;
          break;
        }
      }
    }
    this.renderScale = rs;
    const rw = Math.round(this.width * rs);
    const rh = Math.round(this.height * rs);
    // The bleed: whole world pixels past each side of the HUD rectangle, up to the parent's edges.
    const px = scale / rs;
    const maxX = Math.floor(((RENDER_BLEED_MAX.x - 1) * rw) / 2);
    const maxY = Math.floor(((RENDER_BLEED_MAX.y - 1) * rh) / 2);
    const left = Math.min(maxX, Math.max(0, Math.ceil(this.offsetX / px - 0.01)));
    const right = Math.min(maxX, Math.max(0, Math.ceil((pw - this.offsetX - w) / px - 0.01)));
    const top = Math.min(maxY, Math.max(0, Math.ceil(this.offsetY / px - 0.01)));
    const bottom = Math.min(maxY, Math.max(0, Math.ceil((ph - this.offsetY - h) / px - 0.01)));
    this.renderWidth = rw + left + right;
    this.renderHeight = rh + top + bottom;
    this.gl.setSize(this.renderWidth, this.renderHeight, false);
    const world = this.canvas.style;
    world.width = `${this.renderWidth * px}px`;
    world.height = `${this.renderHeight * px}px`;
    world.left = `${this.offsetX - left * px}px`;
    world.top = `${this.offsetY - top * px}px`;
    // The HUD rectangle keeps the camera's own framing (aspect VIEW.width / VIEW.height); the bleed widens the frustum around it.
    this.camera.setViewOffset(rw, rh, -left, -top, this.renderWidth, this.renderHeight);
    VIEW.snapGrid.x = this.renderWidth / 2;
    VIEW.snapGrid.y = this.renderHeight / 2;
  }

  /** Client (CSS) coordinates to internal pixels. */
  toInternal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.parent.getBoundingClientRect();
    return { x: (clientX - rect.left - this.offsetX) / this.cssScale, y: (clientY - rect.top - this.offsetY) / this.cssScale };
  }

  render(): void {
    this.gl.render(this.scene, this.camera);
  }
}
