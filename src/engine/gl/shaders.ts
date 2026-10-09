/**
 * GLSL ES 3.00 shaders for the compositor.
 *
 * Conventions:
 * - All textures hold premultiplied alpha.
 * - Render targets are "GL oriented" (v = 0 is the bottom row). Uploaded images,
 *   videos and canvases are "image oriented" (v = 0 is the top row); passes take a
 *   `uSrcFlipY` flag to sample either kind correctly.
 */

const HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

/** Transformed, anti-aliased textured quad. */
export const VS_QUAD = `${HEADER}
layout(location = 0) in vec2 aPos;
uniform mat3 uMatrix;
uniform vec2 uSize;
uniform vec4 uUvRect;
uniform vec2 uFlip;
uniform float uSrcFlipY;
out vec2 vUv;
out vec2 vLocal;
void main() {
  vec2 pad = 1.0 / max(uSize, vec2(1.0));
  vec2 l = mix(-pad, 1.0 + pad, aPos);
  vLocal = l;
  vec3 p = uMatrix * vec3((l - 0.5) * uSize, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vec2 q = l;
  if (uFlip.x > 0.5) q.x = 1.0 - q.x;
  if (uFlip.y > 0.5) q.y = 1.0 - q.y;
  vec2 uv = mix(uUvRect.xy, uUvRect.zw, q);
  if (uSrcFlipY > 0.5) uv.y = 1.0 - uv.y;
  vUv = uv;
}`;

