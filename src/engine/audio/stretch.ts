/**
 * WSOLA time-stretching: changes the speed of audio without changing its pitch,
 * so sped-up or slowed-down voices still sound natural.
 *
 * `speed` > 1 makes audio shorter (faster), < 1 longer (slower).
 */
export function timeStretch(channels: Float32Array[], speed: number, sampleRate: number): Float32Array[] {
  if (!channels.length) return [];
  const inLen = channels[0]!.length;
  if (Math.abs(speed - 1) < 1e-3 || inLen === 0) return channels.map((c) => c.slice());

  const frame = Math.max(256, Math.round(sampleRate * 0.04)); // 40 ms
  const hopOut = Math.floor(frame / 2);
  const hopIn = hopOut * speed;
  const tol = Math.round(sampleRate * 0.012); // ±12 ms search
  const outLen = Math.max(1, Math.ceil(inLen / speed));
  const out = channels.map(() => new Float32Array(outLen + frame));
  const norm = new Float32Array(outLen + frame);
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1));

  // Mono mix for similarity search.
  const mono = new Float32Array(inLen);
  for (const ch of channels) for (let i = 0; i < inLen; i++) mono[i]! += ch[i]! / channels.length;

  const step = 4; // decimation for the correlation search (speed)
  let prevPos = 0; // input position of the previous chosen frame
  for (let k = 0; ; k++) {
    const outPos = k * hopOut;
    if (outPos >= outLen) break;
    const ideal = Math.round(k * hopIn);
    let best = ideal;
    if (k > 0) {
      // The natural continuation of the previous frame.
      const natural = prevPos + hopOut;
      let bestScore = -Infinity;
      const lo = Math.max(0, ideal - tol);
      const hi = Math.min(inLen - frame, ideal + tol);
      for (let cand = lo; cand <= hi; cand += 2) {
        let score = 0;
        for (let i = 0; i < hopOut; i += step) {
          const a = natural + i < inLen ? mono[natural + i]! : 0;
          const b = mono[cand + i] ?? 0;
          score += a * b;
        }
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    best = Math.max(0, Math.min(best, Math.max(0, inLen - 1)));
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c]!;
      const dst = out[c]!;
      for (let i = 0; i < frame; i++) {
        const si = best + i;
        if (si >= inLen) break;
        dst[outPos + i]! += src[si]! * win[i]!;
      }
    }
    for (let i = 0; i < frame; i++) norm[outPos + i]! += win[i]!;
    prevPos = best;
  }
  for (let c = 0; c < out.length; c++) {
    const dst = out[c]!;
    for (let i = 0; i < outLen; i++) {
      const n = norm[i]!;
      if (n > 1e-3) dst[i] = dst[i]! / n;
    }
    out[c] = dst.subarray(0, outLen).slice();
  }
  return out;
}
