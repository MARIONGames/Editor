/** Small WebGL2 toolkit: programs, textures, render targets and a target pool. */

export interface GLCaps {
  /** Render targets can be RGBA16F (smooth gradients, no banding). */
  halfFloat: boolean;
  maxTextureSize: number;
}

export interface RenderTarget {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  float: boolean;
}

export class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private gl: WebGL2RenderingContext,
    vs: string,
    fs: string,
    readonly name: string,
  ) {
    const v = compile(gl, gl.VERTEX_SHADER, vs, name);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs, name);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      throw new Error(`Program ${name} failed to link: ${log}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    this.prog = prog;
  }

  use(): this {
    this.gl.useProgram(this.prog);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }

  f(name: string, ...v: number[]): this {
    const l = this.loc(name);
    if (!l) return this;
    const gl = this.gl;
    if (v.length === 1) gl.uniform1f(l, v[0]!);
    else if (v.length === 2) gl.uniform2f(l, v[0]!, v[1]!);
    else if (v.length === 3) gl.uniform3f(l, v[0]!, v[1]!, v[2]!);
    else gl.uniform4f(l, v[0]!, v[1]!, v[2]!, v[3]!);
    return this;
  }

  i(name: string, v: number): this {
    const l = this.loc(name);
    if (l) this.gl.uniform1i(l, v);
    return this;
  }

  mat3(name: string, m: Float32Array): this {
    const l = this.loc(name);
    if (l) this.gl.uniformMatrix3fv(l, false, m);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.prog);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader ${name} failed to compile: ${log}`);
  }
  return s;
}

export function detectCaps(gl: WebGL2RenderingContext): GLCaps {
  const ext = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  let halfFloat = !!ext;
  if (halfFloat) {
    // Verify we can actually render to RGBA16F (some drivers lie).
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    halfFloat = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
  }
  return { halfFloat, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number };
}

export function createTexture(gl: WebGL2RenderingContext, mipmaps = false): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number, float: boolean): RenderTarget {
  const tex = createTexture(gl);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, float };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: RenderTarget): void {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/**
 * Re-uses intermediate render targets between passes and frames.
 * Targets not used for a while are freed.
 */
export class TargetPool {
  private free: (RenderTarget & { lastUsed: number })[] = [];
  private frame = 0;

  constructor(
    private gl: WebGL2RenderingContext,
    private float: boolean,
  ) {}

  acquire(w: number, h: number): RenderTarget {
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    const i = this.free.findIndex((t) => t.w === W && t.h === H);
    if (i >= 0) return this.free.splice(i, 1)[0]!;
    return createTarget(this.gl, W, H, this.float);
  }

  release(t: RenderTarget | null | undefined): void {
    if (!t) return;
    this.free.push({ ...t, lastUsed: this.frame });
  }

  /** Call once per rendered frame. */
  tick(): void {
    this.frame++;
    if (this.free.length > 24 || this.frame % 120 === 0) {
      const keep: (RenderTarget & { lastUsed: number })[] = [];
      for (const t of this.free) {
        if (this.frame - t.lastUsed > 180 || keep.length >= 24) deleteTarget(this.gl, t);
        else keep.push(t);
      }
      this.free = keep;
    }
  }

  dispose(): void {
    for (const t of this.free) deleteTarget(this.gl, t);
    this.free = [];
  }
}