/** Full-target pass. vUv is GL oriented. */
export const VS_FULL = `${HEADER}
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FS_COMPOSITE = `${HEADER}
in vec2 vUv;
in vec2 vLocal;
uniform sampler2D uTex;
uniform float uOpacity;
uniform float uDim;
uniform vec2 uSize;
out vec4 o;
void main() {
  vec2 d = min(vLocal, 1.0 - vLocal) * uSize;
  float cov = clamp(min(d.x, d.y) + 0.5, 0.0, 1.0);
  vec4 c = texture(uTex, vUv);
  c.rgb *= uDim;
  o = c * (uOpacity * cov);
}`;

/** Crop + orientation normalisation (+ mip-mapped downscale) into a render target. */
export const FS_PREPARE = `${HEADER}
in vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uCrop;
uniform float uSrcFlipY;
out vec4 o;
void main() {
  vec2 q = vec2(vUv.x, 1.0 - vUv.y);
  vec2 uv = mix(uCrop.xy, uCrop.zw, q);
  if (uSrcFlipY > 0.5) uv.y = 1.0 - uv.y;
  o = texture(uTex, uv);
}`;

/** 2× downsample with a tent filter. */
export const FS_DOWN = `${HEADER}
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 o;
void main() {
  o = 0.25 * (texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, -1.0))
            + texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, 1.0)));
}`;

/** One direction of a separable Gaussian blur. */
export const FS_BLUR = `${HEADER}
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uSigma;
uniform int uRadius;
out vec4 o;
void main() {
  vec4 sum = texture(uTex, vUv);
  float ws = 1.0;
  float k = -0.5 / (uSigma * uSigma);
  for (int i = 1; i <= 24; i++) {
    if (i > uRadius) break;
    float fi = float(i);
    float w = exp(k * fi * fi);
    sum += (texture(uTex, vUv + uStep * fi) + texture(uTex, vUv - uStep * fi)) * w;
    ws += 2.0 * w;
  }
  o = sum / ws;
}`;

/** The "develop" pass: every colour adjustment, filter looks and chroma key. */
export const FS_DEVELOP = `${HEADER}
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uBlurS;
uniform sampler2D uBlurL;
uniform float uUseSharpen;
uniform float uUseClarity;
uniform float uExposure;
uniform float uBrightness;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform vec3 uWB;
uniform float uSaturation;
uniform float uVibrance;
uniform float uHue;
uniform float uFade;
uniform float uVignette;
uniform float uGrain;
uniform float uSharpen;
uniform float uClarity;
uniform vec4 uMono;
uniform vec3 uSplitShadows;
uniform vec3 uSplitHighlights;
uniform vec2 uSplit;
uniform vec4 uKey;
uniform vec3 uKeyParams;
uniform vec2 uSize;
uniform float uSeed;
out vec4 o;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec2 cbcr(vec3 c) { return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b); }
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 softLight(vec3 a, vec3 b) { return (1.0 - 2.0 * b) * a * a + 2.0 * b * a; }
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  vec4 src = texture(uTex, vUv);
  float a = src.a;
  if (a <= 0.0005) { o = vec4(0.0); return; }
  vec3 c = src.rgb / a;

  // Green screen.
  if (uKey.a > 0.5) {
    float d = distance(cbcr(c), cbcr(uKey.rgb));
    float t0 = mix(0.02, 0.32, uKeyParams.x);
    float t1 = t0 + mix(0.004, 0.2, uKeyParams.y);
    float m = smoothstep(t0, t1, d);
    a *= m;
    float spill = (1.0 - smoothstep(t0, t1 + 0.15, d)) * uKeyParams.z;
    c = mix(c, vec3(luma(c)), clamp(spill, 0.0, 1.0));
    if (a <= 0.0005) { o = vec4(0.0); return; }
  }

  // Detail: sharpen (small radius) and clarity (large radius local contrast).
  if (uUseSharpen > 0.5) {
    vec4 b = texture(uBlurS, vUv);
    vec3 bc = b.a > 0.0005 ? b.rgb / b.a : c;
    c += (c - bc) * uSharpen * 2.0;
  }
  if (uUseClarity > 0.5) {
    vec4 b = texture(uBlurL, vUv);
    vec3 bc = b.a > 0.0005 ? b.rgb / b.a : c;
    float l = luma(c);
    float w = 1.0 - pow(clamp(abs(l - 0.5) * 2.0, 0.0, 1.0), 2.0);
    c += (c - bc) * uClarity * (uClarity > 0.0 ? 1.1 : 0.9) * w;
  }
  c = clamp(c, 0.0, 1.0);

  // White balance and exposure in linear light.
  vec3 lin = toLinear(c) * uWB * exp2(uExposure);
  // Soft roll-off instead of hard clipping when brightening.
  lin = lin / (1.0 + max(lin - 1.0, 0.0));
  c = toSrgb(lin);

  // Levels: blacks / whites.
  float bp = max(-uBlacks, 0.0) * 0.12;
  float lift = max(uBlacks, 0.0) * 0.12;
  float wp = 1.0 - max(uWhites, 0.0) * 0.18;
  float dim = max(-uWhites, 0.0) * 0.16;
  c = clamp((c - bp) / max(wp - bp, 0.05), 0.0, 1.0);
  c = c * (1.0 - lift - dim) + lift;

  // Shadows / highlights (luminance masks, colour preserving).
  float l = luma(c);
  float shM = pow(1.0 - l, 2.0);
  float hiM = pow(l, 2.0);
  float dl = uShadows * 0.42 * shM * (uShadows > 0.0 ? (1.0 - l) : l)
           + uHighlights * 0.38 * hiM * (uHighlights > 0.0 ? (1.0 - l) : l);
  if (dl != 0.0) {
    float nl = clamp(l + dl, 0.0, 1.0);
    c = l > 0.002 ? c * (nl / l) : c + nl;
    c = clamp(c, 0.0, 1.0);
  }

  // Brightness (midtone gamma) and contrast (endpoint-preserving S-curve).
  c = pow(max(c, 0.0), vec3(exp2(-uBrightness * 0.85)));
  if (uContrast != 0.0) {
    float g = exp2(uContrast * 1.25);
    vec3 lo = 0.5 * pow(2.0 * c, vec3(g));
    vec3 hi = 1.0 - 0.5 * pow(2.0 * (1.0 - c), vec3(g));
    c = mix(lo, hi, step(0.5, c));
  }

  // Colour: hue, saturation, vibrance.
  if (uHue != 0.0) c = clamp(hueRotate(c, uHue), 0.0, 1.0);
  l = luma(c);
  c = mix(vec3(l), c, 1.0 + uSaturation);
  if (uVibrance != 0.0) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = mx - mn;
    // Protect skin tones a little (reds/oranges).
    float skin = smoothstep(0.08, 0.0, abs((c.g - c.b) / max(sat, 0.001) - 0.5) - 0.3) * step(c.b, c.g) * step(c.g, c.r);
    float v = uVibrance * (1.0 - sat) * (1.0 - 0.5 * skin);
    c = mix(vec3(l), c, 1.0 + v * 1.4);
  }
  c = clamp(c, 0.0, 1.0);

  // Filter looks: black & white mixer and split toning.
  if (uMono.a > 0.0) c = mix(c, vec3(dot(c, uMono.rgb)), uMono.a);
  if (uSplit.x > 0.0) {
    float t = smoothstep(0.0, 1.0, luma(c) + uSplit.y * 0.5);
    vec3 tone = mix(uSplitShadows, uSplitHighlights, t);
    c = mix(c, softLight(c, tone), uSplit.x);
  }

  // Fade (lifted blacks, softer whites).
  c = mix(c, vec3(0.12) + c * 0.82, uFade);

  // Vignette.
  if (uVignette != 0.0) {
    vec2 q = (vUv - 0.5) * 2.0;
    float r = length(q) * 0.7071;
    float v = smoothstep(0.3, 1.05, r);
    if (uVignette > 0.0) c *= 1.0 - uVignette * 0.78 * v;
    else c = mix(c, vec3(1.0), -uVignette * 0.65 * v);
  }

  // Film grain (luminance weighted).
  if (uGrain > 0.0) {
    float n = hash(floor(vUv * uSize) + uSeed) + hash(floor(vUv * uSize) + uSeed + 7.31) - 1.0;
    float lw = 1.0 - abs(luma(c) - 0.5) * 1.2;
    c += n * uGrain * 0.11 * lw;
  }

  c = clamp(c, 0.0, 1.0);
  o = vec4(c * a, a);
}`;

/** Transitions between two full-frame layers (A = outgoing, B = incoming). */
export const FS_TRANSITION = `${HEADER}
in vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uP;
uniform int uType;
uniform vec2 uRes;
out vec4 o;

