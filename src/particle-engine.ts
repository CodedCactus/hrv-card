const PATH_SAMPLE_COUNT = 100;
const FLOW_STROKE_WIDTH = 90;
const MASK_RASTER_SCALE = 1;
const MASK_RASTER_PADDING = 2;
const DEFAULT_VIEWBOX_WIDTH = 1629;
const DEFAULT_VIEWBOX_HEIGHT = 640;

const PARTICLES_PER_SECOND_PER_PATH = 12;
const PARTICLE_SPEED = 0.2;
const MAX_PARTICLE_OFFSET = 0.8;
const TRAIL_DURATION_MS = 120;
const MAX_TRAIL_POINTS = 24;
const FADE_IN_END = 0.15;
const FADE_OUT_START = 0.85;
const FULL_CIRCLE = Math.PI * 2;

/** Precomputed point on a flow path plus its unit tangent. */
interface PathPoint {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

/** A single point in a particle's trail. */
interface TrailPoint {
  progress: number;
  offset: number;
  time: number;
}

/** Particle flowing along a path. */
interface Particle {
  progress: number;
  speed: number;
  size: number;
  pathIndex: 0 | 1;
  offset: number;
  trail: TrailPoint[];
  trailHead: number;
  trailCount: number;
}

function createParticle(
  size: number,
  pathIndex: 0 | 1,
  offset: number
): Particle {
  const trail: TrailPoint[] = new Array(MAX_TRAIL_POINTS);
  for (let i = 0; i < MAX_TRAIL_POINTS; i++) {
    trail[i] = { progress: 0, offset: 0, time: 0 };
  }

  return {
    progress: 0,
    speed: PARTICLE_SPEED,
    size,
    pathIndex,
    offset,
    trail,
    trailHead: 0,
    trailCount: 0,
  };
}

/**
 * Owns everything that draws the animated flow: canvas, path samples, mask
 * raster, particle state, and the frame loop. The card drives it with
 * `enabled` and `hasTemperatures`; visibility and reduced-motion are handled
 * internally.
 */
export class ParticleEngine {
  private readonly _svg: SVGSVGElement;
  private readonly _host: HTMLElement;
  private readonly _maskElement?: SVGPathElement;
  private readonly _pathPoints: PathPoint[][];

  private _canvas?: HTMLCanvasElement;
  private _canvasCtx?: CanvasRenderingContext2D;
  private _canvasScale = 0;
  private _displayWidth = 0;
  private _resizeObserver?: ResizeObserver;

  private _maskPath?: Path2D;
  private _maskBitmap?: Uint8Array;
  private _maskBitmapWidth = 0;
  private _maskBitmapHeight = 0;
  private _maskOriginX = 0;
  private _maskOriginY = 0;

  private _particles: Particle[] = [];
  private _animationFrame?: number;
  private _lastFrameTime = 0;

  private _enabled = true;
  private _hasTemperatures = false;
  private _attached = false;

  private _prefersReducedMotion = false;
  private _isVisible = true;
  private _isPageVisible = true;
  private _motionQuery?: MediaQueryList;
  private _intersectionObserver?: IntersectionObserver;

  constructor(
    svg: SVGSVGElement,
    host: HTMLElement,
    flowPaths: [SVGPathElement, SVGPathElement],
    maskElement?: SVGPathElement
  ) {
    this._svg = svg;
    this._host = host;
    this._maskElement = maskElement;
    this._pathPoints = this._samplePaths(flowPaths);

    const maskPathData = maskElement?.getAttribute("d");
    if (maskPathData && typeof Path2D !== "undefined") {
      this._maskPath = new Path2D(maskPathData);
    }
    this._computeMaskBitmap();

    this.attach();
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this._syncAnimationState();
  }

  set hasTemperatures(value: boolean) {
    this._hasTemperatures = value;
    this._syncAnimationState();
  }

  attach(): void {
    if (this._attached) return;
    this._attached = true;

    this._isPageVisible = !document.hidden;
    this._setupMotionPreference();
    this._setupVisibilityObserver();
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    this._ensureCanvas();
    this._syncAnimationState();
  }

  detach(): void {
    if (!this._attached) return;
    this._attached = false;

    // Keep particle state so a view switch (disconnect + reconnect) resumes
    // the animation instead of restarting it.
    this.pauseParticleAnimation();
    document.removeEventListener("visibilitychange", this._onVisibilityChange);

    if (typeof this._motionQuery?.removeEventListener === "function") {
      this._motionQuery.removeEventListener(
        "change",
        this._onMotionPreferenceChange
      );
    } else {
      this._motionQuery?.removeListener(this._onMotionPreferenceChange);
    }
    this._motionQuery = undefined;
    this._intersectionObserver?.disconnect();
    this._intersectionObserver = undefined;
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;

    // Remove the whole <foreignObject> wrapper; the rest of the SVG is
    // preserved and reused on reconnect.
    this._svg.querySelector("foreignObject")?.remove();
    this._canvas = undefined;
    this._canvasCtx = undefined;
    this._canvasScale = 0;
  }

