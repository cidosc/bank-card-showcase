/**
 * 零依赖 PNG 亮度统计（用于量化“过曝 / 过暗”）。
 *
 * 用途：把 CDP 截图（PNG）解码成像素，统计亮度分布与削波比例，
 * 让“闪卡效果过曝 / 过暗”变成可比较、可回归的数字，而不是肉眼判断。
 *
 * 仅支持 Chrome 截图会产出的子集：8bit、非隔行、颜色类型 2(RGB) / 6(RGBA)。
 */

import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 解码 PNG 为 { width, height, channels, data }。
 * @param {Buffer} buffer
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("不是 PNG 数据");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`不支持的位深: ${bitDepth}`);
  if (interlace !== 0) throw new Error("不支持隔行 PNG");
  if (colorType !== 2 && colorType !== 6) throw new Error(`不支持的颜色类型: ${colorType}`);

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const current = Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      const value = line[x];
      let result;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          result = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          throw new Error(`未知的 PNG 过滤器: ${filter}`);
      }
      current[x] = result & 0xff;
    }
    current.copy(out, y * stride);
    previous = current;
  }

  return { width, height, channels, data: out };
}

/**
 * 亮度 / 曝光统计。
 * - `mean`：平均相对亮度 0–255
 * - `p05` / `p50` / `p95`：分位数
 * - `blown`：近乎纯白的像素占比（任一通道 ≥ 254，即通道削波）
 * - `crushed`：近乎纯黑的像素占比（三通道全部 ≤ 6）
 */
export function lumaStats(image) {
  const { width, height, channels, data } = image;
  const total = width * height;
  const histogram = new Uint32Array(256);
  let sum = 0;
  let blown = 0;
  let crushed = 0;

  for (let i = 0; i < total; i += 1) {
    const index = i * channels;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += luma;
    histogram[Math.min(255, Math.round(luma))] += 1;
    if (r >= 254 || g >= 254 || b >= 254) blown += 1;
    if (r <= 6 && g <= 6 && b <= 6) crushed += 1;
  }

  const quantile = (q) => {
    const target = q * total;
    let seen = 0;
    for (let i = 0; i < 256; i += 1) {
      seen += histogram[i];
      if (seen >= target) return i;
    }
    return 255;
  };

  return {
    pixels: total,
    mean: Number((sum / total).toFixed(2)),
    p05: quantile(0.05),
    p50: quantile(0.5),
    p95: quantile(0.95),
    blown: Number(((blown / total) * 100).toFixed(2)),
    crushed: Number(((crushed / total) * 100).toFixed(2)),
  };
}

/** 便捷函数：PNG Buffer → 统计。 */
export function pngStats(buffer) {
  return lumaStats(decodePng(buffer));
}