vec4 sA(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uA, uv); }
vec4 sB(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uB, uv); }
vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
vec2 zoomUv(vec2 uv, float s) { return (uv - 0.5) / s + 0.5; }
vec2 rot(vec2 uv, float ang, float s) {
  float asp = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  float c = cos(ang), si = sin(ang);
  p = vec2(c * p.x - si * p.y, si * p.x + c * p.y) / s;
  return p / vec2(asp, 1.0) + 0.5;
}
vec4 blurA(vec2 uv, float r) {
  vec4 s = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 2.39996;
    float d = sqrt(float(i) / 16.0) * r;
    s += sA(uv + vec2(cos(a), sin(a)) * d * vec2(uRes.y / uRes.x, 1.0));
  }
  return s / 16.0;
}
vec4 blurB(vec2 uv, float r) {
  vec4 s = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 2.39996;
    float d = sqrt(float(i) / 16.0) * r;
    s += sB(uv + vec2(cos(a), sin(a)) * d * vec2(uRes.y / uRes.x, 1.0));
  }
  return s / 16.0;
}

void main() {
  vec2 uv = vUv;
  float p = clamp(uP, 0.0, 1.0);
  float e = ease(p);
  float s = 0.012;
  if (uType == 0) { o = mix(sA(uv), sB(uv), p); return; }
  if (uType == 1 || uType == 2) {
    vec4 mid = uType == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    o = p < 0.5 ? mix(sA(uv), mid, smoothstep(0.0, 0.5, p)) : mix(mid, sB(uv), smoothstep(0.5, 1.0, p));
    return;
  }
  if (uType == 3) { o = mix(sA(uv), sB(uv), smoothstep(1.0 - e - s, 1.0 - e + s, uv.x)); return; }
  if (uType == 4) { o = mix(sA(uv), sB(uv), 1.0 - smoothstep(e - s, e + s, uv.x)); return; }
  if (uType == 5) { o = mix(sA(uv), sB(uv), 1.0 - smoothstep(e - s, e + s, uv.y)); return; }
  if (uType == 6) { o = mix(sA(uv), sB(uv), smoothstep(1.0 - e - s, 1.0 - e + s, uv.y)); return; }
  if (uType == 7) { o = over(sB(uv - vec2(1.0 - e, 0.0)), sA(uv)); return; }
  if (uType == 8) { o = over(sB(uv + vec2(1.0 - e, 0.0)), sA(uv)); return; }
  if (uType == 9) { o = over(sB(uv + vec2(0.0, 1.0 - e)), sA(uv)); return; }
  if (uType == 10) { o = over(sB(uv - vec2(0.0, 1.0 - e)), sA(uv)); return; }
  if (uType == 11) { o = over(sB(uv - vec2(1.0 - e, 0.0)), sA(uv + vec2(e, 0.0))); return; }
  if (uType == 12) { o = over(sB(uv + vec2(1.0 - e, 0.0)), sA(uv - vec2(e, 0.0))); return; }
  if (uType == 13) {
    vec4 a = sA(zoomUv(uv, 1.0 + e * 0.8));
    vec4 b = sB(zoomUv(uv, mix(0.6, 1.0, e)));
    o = mix(a, b, smoothstep(0.2, 0.8, p));
    return;
  }
  if (uType == 14) {
    vec4 a = sA(zoomUv(uv, mix(1.0, 0.6, e)));
    vec4 b = sB(zoomUv(uv, mix(1.6, 1.0, e)));
    o = mix(a, b, smoothstep(0.2, 0.8, p));
    return;
  }
  if (uType == 15) {
    float asp = uRes.x / uRes.y;
    float d = length((uv - 0.5) * vec2(asp, 1.0));
    float r = e * length(vec2(asp, 1.0)) * 0.5 * 1.04;
    o = mix(sA(uv), sB(uv), 1.0 - smoothstep(r - 0.008, r + 0.008, d));
    return;
  }
  if (uType == 16) {
    float r = sin(p * 3.14159) * 0.03;
    o = mix(blurA(uv, r), blurB(uv, r), smoothstep(0.35, 0.65, p));
    return;
  }
  if (uType == 17) {
    if (p < 0.5) {
      float k = ease(p * 2.0);
      o = sA(rot(uv, k * 3.14159, 1.0 - k * 0.85)) * (1.0 - k * 0.6);
    } else {
      float k = ease((p - 0.5) * 2.0);
      o = sB(rot(uv, (1.0 - k) * -3.14159, 0.15 + k * 0.85)) * (0.4 + k * 0.6);
    }
    return;
  }
  o = mix(sA(uv), sB(uv), p);
}`;

/** W3C blend modes between the canvas so far (dst) and a full-frame layer (src). */
export const FS_BLEND = `${HEADER}
in vec2 vUv;
uniform sampler2D uDst;
uniform sampler2D uSrc;
uniform int uMode;
out vec4 o;