  private _setupMotionPreference(): void {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    this._motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this._prefersReducedMotion = this._motionQuery.matches;

    if (typeof this._motionQuery.addEventListener === "function") {
      this._motionQuery.addEventListener("change", this._onMotionPreferenceChange);
    } else {
      // Safari < 14 uses the deprecated listener API.
      this._motionQuery.addListener(this._onMotionPreferenceChange);
    }
  }

  private _setupVisibilityObserver(): void {
    if (typeof IntersectionObserver === "undefined") {
      this._isVisible = true;
      return;
    }

    this._intersectionObserver?.disconnect();
    this._intersectionObserver = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return;
      this._isVisible = last.isIntersecting;
      this._syncAnimationState();
    });
    this._intersectionObserver.observe(this._host);
  }

  private _onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this._prefersReducedMotion = event.matches;
    this._syncAnimationState();
  };

  private _onVisibilityChange = (): void => {
    this._isPageVisible = !document.hidden;
    this._syncAnimationState();
  };

  private _samplePaths(
    flowPaths: [SVGPathElement, SVGPathElement]
  ): PathPoint[][] {
    const pathLengths = [
      flowPaths[0].getTotalLength(),
      flowPaths[1].getTotalLength(),
    ] as const;
    const samples: PathPoint[][] = [];

    for (let pathIndex = 0; pathIndex < 2; pathIndex++) {
      const path = flowPaths[pathIndex];
      const length = pathLengths[pathIndex];
      const points: PathPoint[] = [];

      for (let i = 0; i <= PATH_SAMPLE_COUNT; i++) {
        const progress = i / PATH_SAMPLE_COUNT;
        const len = progress * length;
        const point = path.getPointAtLength(len);
        const nextLen = Math.min(len + 1, length);
        const nextPoint = path.getPointAtLength(nextLen);
        const dx = nextPoint.x - point.x;
        const dy = nextPoint.y - point.y;
        const tangentLength = Math.hypot(dx, dy) || 1;
        points.push({
          x: point.x,
          y: point.y,
          tx: dx / tangentLength,
          ty: dy / tangentLength,
        });
      }

      samples.push(points);
    }

    return samples;
  }

  private _ensureCanvas(): void {
    if (this._canvas?.parentNode) return;

    this._svg.querySelector("foreignObject")?.remove();

    const wrapper = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "foreignObject"
    );
    wrapper.setAttribute("width", "100%");
    wrapper.setAttribute("height", "100%");
    wrapper.setAttribute("x", "0");
    wrapper.setAttribute("y", "0");
    wrapper.setAttribute("pointer-events", "none");

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    wrapper.appendChild(canvas);
    this._svg.appendChild(wrapper);
    this._canvas = canvas;
    this._canvasCtx = ctx;
    this._canvasScale = 0;

    // Track the displayed card width so the backing store can be sized to
    // actual device pixels instead of the full viewBox resolution. The host
    // is observed (not the canvas) because elements inside a foreignObject
    // report untransformed user-unit sizes.
    this._resizeObserver?.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver((entries) => {
        const last = entries[entries.length - 1];
        this._displayWidth = last?.contentRect.width ?? 0;
      });
      this._resizeObserver.observe(this._host);
    }
  }

  private _syncAnimationState(): void {
    if (!this._enabled || !this._hasTemperatures) {
      this.stopParticleAnimation();
      return;
    }

    const canAnimate =
      !this._prefersReducedMotion &&
      this._isVisible &&
      this._isPageVisible &&
      !!this._canvas &&
      !!this._canvasCtx;

    if (canAnimate) {
      if (!this._animationFrame) this.startParticleAnimation();
    } else {
      this.pauseParticleAnimation();
    }
  }

  private startParticleAnimation(): void {
    if (this._animationFrame) return;
    this._lastFrameTime = performance.now();
    this.animateParticles();
  }

  private pauseParticleAnimation(): void {
    if (!this._animationFrame) return;
    cancelAnimationFrame(this._animationFrame);
    this._animationFrame = undefined;
  }

  private stopParticleAnimation(): void {
    this.pauseParticleAnimation();
    this._particles.length = 0;
    this._clearCanvas();
  }

  /** Wipe the canvas backing store regardless of the current transform. */
  private _clearCanvas(): void {
    const { _canvas, _canvasCtx } = this;
    if (!_canvas || !_canvasCtx) return;
    _canvasCtx.save();
    _canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
    _canvasCtx.clearRect(0, 0, _canvas.width, _canvas.height);
    _canvasCtx.restore();
  }

  private animateParticles = (): void => {
    const now = performance.now();
    // Clamp the timestep so a suspended tab (rAF pauses) resuming after a long
    // gap does not fling every particle past the end of its path.
    const dt = Math.min((now - this._lastFrameTime) / 1000, 0.05);
    this._lastFrameTime = now;

    this.updateParticles(dt, now);
    this.renderParticles();

    this._animationFrame = requestAnimationFrame(this.animateParticles);
  };

  private updateParticles(dt: number, now: number): void {
    if (!this._hasTemperatures) {
      this._particles.length = 0;
      return;
    }

    const spawnChance = PARTICLES_PER_SECOND_PER_PATH * dt;
    for (let pathIndex = 0; pathIndex < 2; pathIndex++) {
      if (Math.random() < spawnChance) {
        const size = 3 + Math.random() * 2;
        const rawOffset = Math.random() * 2 - 1;
        const biasedOffset =
          Math.sign(rawOffset) * Math.pow(Math.abs(rawOffset), 1.5);
        const offset = Math.max(
          -MAX_PARTICLE_OFFSET,
          Math.min(MAX_PARTICLE_OFFSET, biasedOffset)
        );
        this._particles.push(createParticle(size, pathIndex as 0 | 1, offset));
      }
    }

    const trailCutoff = now - TRAIL_DURATION_MS;
    let writeIndex = 0;
    for (let i = 0; i < this._particles.length; i++) {
      const particle = this._particles[i];

      particle.trailHead = (particle.trailHead + 1) % MAX_TRAIL_POINTS;
      const point = particle.trail[particle.trailHead];
      point.progress = particle.progress;
      point.offset = particle.offset;
      point.time = now;

      if (particle.trailCount < MAX_TRAIL_POINTS) particle.trailCount++;

      let oldest =
        (particle.trailHead - particle.trailCount + 1 + MAX_TRAIL_POINTS) %
        MAX_TRAIL_POINTS;
      while (
        particle.trailCount > 1 &&
        particle.trail[oldest].time < trailCutoff
      ) {
        particle.trailCount--;
        oldest = (oldest + 1) % MAX_TRAIL_POINTS;
      }

      particle.progress += particle.speed * dt;
      if (particle.progress < 1) {
        this._particles[writeIndex++] = particle;
      }
    }
    this._particles.length = writeIndex;
  }

  private _computeMaskBitmap(): void {
    this._maskBitmap = undefined;
    this._maskBitmapWidth = 0;
    this._maskBitmapHeight = 0;
    this._maskOriginX = 0;
    this._maskOriginY = 0;
    if (!this._maskPath) return;

    const viewBox = this._svg.viewBox.baseVal;
    const viewWidth = viewBox?.width || DEFAULT_VIEWBOX_WIDTH;
    const viewHeight = viewBox?.height || DEFAULT_VIEWBOX_HEIGHT;
    const scale = MASK_RASTER_SCALE;

    let box = { x: 0, y: 0, width: viewWidth, height: viewHeight };
    if (this._maskElement && typeof this._maskElement.getBBox === "function") {
      try {
        const measured = this._maskElement.getBBox();
        if (measured.width > 0 && measured.height > 0) {
          box = measured;
        }
      } catch {
        // Fall back to the full viewBox when SVG geometry is unavailable.
      }
    }

    const originX = Math.max(
      0,
      Math.floor(box.x * scale) - MASK_RASTER_PADDING
    );
    const originY = Math.max(
      0,
      Math.floor(box.y * scale) - MASK_RASTER_PADDING
    );
    const endX = Math.min(
      Math.ceil(viewWidth * scale),
      Math.ceil((box.x + box.width) * scale) + MASK_RASTER_PADDING
    );
    const endY = Math.min(
      Math.ceil(viewHeight * scale),
      Math.ceil((box.y + box.height) * scale) + MASK_RASTER_PADDING
    );
    const width = endX - originX;
    const height = endY - originY;
    if (width <= 0 || height <= 0) return;

    const raster = document.createElement("canvas");
    raster.width = width;
    raster.height = height;
    const ctx = raster.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(scale, 0, 0, scale, -originX, -originY);
    ctx.fillStyle = "#fff";
    ctx.fill(this._maskPath);

    const data = ctx.getImageData(0, 0, width, height).data;
    const cells = width * height;
    const bitmap = new Uint8Array(Math.ceil(cells / 8));
    let masked = 0;
    for (let i = 0; i < cells; i++) {
      if (data[i * 4 + 3] > 0) {
        bitmap[i >> 3] |= 1 << (i & 7);
        masked++;
      }
    }

    if (masked === 0 || masked === cells) return;

    this._maskBitmap = bitmap;
    this._maskBitmapWidth = width;
    this._maskBitmapHeight = height;
    this._maskOriginX = originX;
    this._maskOriginY = originY;
  }

  private _isInMask(x: number, y: number): boolean {
    const bitmap = this._maskBitmap;
    const width = this._maskBitmapWidth;
    const height = this._maskBitmapHeight;
    if (!bitmap || width === 0 || height === 0) return false;

    const px = Math.round(x * MASK_RASTER_SCALE) - this._maskOriginX;
    const py = Math.round(y * MASK_RASTER_SCALE) - this._maskOriginY;
    if (px < 0 || py < 0 || px >= width || py >= height) return false;

    const index = py * width + px;
    return (bitmap[index >> 3] & (1 << (index & 7))) !== 0;
  }

  private renderParticles(): void {
    if (!this._canvas || !this._canvasCtx || !this._pathPoints.length) return;

    const ctx = this._canvasCtx;
    const dpr = window.devicePixelRatio || 1;

    const viewBox = this._svg.viewBox.baseVal;
    const viewBoxWidth = viewBox?.width || DEFAULT_VIEWBOX_WIDTH;
    const viewBoxHeight = viewBox?.height || DEFAULT_VIEWBOX_HEIGHT;

    // Size the backing store to the displayed card size in device pixels
    // rather than the full viewBox at device resolution.
    const scale = Math.min(
      ((this._displayWidth || viewBoxWidth) * dpr) / viewBoxWidth,
      dpr
    );
    const width = Math.round(viewBoxWidth * scale);
    const height = Math.round(viewBoxHeight * scale);

    if (
      this._canvas.width !== width ||
      this._canvas.height !== height ||
      this._canvasScale !== scale
    ) {
      this._canvas.width = width;
      this._canvas.height = height;
      this._canvasScale = scale;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }

    ctx.clearRect(0, 0, viewBoxWidth, viewBoxHeight);

    if (!this._particles.length) return;

    // Set the colour once per frame; per-point opacity is applied through
    // globalAlpha so the loop does not build an rgba() string for every point.
    ctx.fillStyle = "#fff";

    const particles = this._particles;
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      const trailSpan = Math.max(1, particle.trailCount - 1);
      const oldest =
        (particle.trailHead - particle.trailCount + 1 + MAX_TRAIL_POINTS) %
        MAX_TRAIL_POINTS;

      // Render oldest first so the trail fades towards its tail.
      for (let n = 0; n < particle.trailCount; n++) {
        const point = particle.trail[(oldest + n) % MAX_TRAIL_POINTS];
        const trailProgress = particle.trailCount === 1 ? 1 : n / trailSpan;
        const opacity = 0.1 * trailProgress;
        const size = particle.size * (0.5 + 0.5 * trailProgress);
        this._renderParticle(
          ctx,
          point.progress,
          point.offset,
          size,
          opacity,
          particle.pathIndex
        );
      }

      this._renderParticle(
        ctx,
        particle.progress,
        particle.offset,
        particle.size,
        0.4,
        particle.pathIndex
      );
    }

    ctx.globalAlpha = 1;
  }

  private _renderParticle(
    ctx: CanvasRenderingContext2D,
    progress: number,
    offset: number,
    size: number,
    baseOpacity: number,
    pathIndex: number
  ): void {
    const points = this._pathPoints[pathIndex];
    if (!points) return;

    const idx = progress * PATH_SAMPLE_COUNT;
    const i = Math.floor(idx);
    const f = idx - i;
    const a = points[Math.min(i, PATH_SAMPLE_COUNT)];
    const b = points[Math.min(i + 1, PATH_SAMPLE_COUNT)];

    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const tx = a.tx + (b.tx - a.tx) * f;
    const ty = a.ty + (b.ty - a.ty) * f;

    const offsetX = -ty * offset * (FLOW_STROKE_WIDTH / 2);
    const offsetY = tx * offset * (FLOW_STROKE_WIDTH / 2);
    const finalX = x + offsetX;
    const finalY = y + offsetY;

    if (pathIndex === 0 && this._isInMask(finalX, finalY)) return;

    let progressOpacity = 1;
    if (progress < FADE_IN_END) {
      progressOpacity = progress / FADE_IN_END;
    } else if (progress > FADE_OUT_START) {
      progressOpacity = (1 - progress) / (1 - FADE_OUT_START);
    }

    ctx.globalAlpha = baseOpacity * progressOpacity;
    ctx.beginPath();
    ctx.arc(finalX, finalY, size, 0, FULL_CIRCLE);
    ctx.fill();
  }
}
