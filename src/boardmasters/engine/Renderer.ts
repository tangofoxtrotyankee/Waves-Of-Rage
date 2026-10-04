import { CAMERA, FOG, IS_PORTRAIT, portraitViewHeight, RENDER_BLEED_MAX, RENDER_PIXEL_BUDGET, RENDER_SCALE, RENDER_SCALE_FORCED, RENDER_SCALES, VIEW } from '../game/constants';
import { THREE } from './three';
import { layoutTouchButtons } from './TouchButtons';

/**
 * The 3D canvas and the 2D HUD canvas.
 *
 * The HUD is drawn at the internal resolution (VIEW: 426x240, or 240 wide
 * and 426 to 540 tall upright, following the screen's aspect) and scaled up
 * with nearest-neighbour sampling to the largest fit in the safe area,
 * centred like the original game's FIT scaling: the HUD rectangle. Pointers,
 * touch buttons and the HUD layout all live in it; upright it spans the
 * screen top to bottom, so the top bar sits under the safe area's top edge
 * and the controls at the bottom.
 *
 * The world is framed by the camera in a fixed 240x426 (426x240) rectangle,
 * VIEW.frame, centred in the HUD rectangle, so every phone sees the same
 * framing. It renders at a multiple of VIEW (renderScale, 1.5 by default) on
 * the same pixel grid, and bleeds past the frame to the page edges: the
 * camera's projection is offset (setViewOffset) so the frame shows exactly
 * the framing it would show alone; the bleed only adds more sky above and
 * more sea below.
 * There is no post-processing pass: the low resolution and the PS1 shader
 * (PS1Material.ts) do all the work.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly hudCanvas: HTMLCanvasElement;
  /** The HUD's (internal) resolution, VIEW; pointers, touch buttons and the HUD layout use it. Upright, fit() may change the height. */
  get width(): number {
    return VIEW.width;
  }
  get height(): number {
    return VIEW.height;
  }
  /** World pixels per VIEW pixel (Renderer.fit picks it so world pixels cover whole device pixels; `?res=N` forces it). */
  renderScale: number = RENDER_SCALE;
  /** The 3D canvas's drawing-buffer size: VIEW times renderScale, plus the bleed past the HUD rectangle. */
  renderWidth = Math.round(VIEW.frame.width * RENDER_SCALE);
  renderHeight = Math.round(VIEW.frame.height * RENDER_SCALE);
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

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, VIEW.frame.width / VIEW.frame.height, CAMERA.near, CAMERA.far);
    this.scene.add(this.camera);

    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  /**
   * Fit the HUD rectangle (the largest fit in the parent's padding-free
   * area, which boardmasters.html sets to the safe area; upright, its height
   * first follows that area's aspect), pick the render scale, and size the
   * world canvas to cover the parent on the same pixel grid.
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
    const dpr = window.devicePixelRatio || 1;
    // Whole device pixels per internal pixel keep the texture and dither even; take the loss of
    // screen only when it is small, so phones still fill their width.
    const wholeOf = (f: number): number => Math.floor(f * dpr) / dpr;
    const takesWhole = (f: number): boolean => wholeOf(f) >= 1 && wholeOf(f) / f >= 0.85;
    const snap = (f: number): number => (takesWhole(f) ? wholeOf(f) : f);
    // Upright, the HUD is as tall as the safe area at the scale that fills its width (426 to 540).
    if (IS_PORTRAIT) this.setViewHeight(portraitViewHeight(aw, ah, snap(aw / this.width)));
    const fit = Math.max(0.1, Math.min(aw / this.width, ah / this.height));
    const useWhole = takesWhole(fit);
    const scale = snap(fit);
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

    // The camera's frame inside the HUD rectangle, in CSS pixels (VIEW.frame.top is whole VIEW pixels, so it stays on the grid).
    const frame = VIEW.frame;
    const fx = this.offsetX;
    const fy = this.offsetY + frame.top * scale;
    const fw = frame.width * scale;
    const fh = frame.height * scale;

    // The world's scale: the first of RENDER_SCALES that lands every world pixel on a whole number (2 or more) of
    // device pixels within the pixel budget; otherwise the first (1.5), whose pixels may then come out uneven.
    const devPerView = useWhole ? Math.round(scale * dpr) : 0;
    let rs: number = RENDER_SCALE_FORCED ?? RENDER_SCALES[0];
    if (RENDER_SCALE_FORCED === null && useWhole) {
      let found = false;
      for (const s of RENDER_SCALES) {
        const d = devPerView / s;
        if (d < 2 || Math.abs(d - Math.round(d)) > 1e-6) continue;
        if (this.layoutWorld(s, scale, pw, ph, fx, fy, fw, fh) > RENDER_PIXEL_BUDGET) continue;
        rs = s;
        found = true;
        break;
      }
      // A small window (2 device pixels per VIEW pixel): 1x keeps even 2-pixel cells where 1.5 would band.
      if (!found && devPerView === 2) rs = 1;
    }
    this.renderScale = rs;
    const rw = Math.round(frame.width * rs);
    const rh = Math.round(frame.height * rs);
    const px = scale / rs;
    this.layoutWorld(rs, scale, pw, ph, fx, fy, fw, fh);
    const { left, top } = this.bleed;
    this.gl.setSize(this.renderWidth, this.renderHeight, false);
    const world = this.canvas.style;
    world.width = `${this.renderWidth * px}px`;
    world.height = `${this.renderHeight * px}px`;
    world.left = `${fx - left * px}px`;
    world.top = `${fy - top * px}px`;
    // The frame keeps the camera's own framing (aspect frame.width / frame.height); the bleed widens the frustum around it.
    this.camera.setViewOffset(rw, rh, -left, -top, this.renderWidth, this.renderHeight);
    VIEW.snapGrid.x = this.renderWidth / 2;
    VIEW.snapGrid.y = this.renderHeight / 2;
  }

  /**
   * Upright: make the HUD `height` VIEW pixels tall, keep the camera's frame
   * centred in it, and lay the touch buttons out again (HudView follows on
   * its next draw).
   */
  private setViewHeight(height: number): void {
    if (height === VIEW.height && this.hudCanvas.height === height) return;
    VIEW.height = height;
    VIEW.frame.top = Math.round((height - VIEW.frame.height) / 2);
    this.hudCanvas.height = height;
    layoutTouchButtons();
  }

  /** The world canvas's bleed past the camera's frame, in world pixels per side (layoutWorld fills it). */
  private readonly bleed = { left: 0, right: 0, top: 0, bottom: 0 };

  /**
   * Work out the bleed for render scale `rs` (whole world pixels past each
   * side of the frame, at (fx, fy) and fw x fh CSS pixels, up to the
   * parent's edges and RENDER_BLEED_MAX), set renderWidth/renderHeight and
   * return the buffer's pixel count.
   */
  private layoutWorld(rs: number, scale: number, pw: number, ph: number, fx: number, fy: number, fw: number, fh: number): number {
    const rw = Math.round(VIEW.frame.width * rs);
    const rh = Math.round(VIEW.frame.height * rs);
    const px = scale / rs;
    const maxX = Math.floor(((RENDER_BLEED_MAX.x - 1) * rw) / 2);
    const maxY = Math.floor(((RENDER_BLEED_MAX.y - 1) * rh) / 2);
    const b = this.bleed;
    b.left = Math.min(maxX, Math.max(0, Math.ceil(fx / px - 0.01)));
    b.right = Math.min(maxX, Math.max(0, Math.ceil((pw - fx - fw) / px - 0.01)));
    b.top = Math.min(maxY, Math.max(0, Math.ceil(fy / px - 0.01)));
    b.bottom = Math.min(maxY, Math.max(0, Math.ceil((ph - fy - fh) / px - 0.01)));
    this.renderWidth = rw + b.left + b.right;
    this.renderHeight = rh + b.top + b.bottom;
    return this.renderWidth * this.renderHeight;
  }

  private readonly projected = new THREE.Vector3();

  /**
   * Where a world point shows on the HUD, in VIEW pixels (into `out`), as of
   * the last render; false when it is behind the camera.
   */
  worldToHud(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    const p = this.projected.set(x, y, z).project(this.camera);
    if (p.z < -1 || p.z > 1) return false;
    out.x = (((p.x + 1) / 2) * this.renderWidth - this.bleed.left) / this.renderScale;
    out.y = (((1 - p.y) / 2) * this.renderHeight - this.bleed.top) / this.renderScale + VIEW.frame.top;
    return true;
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