float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 softLightW3C(vec3 b, vec3 s) {
  vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
  return mix(b + (2.0 * s - 1.0) * (d - b), b - (1.0 - 2.0 * s) * b * (1.0 - b), step(s, vec3(0.5)));
}
vec3 hardLight(vec3 b, vec3 s) {
  return mix(b * 2.0 * s, 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)), step(0.5, s));
}
float dodge(float b, float s) { if (b <= 0.0) return 0.0; if (s >= 1.0) return 1.0; return min(1.0, b / (1.0 - s)); }
float burn(float b, float s) { if (b >= 1.0) return 1.0; if (s <= 0.0) return 0.0; return 1.0 - min(1.0, (1.0 - b) / s); }
vec3 fn(vec3 b, vec3 s) {
  if (uMode == 1) return b * s;
  if (uMode == 2) return b + s - b * s;
  if (uMode == 3) return hardLight(s, b);
  if (uMode == 4) return min(b, s);
  if (uMode == 5) return max(b, s);
  if (uMode == 6) return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));
  if (uMode == 7) return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));
  if (uMode == 8) return hardLight(b, s);
  if (uMode == 9) return softLightW3C(b, s);
  if (uMode == 10) return abs(b - s);
  if (uMode == 11) return b + s - 2.0 * b * s;
  if (uMode == 12) return min(vec3(1.0), b + s);
  return s;
}
void main() {
  vec4 d = texture(uDst, vUv);
  vec4 s = texture(uSrc, vUv);
  vec3 cb = d.a > 0.0005 ? d.rgb / d.a : vec3(0.0);
  vec3 cs = s.a > 0.0005 ? s.rgb / s.a : vec3(0.0);
  vec3 csp = (1.0 - d.a) * cs + d.a * clamp(fn(cb, cs), 0.0, 1.0);
  o = vec4(s.a * csp + (1.0 - s.a) * d.rgb, s.a + d.a * (1.0 - s.a));
}`;

/** Final blit to the canvas: optional checkerboard (transparency) and dithering. */
export const FS_OUTPUT = `${HEADER}
in vec2 vUv;
uniform sampler2D uTex;
uniform float uChecker;
uniform float uDither;
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main() {
  vec4 c = texture(uTex, vUv);
  if (uChecker > 0.5) {
    vec2 cell = floor(gl_FragCoord.xy / 14.0);
    float m = mod(cell.x + cell.y, 2.0);
    vec3 bg = mix(vec3(0.82), vec3(0.64), m);
    c = vec4(c.rgb + bg * (1.0 - c.a), 1.0);
  }
  float n = (hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 31.7) - 1.0) / 255.0;
  o = vec4(c.rgb + n * uDither * c.a, c.a);
}`;
