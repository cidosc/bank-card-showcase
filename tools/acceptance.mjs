#!/usr/bin/env node
/**
 * Bank Card Showcase —— 端到端验收脚本（零依赖）
 *
 * 用途：在真实 Chrome 中对 `npm run build:demo` 的产物做自动化验收，覆盖 SPEC 第 10 节：
 *   1. 桌面 / 移动多宽度下的卡面比例、图片不拉伸不裁切、无横向溢出
 *   2. 悬停倾斜、最大倾角、按压缩放、按住拖动、移出恢复
 *   3. 四种效果切换、银色独立原图、特效裁切在卡面轮廓内且不遮挡图案
 *   4. prefers-reduced-motion 生效时卡片静止
 *   5. 重复卸载 / 重新挂载无错误
 *   6. 移动端 touch-action 与页面滚动不受影响
 *   7. 全流程无 console 错误 / 未捕获异常 / 失败请求 / 外部 CDN 请求
 *
 * 实现方式：直接通过 Chrome DevTools Protocol（CDP）驱动本机 Chrome，
 * 不依赖 Playwright / Puppeteer 等额外依赖；静态服务由脚本自带。
 *
 * 用法：
 *   npm run build && npm run build:demo
 *   node tools/acceptance.mjs [--chrome <path>] [--out <dir>] [--keep-open]
 *
 * 退出码：0 = 全部通过；1 = 存在失败项（报告已写入 <out>/acceptance-report.json）。
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pngStats } from "./png-luma.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..");
const DEMO_DIR = join(ROOT, "dist-demo");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { out: join(ROOT, "acceptance-artifacts"), chrome: process.env.CHROME_PATH, keepOpen: false, checkBaseline: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = resolve(argv[++i]);
    else if (arg === "--chrome") args.chrome = argv[++i];
    else if (arg === "--keep-open") args.keepOpen = true;
    else if (arg === "--check-baseline") args.checkBaseline = resolve(argv[++i]);
  }
  return args;
}

// ---------------------------------------------------------------------------
// 代码 / 产物指纹（回答“当前代码是否就是被验收的那份产物”）
// ---------------------------------------------------------------------------

const MANIFEST_INPUTS = [
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.demo.config.ts",
  "vite.plugins.ts",
  "vitest.config.ts",
];

async function listFiles(dir, filter = () => true) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full, filter)));
    else if (filter(full)) found.push(full);
  }
  return found;
}

const shortHash = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 16);

/** 拆解 box-shadow：返回每层的 blur 半径与是否含纯黑重投影（用于量化“阴影有多重”）。 */
function analyzeShadow(shadow) {
  if (!shadow || shadow === "none") return { layers: 0, maxBlur: 0, hasBlack: false };
  const parts = shadow.split(/,(?![^(]*\))/);
  const blurs = parts.map((layer) => {
    const values = [...layer.matchAll(/(-?[\d.]+)px/g)].map((match) => Math.abs(Number(match[1])));
    return values.length >= 3 ? values[2] : 0;
  });
  return {
    layers: parts.length,
    maxBlur: blurs.length ? Math.max(...blurs) : 0,
    hasBlack: /rgb\(0,\s*0,\s*0\)|black/i.test(shadow),
  };
}

async function buildManifest() {
  const files = [
    ...MANIFEST_INPUTS.map((name) => join(ROOT, name)),
    ...(await listFiles(join(ROOT, "src"))),
    ...(await listFiles(join(ROOT, "dist"))),
    ...(await listFiles(join(ROOT, "dist-demo"))),
  ].filter((file) => existsSync(file));

  const entries = [];
  for (const file of files.sort()) {
    // eslint-disable-next-line no-await-in-loop
    entries.push([relative(ROOT, file).split(sep).join("/"), shortHash(await readFile(file))]);
  }
  const manifest = Object.fromEntries(entries);
  return { manifest, manifestDigest: shortHash(JSON.stringify(manifest)) };
}

// ---------------------------------------------------------------------------
// 全局选择器扫描（用于断言产物“零全局样式写入”）
// ---------------------------------------------------------------------------
const GLOBAL_HEAD = /^(\*|html|body|:root)(\s|$|:|\[|\.|,|>|\+|~)/;

function scanGlobalSelectors(cssText) {
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set();
  const ruleHead = /([^{}]+)\{/g;
  let match = ruleHead.exec(stripped);
  while (match !== null) {
    const head = match[1].trim();
    if (head && !head.startsWith("@")) {
      for (const part of head.split(",")) {
        const selector = part.trim();
        if (GLOBAL_HEAD.test(selector)) found.add(selector);
      }
    }
    match = ruleHead.exec(stripped);
  }
  return [...found];
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

function findChrome(explicit) {
  const candidates = [explicit, ...CHROME_CANDIDATES].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 静态服务（无依赖）
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

function startStaticServer(rootDir) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const target = resolve(rootDir, relative === "" ? "index.html" : relative);
    requests.push({ path: url.pathname, status: 0 });
    const entry = requests[requests.length - 1];
    if (target !== rootDir && !target.startsWith(rootDir + sep)) {
      entry.status = 403;
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(target);
      entry.status = 200;
      res.writeHead(200, {
        "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      entry.status = 404;
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolvePromise({
        origin: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 最小 CDP 客户端
// ---------------------------------------------------------------------------

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
      if (message.id !== undefined) {
        const key = `${message.sessionId ?? ""}:${message.id}`;
        const pending = this.pending.get(key);
        if (!pending) return;
        this.pending.delete(key);
        if (message.error) pending.reject(new Error(`${message.error.message} (${pending.method})`));
        else pending.resolve(message.result);
        return;
      }
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params, message.sessionId);
    });
  }

  static connect(url) {
    return new Promise((resolvePromise, rejectPromise) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolvePromise(new Cdp(socket)));
      socket.addEventListener("error", () => rejectPromise(new Error(`无法连接 CDP: ${url}`)));
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  off(method, handler) {
    const list = this.handlers.get(method);
    if (list) this.handlers.set(method, list.filter((item) => item !== handler));
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const key = `${sessionId ?? ""}:${id}`;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(key, { resolve: resolvePromise, reject: rejectPromise, method });
      this.socket.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.delete(key)) rejectPromise(new Error(`CDP 超时: ${method}`));
      }, 30000);
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* 忽略关闭异常 */
    }
  }
}

// ---------------------------------------------------------------------------
// 页面封装
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 等反光层的 glare 弹簧收敛到稳态（`--card-opacity` 达到目标值）。
 * 不这样做会把弹簧的过冲瞬间当成稳态值（实测过冲可达 4%，导致断言假阳性/假阴性）。
 */
async function waitForGlareSettled(page, timeout = 5000) {
  const read = `(() => {
    const holo = document.querySelector(".holo-card");
    if (!holo) return 0;
    const value = Number.parseFloat(getComputedStyle(holo).getPropertyValue("--card-opacity"));
    return Number.isFinite(value) ? value : 0;
  })()`;
  const deadline = Date.now() + timeout;
  let previous = await page.evaluate(read);
  let stableSince = null;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(150);
    // eslint-disable-next-line no-await-in-loop
    const value = await page.evaluate(read);
    if (Math.abs(value - previous) < 0.0015) {
      stableSince = stableSince ?? Date.now();
      if (Date.now() - stableSince >= 300) return value;
    } else {
      stableSince = null;
    }
    previous = value;
    if (Date.now() > deadline) return value;
  }
}

class Page {
  constructor(cdp, sessionId, origin, artifactsDir) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.origin = origin;
    this.artifactsDir = artifactsDir;
    this.consoleErrors = [];
    this.pageErrors = [];
    this.failedRequests = [];
    this.consoleWarnings = [];
  }

  send(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const message = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text;
      throw new Error(`页面脚本异常: ${message}`);
    }
    return response.result.value;
  }

  async waitFor(expression, { timeout = 8000, interval = 100, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      if (await this.evaluate(`Boolean(${expression})`)) return true;
      if (Date.now() > deadline) throw new Error(`等待超时: ${label}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(interval);
    }
  }

  async goto(url) {
    const loaded = new Promise((done) => {
      const handler = (params, sessionId) => {
        if (sessionId !== this.sessionId) return;
        this.cdp.off("Page.loadEventFired", handler);
        done(params);
      };
      this.cdp.on("Page.loadEventFired", handler);
    });
    await this.send("Page.navigate", { url });
    await loaded;
    await this.waitFor("document.readyState === 'complete'");
  }

  /** 打开页面并注入探针（每次导航后都必须重新注入）。 */
  async open(url, { needCard = true } = {}) {
    await this.goto(url);
    if (needCard) {
      await this.waitFor("document.querySelector('.bc-card')", { label: "卡片出现" });
      await this.waitFor("document.querySelector('.holo-card__image').complete", { label: "卡面图片加载" });
    }
    await this.evaluate(probeHelpers);
    await sleep(250);
  }

  async reload() {
    const loaded = new Promise((done) => {
      const handler = (params, sessionId) => {
        if (sessionId !== this.sessionId) return;
        this.cdp.off("Page.loadEventFired", handler);
        done(params);
      };
      this.cdp.on("Page.loadEventFired", handler);
    });
    await this.send("Page.reload", { ignoreCache: false });
    await loaded;
    await this.waitFor("document.readyState === 'complete'");
  }

  async setViewport({ width, height, mobile = false, deviceScaleFactor = 1 }) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  }

  async setReducedMotion(value) {
    await this.send("Emulation.setEmulatedMedia", {
      features: value === null ? [] : [{ name: "prefers-reduced-motion", value }],
    });
  }

  async mouse(type, x, y, extra = {}) {
    await this.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: extra.button ?? "none",
      buttons: extra.buttons ?? 0,
      clickCount: extra.clickCount ?? 0,
      pointerType: "mouse",
      ...extra,
    });
  }

  async moveMouse(x, y) {
    await this.mouse("mouseMoved", x, y, { buttons: 0 });
  }

  async pressMouse(x, y) {
    await this.mouse("mouseMoved", x, y, { buttons: 0 });
    await this.mouse("mousePressed", x, y, { button: "left", buttons: 1, clickCount: 1 });
  }

  async releaseMouse(x, y) {
    await this.mouse("mouseReleased", x, y, { button: "left", buttons: 0, clickCount: 1 });
  }

  async clickAt(x, y) {
    await this.pressMouse(x, y);
    await this.releaseMouse(x, y);
  }

  async touch(type, points) {
    await this.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  }

  async screenshot(name) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = join(this.artifactsDir, name);
    await writeFile(file, Buffer.from(data, "base64"));
    return file;
  }

  /** 截取指定区域（clip 坐标是**文档坐标**，需要自己加上滚动偏移）。 */
  async captureClip(clip) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    return Buffer.from(data, "base64");
  }
}

/** 效果对照页的探针：按卡面文件对齐“原图基线”，并按卡片下标定位与截图。 */
const galleryHelpers = `
window.__bcStatsOfImg = (img) => {
  if (!img || !img.complete || !img.naturalWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const total = canvas.width * canvas.height;
  let sum = 0, blown = 0, crushed = 0;
  for (let i = 0; i < total; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (r >= 254 || g >= 254 || b >= 254) blown++;
    if (r <= 6 && g <= 6 && b <= 6) crushed++;
  }
  return { mean: Number((sum / total).toFixed(2)), blown: Number(((blown / total) * 100).toFixed(2)), crushed: Number(((crushed / total) * 100).toFixed(2)) };
};
window.__bcBaselines = () => {
  const result = {};
  for (const img of Array.from(document.querySelectorAll(".reference img"))) {
    const key = (img.getAttribute("src") || "").split("/").pop();
    const stats = window.__bcStatsOfImg(img);
    if (key && stats) result[key] = stats;
  }
  return result;
};
window.__bcFaces = () => Array.from(document.querySelectorAll("#faces .grid")).map((grid) => ({
  faceImage: (grid.dataset.face || "").split("/").pop(),
  silverImage: (grid.dataset.silver || "").split("/").pop() || null,
  effects: Array.from(grid.querySelectorAll(".item")).map((item) => ({
    effect: item.dataset.effect,
    index: Array.from(document.querySelectorAll(".item")).indexOf(item),
  })),
}));
window.__bcItemBox = (index, fx = 0.85, fy = 0.18) => {
  const item = document.querySelectorAll(".item")[index];
  if (!item) return null;
  item.scrollIntoView({ block: "center", behavior: "instant" });
  const card = item.querySelector(".bc-card");
  if (!card) return null;
  const rect = card.getBoundingClientRect();
  return {
    x: rect.x + rect.width * fx,
    y: rect.y + rect.height * fy,
    pageBox: {
      x: rect.x + window.scrollX + 4,
      y: rect.y + window.scrollY + 4,
      width: Math.max(1, rect.width - 8),
      height: Math.max(1, rect.height - 8),
      scale: 1,
    },
  };
};
true;
`;

/** 页面内通用探针（注入一次，返回卡片/特效的真实状态）。 */
const PROBE = `(() => {
  const card = document.querySelector(".bc-card");
  const holo = document.querySelector(".holo-card");
  const img = document.querySelector(".holo-card__image");
  const shine = document.querySelector(".holo-card__shine");
  const front = document.querySelector(".holo-card__front");
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, right: r.right, bottom: r.bottom };
  };
  const num = (value) => {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const holoStyle = holo ? getComputedStyle(holo) : null;
  const cardRect = rect(card);
  const imgRect = rect(img);
  return {
    cardRect,
    imgRect,
    shineRect: rect(shine),
    frontRect: rect(front),
    rotateX: holoStyle ? num(holoStyle.getPropertyValue("--rotate-x")) : null,
    rotateY: holoStyle ? num(holoStyle.getPropertyValue("--rotate-y")) : null,
    pointerX: holoStyle ? holoStyle.getPropertyValue("--pointer-x").trim() : null,
    press: card ? card.style.getPropertyValue("--bc-press").trim() : null,
    effectAttr: card ? card.dataset.bcEffect : null,
    reducedAttr: card ? card.dataset.bcReducedMotion : null,
    holoEffect: holo ? holo.dataset.effect : null,
    shineOpacity: shine ? num(getComputedStyle(shine).opacity) : null,
    shineOverflow: shine ? getComputedStyle(shine).overflow : null,
    frontOverflow: front ? getComputedStyle(front).overflow : null,
    frontRadius: front ? getComputedStyle(front).borderRadius : null,
    cardRadius: card ? getComputedStyle(card).borderRadius : null,
    frontOpacity: front ? num(getComputedStyle(front).opacity) : null,
    imgOpacity: img ? num(getComputedStyle(img).opacity) : null,
    imgFit: img ? getComputedStyle(img).objectFit : null,
    imgSrc: img ? img.getAttribute("src") : null,
    imgNatural: img ? { w: img.naturalWidth, h: img.naturalHeight, complete: img.complete } : null,
    cardCount: document.querySelectorAll(".bc-card").length,
    showcaseCount: document.querySelectorAll(".bc-showcase").length,
    interactive: holo ? holo.classList.contains("holo-card--interactive") : null,
    touchAction: card ? getComputedStyle(card).touchAction : null,
    cardTransition: card ? getComputedStyle(card).transitionDuration : null,
    finePointer: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    scrollY: window.scrollY,
    pageH: document.documentElement.scrollHeight,
    infoRect: rect(document.querySelector(".bc-showcase__info")),
    mediaRect: rect(document.querySelector(".bc-showcase__media")),
    buttonHeights: Array.from(document.querySelectorAll(".bc-showcase__actions .bc-btn")).map((b) => b.getBoundingClientRect().height),
    cardOpacity: (() => {
      const holo = document.querySelector(".holo-card");
      if (!holo) return null;
      const value = Number.parseFloat(getComputedStyle(holo).getPropertyValue("--card-opacity"));
      return Number.isFinite(value) ? value : null;
    })(),
    rotatorShadow: (() => {
      const rotator = document.querySelector(".holo-card__rotator");
      return rotator ? getComputedStyle(rotator).boxShadow : null;
    })(),
    perspective: (() => {
      const translater = document.querySelector(".holo-card__translater");
      return translater ? getComputedStyle(translater).perspective : null;
    })(),
    surfaceAttr: card ? card.dataset.bcSurface : null,
    infoShadow: (() => {
      const info = document.querySelector(".bc-showcase__info");
      return info ? getComputedStyle(info).boxShadow : null;
    })(),
    externalResources: performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith(location.origin) && !name.startsWith("data:")),
    // 页面自身声明的外部依赖（真正需要检查的：不得引用 CDN）
    externalDeclared: Array.from(document.querySelectorAll("link[href],script[src],img[src],source[src]"))
      .map((el) => el.href || el.src)
      .filter((url) => url && !url.startsWith(location.origin) && !url.startsWith("data:")),
    externalCss: (() => {
      const found = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          const text = rule.cssText || "";
          const lower = text.toLowerCase();
          // 无正则转义：直接扫描 url(...) 内容，避免 data: URI 里的 http:// 误报。
          let external = null;
          let index = lower.indexOf("url(");
          while (index !== -1) {
            const end = text.indexOf(")", index);
            const inner = text
              .slice(index + 4, end === -1 ? undefined : end)
              .trim()
              .replace(/^["']|["']$/g, "");
            const value = inner.toLowerCase();
            if (value.startsWith("http:") || value.startsWith("https:") || value.startsWith("//")) {
              external = inner;
              break;
            }
            index = lower.indexOf("url(", end === -1 ? index + 4 : end);
          }
          if (lower.includes("@import") || external) found.push((external ?? text).slice(0, 140));
        }
      }
      return found;
    })(),
  };
})()`;

const probeHelpers = `
window.__bcButton = (text) => {
  const all = Array.from(document.querySelectorAll("button"));
  const found = all.find((b) => (b.textContent || "").trim() === text);
  if (!found) return null;
  // 开发控件可能在首屏之下：先滚动到视口中央，再返回真实点击坐标。
  found.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = found.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: found.disabled };
};
/** 将卡面滚入视口并返回卡面上「相对位置 (fx, fy)」的视口坐标（避免坐标失效）。 */
window.__bcHoverPoint = (fx = 0.9, fy = 0.1) => {
  const card = document.querySelector(".bc-card");
  if (!card) return null;
  card.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = card.getBoundingClientRect();
  return { x: r.x + r.width * fx, y: r.y + r.height * fy, w: r.width, h: r.height };
};
window.__bcProbe = () => (${PROBE});
window.__bcSetTilt = (value) => {
  const input = document.querySelector("input[type=range]");
  if (!input) return false;
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
};
true;
`;

// ---------------------------------------------------------------------------
// 断言收集
// ---------------------------------------------------------------------------

class Report {
  constructor() {
    this.checks = [];
    this.screenshots = [];
    this.notes = [];
  }

  check(id, label, ok, detail) {
    this.checks.push({ id, label, ok: ok === true, skipped: ok === "skip", detail });
    const status = ok === true ? "PASS" : ok === "skip" ? "SKIP" : "FAIL";
    const color = status === "PASS" ? "\u001b[32m" : status === "SKIP" ? "\u001b[33m" : "\u001b[31m";
    console.log(`${color}${status}\u001b[0m  ${id.padEnd(22)} ${label}${detail ? `  — ${detail}` : ""}`);
    return ok === true;
  }

  note(text) {
    this.notes.push(text);
    console.log(`\u001b[36mNOTE\u001b[0m  ${text}`);
  }

  get failed() {
    return this.checks.filter((check) => !check.ok && !check.skipped);
  }

  get passed() {
    return this.checks.filter((check) => check.ok);
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = new Report();

  if (!existsSync(join(DEMO_DIR, "index.html"))) {
    console.error("找不到 dist-demo/index.html，请先执行: npm run build && npm run build:demo");
    process.exit(1);
  }

  const fingerprint = await buildManifest();

  // 基线模式：不做浏览器验收，只比对“报告里的指纹”与“当前磁盘文件”。
  if (args.checkBaseline) {
    if (!existsSync(args.checkBaseline)) {
      console.error(`找不到基线报告: ${args.checkBaseline}`);
      process.exit(1);
    }
    const baseline = JSON.parse(await readFile(args.checkBaseline, "utf8"));
    const before = baseline.manifest ?? {};
    const after = fingerprint.manifest;
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => before[key] !== after[key]);
    console.log(`基线报告: ${args.checkBaseline} (generatedAt=${baseline.generatedAt ?? "?"})`);
    console.log(`基线指纹: ${baseline.manifestDigest} / 当前指纹: ${fingerprint.manifestDigest}`);
    if (changed.length === 0) {
      console.log("\u001b[32m一致\u001b[0m：当前代码与产物就是被验收的那份。");
      return;
    }
    console.log(`\u001b[31m漂移\u001b[0m：${changed.length} 个文件与基线不同：`);
    for (const key of changed.slice(0, 40)) console.log(`  ${key}: ${before[key] ?? "(缺失)"} -> ${after[key] ?? "(缺失)"}`);
    process.exitCode = 1;
    return;
  }
  const chromePath = findChrome(args.chrome);
  if (!chromePath) {
    console.error("找不到 Chrome。请用 --chrome <path> 或设置 CHROME_PATH。");
    process.exit(1);
  }

  await rm(args.out, { recursive: true, force: true });
  await mkdir(args.out, { recursive: true });

  const server = await startStaticServer(DEMO_DIR);
  const profileDir = join(tmpdir(), `bc-acceptance-${Date.now()}`);
  await mkdir(profileDir, { recursive: true });

  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1400,1000",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let wsUrl = null;
  const stderrChunks = [];
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrChunks.push(text);
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
    if (match && !wsUrl) wsUrl = match[1];
  });

  const deadline = Date.now() + 20000;
  while (!wsUrl) {
    if (Date.now() > deadline) {
      console.error("Chrome 启动失败（未拿到 CDP 地址）:\n" + stderrChunks.join("").slice(-2000));
      process.exit(1);
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(120);
  }
  report.note(`Chrome: ${chromePath}`);

  const cdp = await Cdp.connect(wsUrl);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(cdp, sessionId, server.origin, args.out);

  cdp.on("Runtime.consoleAPICalled", (params, sid) => {
    if (sid !== sessionId) return;
    const level = params.type;
    const text = (params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(" ");
    if (level === "error") page.consoleErrors.push(text);
    else if (level === "warning") page.consoleWarnings.push(text);
  });
  cdp.on("Runtime.exceptionThrown", (params, sid) => {
    if (sid !== sessionId) return;
    const details = params.exceptionDetails;
    page.pageErrors.push(details.exception?.description ?? details.text);
  });
  cdp.on("Network.loadingFailed", (params, sid) => {
    if (sid !== sessionId) return;
    if (params.blockedReason || params.errorText !== "net::ERR_ABORTED") {
      page.failedRequests.push(`${params.errorText} ${params.type}`);
    }
  });

  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.enable");

  const url = `${server.origin}/index.html`;

  try {
    // ---------------------------------------------------------------------
    // 组 1：多宽度响应式 / 比例 / 图片适配
    // ---------------------------------------------------------------------
    const viewports = [
      { label: "1440", width: 1440, height: 900, stacked: false },
      { label: "1280", width: 1280, height: 900, stacked: false },
      { label: "768", width: 768, height: 900, stacked: false },
      { label: "390", width: 390, height: 844, stacked: true, mobile: true },
      { label: "320", width: 320, height: 640, stacked: true, mobile: true },
    ];
    const layout = {};
    for (const viewport of viewports) {
      await page.setViewport(viewport);
      // eslint-disable-next-line no-await-in-loop
      await page.open(url);
      const state = await page.evaluate("window.__bcProbe()");
      layout[viewport.label] = state;

      const ratio = state.cardRect.w / state.cardRect.h;
      report.check(
        `layout.ratio@${viewport.label}`,
        `${viewport.width}px 卡面比例 1.586`,
        Math.abs(ratio - 1.586) <= 0.006,
        `实测 ${ratio.toFixed(4)} (${Math.round(state.cardRect.w)}×${Math.round(state.cardRect.h)})`,
      );
      const naturalRatio = state.imgNatural.w / state.imgNatural.h;
      report.check(
        `layout.image@${viewport.label}`,
        `${viewport.width}px 图片不拉伸不裁切`,
        state.imgFit === "contain" &&
          Math.abs(ratio - naturalRatio) <= 0.01 &&
          state.imgNatural.complete &&
          // 显式确认 WebP 真的被解码（naturalWidth/Height 非 0），而不是只写了路径
          state.imgNatural.w === 1015 &&
          state.imgNatural.h === 640 &&
          (state.imgSrc ?? "").endsWith(".webp") &&
          Math.abs(state.imgRect.w - state.cardRect.w) <= 1.5,
        `object-fit=${state.imgFit}, 原图 ${state.imgNatural.w}×${state.imgNatural.h} (${naturalRatio.toFixed(4)}), 渲染 ${Math.round(
          state.imgRect.w,
        )}×${Math.round(state.imgRect.h)}, src=${(state.imgSrc ?? "").split("/").pop()}`,
      );
      report.check(
        `layout.overflow@${viewport.label}`,
        `${viewport.width}px 无横向溢出`,
        state.scrollW <= state.innerW + 1,
        `scrollWidth=${state.scrollW}, innerWidth=${state.innerW}`,
      );
      const stacked = state.infoRect.y >= state.mediaRect.bottom - 1;
      const sideBySide = state.mediaRect.right <= state.infoRect.x + 1;
      report.check(
        `layout.stack@${viewport.label}`,
        `${viewport.width}px ${viewport.stacked ? "上卡下信息" : "左卡右信息"}`,
        viewport.stacked ? stacked : sideBySide,
        `media=${JSON.stringify({
          x: Math.round(state.mediaRect.x),
          y: Math.round(state.mediaRect.y),
          r: Math.round(state.mediaRect.right),
          b: Math.round(state.mediaRect.bottom),
        })} info=${JSON.stringify({ x: Math.round(state.infoRect.x), y: Math.round(state.infoRect.y) })}`,
      );
      if (viewport.label === "390") {
        const small = state.buttonHeights.filter((height) => height < 44).length;
        report.check("layout.touchtarget@390", "390px 按钮点击区域 ≥ 44px", small === 0, `按钮高度 ${state.buttonHeights.join(", ")}`);
      }
      report.screenshots.push(await page.screenshot(`viewport-${viewport.label}.png`));
    }

    // ---------------------------------------------------------------------
    // 组 2：交互（悬停倾斜 / 最大倾角 / 按压 / 拖动 / 恢复）
    // ---------------------------------------------------------------------
    await page.setViewport({ width: 1280, height: 900 });
    await page.open(url);

    const base = await page.evaluate("window.__bcProbe()");
    const hoverPoint = await page.evaluate("window.__bcHoverPoint(0.9, 0.1)");
    const probeX = hoverPoint.x;
    const probeY = hoverPoint.y;
    await page.moveMouse(probeX, probeY);
    await sleep(900);
    const hovered = await page.evaluate("window.__bcProbe()");

    const tiltMax = Math.max(Math.abs(hovered.rotateX), Math.abs(hovered.rotateY));
    report.check(
      "interaction.hover",
      "悬停产生 3D 倾斜",
      tiltMax > 1,
      `--rotate-x=${hovered.rotateX}deg, --rotate-y=${hovered.rotateY}deg`,
    );
    report.check(
      "interaction.maxTilt",
      "倾角不超过 maxTilt=7（且接近边缘值）",
      tiltMax <= 8.5 && tiltMax >= 3,
      `最大 ${tiltMax.toFixed(2)}deg ≤ 8.5，指针位于卡面边缘附近`,
    );
    report.check(
      "interaction.noFlip",
      "永不翻面（|倾角| < 20deg）",
      Math.abs(hovered.rotateX) < 20 && Math.abs(hovered.rotateY) < 20,
      `rotate=(${hovered.rotateX}, ${hovered.rotateY})`,
    );
    report.screenshots.push(await page.screenshot("interaction-hover-tilt.png"));

    // 倾角可配置：把滑块调到 14，同一探针点倾角应明显变大
    await page.evaluate("window.__bcSetTilt(14)");
    await page.moveMouse(probeX, probeY);
    await sleep(900);
    const tilt14 = await page.evaluate("window.__bcProbe()");
    const tilt14Max = Math.max(Math.abs(tilt14.rotateX), Math.abs(tilt14.rotateY));
    report.check(
      "interaction.maxTiltConfig",
      "maxTilt=14 时倾角同步放大且仍受限",
      tilt14Max > tiltMax * 1.2 && tilt14Max <= 15.5,
      `7°→${tiltMax.toFixed(2)}deg，14°→${tilt14Max.toFixed(2)}deg (≤15.5)`,
    );
    await page.evaluate("window.__bcSetTilt(7)");
    await page.moveMouse(probeX, probeY);
    await sleep(700);

    // 按压缩放
    const beforePress = await page.evaluate("window.__bcProbe()");
    await page.pressMouse(probeX, probeY);
    await sleep(260);
    const pressed = await page.evaluate("window.__bcProbe()");
    const pressRatio = pressed.cardRect.w / beforePress.cardRect.w;
    report.check(
      "interaction.press",
      "按下缩放约 0.98",
      Math.abs(Number.parseFloat(pressed.press) - 0.98) < 0.001 && Math.abs(pressRatio - 0.98) < 0.006,
      `--bc-press=${pressed.press}, 实测宽度比 ${pressRatio.toFixed(4)}`,
    );

    // 按住拖动：倾角变化、卡片位置不变
    const dragPoint = await page.evaluate("window.__bcHoverPoint(0.15, 0.85)");
    const dragX = dragPoint.x;
    const dragY = dragPoint.y;
    await page.mouse("mouseMoved", dragX, dragY, { buttons: 1 });
    await sleep(500);
    const dragged = await page.evaluate("window.__bcProbe()");
    const centerShift = Math.hypot(dragged.cardRect.cx - pressed.cardRect.cx, dragged.cardRect.cy - pressed.cardRect.cy);
    report.check(
      "interaction.dragTilt",
      "按住拖动改变倾角",
      Math.abs(dragged.rotateX - pressed.rotateX) > 0.5 || Math.abs(dragged.rotateY - pressed.rotateY) > 0.5,
      `拖动前 (${pressed.rotateX}, ${pressed.rotateY}) → 拖动后 (${dragged.rotateX}, ${dragged.rotateY})`,
    );
    report.check(
      "interaction.dragNoTranslate",
      "拖动不会把卡片拖出原位",
      centerShift < 3,
      `中心位移 ${centerShift.toFixed(2)}px`,
    );
    await page.releaseMouse(dragX, dragY);
    await sleep(260);
    const released = await page.evaluate("window.__bcProbe()");
    report.check(
      "interaction.release",
      "松开后按压缩放恢复",
      Number.parseFloat(released.press) === 1,
      `--bc-press=${released.press}`,
    );

    // 移出后平滑恢复：测量真实回正耗时
    await page.moveMouse(5, 5);
    const settleStart = Date.now();
    let settleMs = null;
    let settleLast = null;
    for (let index = 0; index < 40; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(200);
      // eslint-disable-next-line no-await-in-loop
      const state = await page.evaluate("window.__bcProbe()");
      settleLast = Math.max(Math.abs(state.rotateX), Math.abs(state.rotateY));
      if (settleLast < 0.5) {
        settleMs = Date.now() - settleStart;
        break;
      }
    }
    report.check(
      "interaction.leave",
      "鼠标移出后平滑恢复水平（回正 ≤ 1.6s）",
      settleMs !== null && settleMs <= 1600,
      `回正耗时 ${settleMs === null ? ">8s" : `${settleMs}ms`}，剩余倾角 ${settleLast?.toFixed(2)}deg`,
    );

    // 窗口失焦 / 中断：按下后触发 window.blur，缩放必须复位
    await page.pressMouse(probeX, probeY);
    await sleep(200);
    await page.evaluate("window.dispatchEvent(new Event('blur'))");
    await sleep(200);
    const blurred = await page.evaluate("window.__bcProbe()");
    report.check(
      "interaction.blurReset",
      "失焦后按压状态复位（不留错误姿态）",
      Number.parseFloat(blurred.press) === 1,
      `--bc-press=${blurred.press}`,
    );
    await page.releaseMouse(probeX, probeY);

    // ---------------------------------------------------------------------
    // 组 3：效果切换 / 银色独立原图 / 特效裁切与遮挡
    // ---------------------------------------------------------------------
    // expectShine = 计划值 × 底层各效果自带系数（none/holo/glitter = 1.0，metal = 0.9），
    // 因此这里能真正校验“配置真的生效”，而不只是“不透明度落在某个区间”。
    const effectPlan = [
      { effect: "normal", holo: "none", src: "panda-card.webp", plan: 0.48, effectiveShine: 0.48 },
      { effect: "holographic", holo: "holo", src: "panda-card.webp", plan: 0.48, effectiveShine: 0.48 },
      { effect: "glitter", holo: "glitter", src: "panda-card.webp", plan: 0.34, effectiveShine: 0.34 },
      { effect: "silver", holo: "metal", src: "panda-card-silver.webp", plan: 0.18, effectiveShine: 0.162 },
    ];
    // 先切到 Sad Panda（带独立银色原图），同时验证换图与 silver 原图链路。
    const pandaButton = await page.evaluate(`window.__bcButton("Sad Panda 熊猫卡")`);
    if (pandaButton) {
      await page.clickAt(pandaButton.x, pandaButton.y);
      await sleep(260);
    }
    const afterProduct = await page.evaluate("window.__bcProbe()");
    report.check(
      "effect.productSwitchIn",
      "切换商品后卡面图片随之更换（且 WebP 真的解码成功）",
      (afterProduct.imgSrc ?? "").includes("panda-card.webp") &&
        afterProduct.imgNatural?.complete === true &&
        afterProduct.imgNatural.w === 1015 &&
        afterProduct.imgNatural.h === 640 &&
        (afterProduct.imgSrc ?? "").endsWith(".webp"),
      `img.src=${(afterProduct.imgSrc ?? "").split("/").pop()}, 解码后尺寸=${
        afterProduct.imgNatural?.w ?? 0
      }×${afterProduct.imgNatural?.h ?? 0}, complete=${afterProduct.imgNatural?.complete}`,
    );
    for (const item of effectPlan) {
      const target = await page.evaluate(`window.__bcButton(${JSON.stringify(item.effect)})`);
      if (!target) {
        report.check(`effect.${item.effect}`, `效果按钮 ${item.effect} 存在`, false, "未找到按钮");
        continue;
      }
      await page.clickAt(target.x, target.y);
      await sleep(220);
      const point = await page.evaluate("window.__bcHoverPoint(0.9, 0.1)");
      await page.moveMouse(point.x, point.y);
      // 等 glare 弹簧收敛后再读值：断言的是“配置的稳态强度”，不是过冲瞬间。
      await waitForGlareSettled(page);
      await sleep(150);
      const state = await page.evaluate("window.__bcProbe()");
      const src = (state.imgSrc ?? "").split("/").pop();
      report.check(
        `effect.${item.effect}`,
        `效果 ${item.effect} → 底层 ${item.holo}`,
        state.effectAttr === item.effect && state.holoEffect === item.holo,
        `data-bc-effect=${state.effectAttr}, holo.dataset.effect=${state.holoEffect}`,
      );
      report.check(
        `effect.${item.effect}.image`,
        `${item.effect} 使用 ${item.src}`,
        src === item.src,
        `img.src=${src}`,
      );
      report.check(
        `effect.${item.effect}.artwork`,
        `${item.effect} 反光层强度符合配置且不遮挡卡面`,
        state.frontOpacity >= 0.99 &&
          state.imgOpacity === 1 &&
          state.shineOpacity !== null &&
          // 上限：反光层永远不能完全不透明（否则会盖住卡面图案）
          state.shineOpacity <= 0.97 &&
          // 实测值应接近「计划值 × 底层系数」（在弹簧稳态下测量）
          Math.abs(state.shineOpacity - item.effectiveShine) <= 0.04,
        `front.opacity=${state.frontOpacity}, img.opacity=${state.imgOpacity}, shine.opacity=${state.shineOpacity?.toFixed(
          3,
        )} (计划 ${item.plan} × 底层系数 = ${item.effectiveShine}; 稳态 --card-opacity=${state.cardOpacity})`,
      );
      report.check(
        `effect.${item.effect}.clip`,
        `${item.effect} 特效裁切在卡面轮廓内`,
        state.shineOverflow === "hidden" &&
          state.frontOverflow === "hidden" &&
          Math.abs(state.shineRect.w - state.frontRect.w) <= 1.5 &&
          Math.abs(state.shineRect.h - state.frontRect.h) <= 1.5 &&
          /%/.test(state.cardRadius ?? "") &&
          /%/.test(state.frontRadius ?? ""),
        `overflow=${state.shineOverflow}/${state.frontOverflow}, shine=${Math.round(state.shineRect.w)}×${Math.round(
          state.shineRect.h,
        )} 对比 front=${Math.round(state.frontRect.w)}×${Math.round(state.frontRect.h)}, radius=${state.frontRadius}`,
      );
      report.screenshots.push(await page.screenshot(`effect-${item.effect}.png`));
    }

    // 切回商品 A（Cookie）验证换图
    const cookieButton = await page.evaluate(`window.__bcButton("Cookie 曲奇卡")`);
    await page.clickAt(cookieButton.x, cookieButton.y);
    await sleep(300);
    const cookieState = await page.evaluate("window.__bcProbe()");
    report.check(
      "effect.productSwitch",
      "切换商品会更换卡面图片",
      (cookieState.imgSrc ?? "").includes("cookie"),
      `img.src=${(cookieState.imgSrc ?? "").split("/").pop()}`,
    );

    // ---------------------------------------------------------------------
    // 组 3.5：卡面质感（flat 轻量化平面风 / physical 实体感）
    // ---------------------------------------------------------------------
    // 截质感对比图前先把卡面滚到视口中央（否则卡面被切掉、看不清投影差别）。
    await page.evaluate("window.__bcHoverPoint(0.5, 0.5)");
    await sleep(320);
    const flatState = await page.evaluate("window.__bcProbe()");
    const flatShadow = analyzeShadow(flatState.rotatorShadow);
    report.check(
      "surface.defaultFlat",
      "默认质感为 flat 且投影很轻（无黑色重投影）",
      flatState.surfaceAttr === "flat" && flatShadow.maxBlur <= 16 && !flatShadow.hasBlack,
      `data-bc-surface=${flatState.surfaceAttr}, 阴影层数=${flatShadow.layers}, 最大模糊=${flatShadow.maxBlur}px, 含纯黑=${flatShadow.hasBlack}`,
    );
    report.check(
      "surface.flatPerspective",
      "flat 模式透视更平（≥ 900px）",
      Number.parseFloat(flatState.perspective) >= 900,
      `perspective=${flatState.perspective}`,
    );
    report.check(
      "surface.flatInfoShadow",
      "flat 模式下页面白色容器同步变轻（宿主变量生效）",
      analyzeShadow(flatState.infoShadow).maxBlur <= 2,
      `信息卡阴影最大模糊=${analyzeShadow(flatState.infoShadow).maxBlur}px`,
    );
    report.screenshots.push(await page.screenshot("surface-flat.png"));

    const physicalButton = await page.evaluate(`window.__bcButton("physical")`);
    if (!physicalButton) {
      report.check("surface.togglePhysical", "质感切换到 physical", false, "未找到 physical 按钮");
    } else {
      await page.clickAt(physicalButton.x, physicalButton.y);
      await sleep(240);
      await page.evaluate("window.__bcHoverPoint(0.5, 0.5)");
      await sleep(300);
      const physicalState = await page.evaluate("window.__bcProbe()");
      const physicalShadow = analyzeShadow(physicalState.rotatorShadow);
      report.check(
        "surface.togglePhysical",
        "切到 physical 恢复底层较重的实体投影",
        physicalState.surfaceAttr === "physical" && physicalShadow.maxBlur >= 18 && physicalShadow.hasBlack,
        `data-bc-surface=${physicalState.surfaceAttr}, 最大模糊=${physicalShadow.maxBlur}px, 含纯黑=${physicalShadow.hasBlack}, perspective=${physicalState.perspective}`,
      );
      report.check(
        "surface.physicalPerspective",
        "physical 模式恢复底层立体透视（600px）",
        Math.abs(Number.parseFloat(physicalState.perspective) - 600) <= 0.5,
        `perspective=${physicalState.perspective}`,
      );
      report.screenshots.push(await page.screenshot("surface-physical.png"));

      const backToFlat = await page.evaluate(`window.__bcButton("flat")`);
      await page.clickAt(backToFlat.x, backToFlat.y);
      await sleep(240);
      const backState = await page.evaluate("window.__bcProbe()");
      report.check(
        "surface.backToFlat",
        "可切回 flat（属性与阴影同步生效）",
        backState.surfaceAttr === "flat" && analyzeShadow(backState.rotatorShadow).maxBlur <= 16,
        `data-bc-surface=${backState.surfaceAttr}, 最大模糊=${analyzeShadow(backState.rotatorShadow).maxBlur}px`,
      );
    }

    // ---------------------------------------------------------------------
    // 组 4：prefers-reduced-motion
    // ---------------------------------------------------------------------
    await page.setReducedMotion("reduce");
    await page.reload();
    await page.waitFor("document.querySelector('.bc-card')");
    await page.evaluate(probeHelpers);
    await sleep(300);
    const rmBase = await page.evaluate("window.__bcProbe()");
    await page.moveMouse(probeX, probeY);
    await sleep(900);
    await page.pressMouse(probeX, probeY);
    await sleep(300);
    const rmHover = await page.evaluate("window.__bcProbe()");
    report.check(
      "reduced.flag",
      "reduced-motion 时组件进入静止模式",
      rmBase.reducedAttr === "true" && rmBase.interactive === false,
      `data-bc-reduced-motion=${rmBase.reducedAttr}, interactive=${rmBase.interactive}`,
    );
    report.check(
      "reduced.static",
      "reduced-motion 时悬停 / 按压不再产生动效",
      Math.abs(rmHover.rotateX) < 0.05 &&
        Math.abs(rmHover.rotateY) < 0.05 &&
        Number.parseFloat(rmHover.press) === 1,
      `rotate=(${rmHover.rotateX}, ${rmHover.rotateY}), press=${rmHover.press}`,
    );
    report.check(
      "reduced.transition",
      "reduced-motion 时关闭过渡",
      rmBase.cardTransition.split(",").every((value) => Number.parseFloat(value) === 0),
      `transition-duration=${rmBase.cardTransition}`,
    );
    report.screenshots.push(await page.screenshot("reduced-motion.png"));
    await page.releaseMouse(probeX, probeY);
    await page.setReducedMotion(null);
    await page.reload();
    await page.waitFor("document.querySelector('.bc-card')");
    await page.evaluate(probeHelpers);
    await sleep(300);
    const rmOff = await page.evaluate("window.__bcProbe()");
    report.check(
      "reduced.resume",
      "系统设置取消后恢复交互",
      rmOff.reducedAttr === "false" && rmOff.interactive === true,
      `data-bc-reduced-motion=${rmOff.reducedAttr}, interactive=${rmOff.interactive}`,
    );

    // ---------------------------------------------------------------------
    // 组 5：重复卸载 / 重新挂载
    // ---------------------------------------------------------------------
    for (let index = 0; index < 5; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      const unmount = await page.evaluate(`window.__bcButton("卸载（destroy）")`);
      // eslint-disable-next-line no-await-in-loop
      if (!unmount) break;
      // eslint-disable-next-line no-await-in-loop
      await page.clickAt(unmount.x, unmount.y);
      // eslint-disable-next-line no-await-in-loop
      await sleep(160);
      // eslint-disable-next-line no-await-in-loop
      const countAfterDestroy = await page.evaluate("document.querySelectorAll('.bc-card').length");
      // eslint-disable-next-line no-await-in-loop
      if (countAfterDestroy !== 0) {
        report.check("lifecycle.destroy", `第 ${index + 1} 次卸载后 DOM 已清理`, false, `仍有 ${countAfterDestroy} 张卡`);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      const remount = await page.evaluate(`window.__bcButton("重新挂载（mount）")`);
      // eslint-disable-next-line no-await-in-loop
      if (!remount) break;
      // eslint-disable-next-line no-await-in-loop
      await page.clickAt(remount.x, remount.y);
      // eslint-disable-next-line no-await-in-loop
      await sleep(220);
    }
    await page.waitFor("document.querySelector('.bc-card')");
    await page.evaluate(probeHelpers);
    const remountPoint = await page.evaluate("window.__bcHoverPoint(0.9, 0.1)");
    await page.moveMouse(remountPoint.x, remountPoint.y);
    await sleep(800);
    const afterStress = await page.evaluate("window.__bcProbe()");
    report.check(
      "lifecycle.stress",
      "5 次 destroy/mount 后仍只有一套实例且可交互",
      afterStress.cardCount === 1 &&
        afterStress.showcaseCount === 1 &&
        Math.max(Math.abs(afterStress.rotateX), Math.abs(afterStress.rotateY)) > 1,
      `cards=${afterStress.cardCount}, showcases=${afterStress.showcaseCount}, tilt=(${afterStress.rotateX}, ${afterStress.rotateY})`,
    );
    report.screenshots.push(await page.screenshot("lifecycle-after-remount.png"));

    // ---------------------------------------------------------------------
    // 组 6：移动端滚动与触摸
    // ---------------------------------------------------------------------
    await page.setViewport({ width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
    await page.open(url);
    const mobile1 = await page.evaluate("window.__bcProbe()");
    await page.evaluate("window.scrollTo(0, 400)");
    await sleep(200);
    const mobile2 = await page.evaluate("window.__bcProbe()");
    report.check(
      "mobile.touchAction",
      "移动端卡面 touch-action=pan-y",
      mobile1.touchAction === "pan-y",
      `touch-action=${mobile1.touchAction}`,
    );
    report.check(
      "mobile.scroll",
      "移动端页面可正常滚动",
      mobile2.scrollY > 100 && mobile2.pageH > mobile2.innerW,
      `scrollY=${mobile2.scrollY}, 页面高度=${mobile2.pageH}`,
    );
    if (mobile1.finePointer) {
      report.check("mobile.touchTilt", "触摸设备默认不接管倾斜", "skip", `headless 仍报告 hover:hover/pointer:fine，无法在真实触摸设备语义下断言（单测已覆盖 touchTilt 逻辑）`);
    } else {
      report.check(
        "mobile.touchTilt",
        "触摸设备默认不接管倾斜",
        mobile1.interactive === false,
        `interactive=${mobile1.interactive}, finePointer=${mobile1.finePointer}`,
      );
    }
    const mobileCardRect = mobile1.cardRect;
    await page.touch("touchStart", [{ x: mobileCardRect.cx, y: mobileCardRect.cy, id: 1 }]);
    await page.touch("touchMove", [{ x: mobileCardRect.cx + 40, y: mobileCardRect.cy + 20, id: 1 }]);
    await sleep(300);
    const mobileTouch = await page.evaluate("window.__bcProbe()");
    await page.touch("touchEnd", []);
    report.check(
      "mobile.scrollAfterTouch",
      "触摸操作后仍可滚动且无横向溢出",
      mobileTouch.scrollW <= mobileTouch.innerW + 1,
      `scrollWidth=${mobileTouch.scrollW}, innerWidth=${mobileTouch.innerW}`,
    );
    report.screenshots.push(await page.screenshot("mobile-390.png"));

    // ---------------------------------------------------------------------
    // 组 7：无外部依赖 / 无错误
    // ---------------------------------------------------------------------
    await page.setViewport({ width: 1280, height: 900 });
    await page.open(url);
    await sleep(400);
    const networkState = await page.evaluate("window.__bcProbe()");
    report.check(
      "assets.selfHosted",
      "不引用外部 CDN（页面声明 / 样式表均同源）",
      networkState.externalDeclared.length === 0 && networkState.externalCss.length === 0,
      `声明外部资源 ${networkState.externalDeclared.length} 个, 样式表外部引用 ${networkState.externalCss.length} 个`,
    );
    const injected = networkState.externalResources.filter((url) => !url.startsWith(server.origin));
    if (injected.length > 0) {
      const hosts = [...new Set(injected.map((url) => new URL(url).host))].join(", ");
      report.note(`页面运行环境注入了 ${injected.length} 个外部请求（非本项目资源，已排除）：${hosts}`);
    }

    // 产物 CSS 必须“零全局样式写入”：不得出现 :root / html / body / * 选择器。
    const builtCssFiles = await listFiles(join(DEMO_DIR, "assets"), (file) => file.endsWith(".css"));
    const builtCss = (await Promise.all(builtCssFiles.map((file) => readFile(file, "utf8")))).join("\n");
    const globalSelectors = scanGlobalSelectors(builtCss);
    const libCss = await readFile(join(ROOT, "dist", "bank-card-showcase.css"), "utf8");
    const libGlobalSelectors = scanGlobalSelectors(libCss);
    report.check(
      "styles.noGlobalSelectors",
      "产物 CSS 零全局样式写入（:root / html / body / *）",
      globalSelectors.length === 0 && libGlobalSelectors.length === 0,
      `演示包 ${globalSelectors.length} 处${
        globalSelectors.length ? `: ${globalSelectors.slice(0, 5).join(", ")}` : ""
      }；库产物 ${libGlobalSelectors.length} 处${
        libGlobalSelectors.length ? `: ${libGlobalSelectors.slice(0, 5).join(", ")}` : ""
      }，扫描 ${builtCssFiles.length + 1} 个 CSS 文件`,
    );
    report.check(
      "runtime.consoleErrors",
      "无 console 错误 / 未捕获异常",
      page.consoleErrors.length === 0 && page.pageErrors.length === 0,
      `console=${page.consoleErrors.length}, pageErrors=${page.pageErrors.length}${
        page.pageErrors.length ? `: ${page.pageErrors[0].slice(0, 200)}` : ""
      }`,
    );
    report.check(
      "runtime.network",
      "无失败请求",
      page.failedRequests.length === 0,
      `failed=${page.failedRequests.length}${page.failedRequests.length ? `: ${page.failedRequests.join(", ")}` : ""}`,
    );
    const serverErrors = server.requests.filter((entry) => entry.status >= 400);    report.check(
      "runtime.server",
      "静态资源全部 200",
      serverErrors.length === 0,
      `4xx/5xx: ${serverErrors.length}${serverErrors.length ? ` (${serverErrors.map((e) => e.path).join(", ")})` : ""}`,
    );

    // ---------------------------------------------------------------------
    // 组 8：闪卡曝光审计（效果对照页 examples/effects-gallery）
    //   把“过曝 / 过暗”变成可回归的数字：对比同一卡面在加特效前后的
    //   平均亮度偏移（Δ）与高光/暗部削波比例。
    // ---------------------------------------------------------------------
    const exposure = [];
    const galleryFile = join(ROOT, "examples", "effects-gallery", "index.html");
    const libIife = join(ROOT, "dist", "bank-card-showcase.iife.js");
    if (!existsSync(galleryFile) || !existsSync(libIife)) {
      report.check(
        "exposure.audit",
        "闪卡曝光审计（平均亮度偏移 + 高光削波）",
        "skip",
        "缺少 examples/effects-gallery 或 dist 产物（请先 npm run build）",
      );
    } else {
      const rootServer = await startStaticServer(ROOT);
      try {
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(`${rootServer.origin}/examples/effects-gallery/index.html`);
        await page.waitFor("document.querySelector('#faces .item .bc-card')", { label: "对照页卡片渲染" });
        await page.waitFor("document.querySelector('.reference img').complete", { label: "原图基线加载" });
        await page.evaluate(galleryHelpers);
        await sleep(500);
        const baselines = await page.evaluate("window.__bcBaselines()");
        const faces = await page.evaluate("window.__bcFaces()");
        report.note(
          `曝光基线（原图平均亮度）：${Object.entries(baselines)
            .map(([key, value]) => `${key}=${value.mean}`)
            .join(", ")}`,
        );

        for (const face of faces) {
          for (const item of face.effects) {
            const point = await page.evaluate(`window.__bcItemBox(${item.index})`);
            if (!point) continue;
            await page.moveMouse(point.x, point.y);
            await waitForGlareSettled(page);
            await sleep(140);
            const box = await page.evaluate(`window.__bcItemBox(${item.index}).pageBox`);
            const stats = pngStats(await page.captureClip(box));
            const baselineKey = item.effect === "silver" && face.silverImage ? face.silverImage : face.faceImage;
            const baseline = baselines[baselineKey];
            const delta = Number((stats.mean - baseline.mean).toFixed(1));
            exposure.push({
              face: face.faceImage,
              effect: item.effect,
              baseline: baselineKey,
              mean: stats.mean,
              delta,
              blown: stats.blown,
              crushed: stats.crushed,
            });
            report.check(
              `exposure.${face.faceImage.replace(".webp", "")}.${item.effect}`,
              `${face.faceImage} · ${item.effect} 曝光正常（|Δ| ≤ 12、削波 ≤ 3%）`,
              Math.abs(delta) <= 12 && stats.blown <= 3 && stats.crushed <= 3,
              `平均亮度 ${stats.mean}（基线 ${baseline.mean}，Δ ${delta > 0 ? "+" : ""}${delta}）· 高光削波 ${stats.blown}% · 暗部压死 ${stats.crushed}%`,
            );
          }
        }
        report.screenshots.push(await page.screenshot("effects-gallery.png"));
      } finally {
        await rootServer.close();
      }
    }
    report.check(
      "runtime.afterGallery",
      "对照页运行期间无 console 错误 / 未捕获异常",
      page.consoleErrors.length === 0 && page.pageErrors.length === 0,
      `console=${page.consoleErrors.length}, pageErrors=${page.pageErrors.length}`,
    );

    // ---------------------------------------------------------------------
    // 组 9：开发服务器（npm run dev）可用性
    //   回归背景：`publicDir: false` 曾同时作用于 dev 与 build，
    //   导致 `npm run dev` 下 /cards/* 全部回落成 index.html（页面无卡面图）。
    // ---------------------------------------------------------------------
    const devPort = 5300 + Math.floor(Math.random() * 200);
    const devOrigin = `http://127.0.0.1:${devPort}`;
    const viteBin = join(ROOT, "node_modules", "vite", "bin", "vite.js");
    if (!existsSync(viteBin)) {
      report.check("dev.assets", "开发服务器能提供卡面图片", "skip", "未找到 node_modules/vite");
    } else {
      const devServer = spawn(process.execPath, [viteBin, "--port", String(devPort), "--strictPort"], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        const devDeadline = Date.now() + 25000;
        let devReady = false;
        while (Date.now() < devDeadline && !devReady) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(400);
          try {
            // eslint-disable-next-line no-await-in-loop
            const probe = await fetch(`${devOrigin}/`, { signal: AbortSignal.timeout(2000) });
            devReady = probe.ok;
          } catch {
            devReady = false;
          }
        }
        if (!devReady) {
          report.check("dev.assets", "开发服务器能提供卡面图片", false, `dev server 未就绪（${devOrigin}）`);
        } else {
          const asset = await fetch(`${devOrigin}/cards/panda-card.webp`);
          const assetType = asset.headers.get("content-type") ?? "";
          const assetBytes = (await asset.arrayBuffer()).byteLength;
          report.check(
            "dev.assets",
            "npm run dev 下 /cards/* 返回真实图片（不退化为 index.html）",
            asset.status === 200 && assetType.includes("image/webp") && assetBytes > 10000,
            `/cards/panda-card.webp → ${asset.status} ${assetType} ${assetBytes}B`,
          );

          // 在浏览器里真实加载 dev 页面并切到商品 B，确认卡面图真的解码出来
          await page.setViewport({ width: 1280, height: 900 });
          await page.goto(`${devOrigin}/`);
          await page.waitFor("document.querySelector('.bc-card')", { label: "dev 页面卡片" });
          await page.evaluate(probeHelpers);
          await sleep(500);
          const pandaButton = await page.evaluate(`window.__bcButton("Sad Panda 熊猫卡")`);
          if (pandaButton) {
            await page.clickAt(pandaButton.x, pandaButton.y);
            await sleep(700);
          }
          const devState = await page.evaluate("window.__bcProbe()");
          report.check(
            "dev.cardImage",
            "dev 模式下商品 B 的熊猫卡面已解码挂载",
            (devState.imgSrc ?? "").includes("panda-card.webp") &&
              devState.imgNatural?.complete === true &&
              devState.imgNatural.w === 1015 &&
              devState.imgNatural.h === 640,
            `img.src=${(devState.imgSrc ?? "").split("/").pop()}, 解码=${
              devState.imgNatural?.w ?? 0
            }×${devState.imgNatural?.h ?? 0}, complete=${devState.imgNatural?.complete}`,
          );
          report.screenshots.push(await page.screenshot("dev-server-demo.png"));
        }
      } finally {
        devServer.kill();
        await sleep(300);
      }
    }

    // 库产物不得包含图片（避免库使用者把示例素材一起发上去）
    const libDistFiles = await listFiles(join(ROOT, "dist"));
    const libDistImages = libDistFiles.filter((file) => /\.(png|jpe?g|webp|gif|avif)$/i.test(file));
    report.check(
      "build.libDistClean",
      "库产物 dist/ 不含图片（copyPublicDir: false 生效）",
      libDistImages.length === 0,
      `dist/ 共 ${libDistFiles.length} 个文件，图片 ${libDistImages.length} 个`,
    );

    // ---------------------------------------------------------------------
    // 报告
    // ---------------------------------------------------------------------
    const summary = {
      generatedAt: new Date().toISOString(),
      chrome: chromePath,
      url,
      passed: report.passed.length,
      failed: report.failed.length,
      skipped: report.checks.filter((c) => c.skipped).length,
      checks: report.checks,
      notes: report.notes,
      screenshots: report.screenshots,
      measurements: { layout, interaction: { tilt7: tiltMax, tilt14: tilt14Max }, exposure },
      // 代码 / 产物指纹：用 `node tools/acceptance.mjs --check-baseline <本报告>` 可验证
      // “当前代码与产物是否就是被验收的那份”。
      manifest: fingerprint.manifest,
      manifestDigest: fingerprint.manifestDigest,
    };
    await writeFile(join(args.out, "acceptance-report.json"), JSON.stringify(summary, null, 2), "utf8");

    console.log("");
    console.log(`总计 ${report.checks.length} 项：通过 ${report.passed.length}，失败 ${report.failed.length}，跳过 ${summary.skipped}`);
    console.log(`报告: ${join(args.out, "acceptance-report.json")}`);
    console.log(`截图: ${args.out}`);

    if (report.failed.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`\n\u001b[31m验收脚本异常中断\u001b[0m: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  } finally {
    if (!args.keepOpen) {
      cdp.close();
      child.kill();
      await server.close();
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

await main();
