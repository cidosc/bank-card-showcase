#!/usr/bin/env node
/**
 * make-placeholder-assets.mjs
 * ===========================
 * 跨平台包装：调用同目录下的 Python 脚本 make-placeholder-assets.py，
 * 生成 public/cards/ 下的临时占位卡面图（PNG + WebP）。
 *
 * 用法：
 *   npm run assets
 *   # 或
 *   node tools/make-placeholder-assets.mjs
 *
 * 说明：
 *   - 不引入任何 npm 依赖，仅使用 Node 内置模块。
 *   - 依次尝试 python / py -3 / python3，并校验是否已安装 Pillow。
 *   - 找不到 Python 或 Pillow 时打印清晰中文提示，并以退出码 1 结束。
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PY_SCRIPT = join(HERE, "make-placeholder-assets.py");

/** 各平台的解释器候选：[命令, 前置参数] */
const CANDIDATES =
  process.platform === "win32"
    ? [
        ["python", []],
        ["py", ["-3"]],
        ["python3", []],
      ]
    : [
        ["python3", []],
        ["python", []],
      ];

function tryRun(cmd, preArgs, code) {
  // stdio: ignore —— 探测阶段静默；spawnSync 在命令不存在时会返回 error。
  return spawnSync(cmd, [...preArgs, "-c", code], {
    stdio: "ignore",
    windowsHide: true,
  });
}

function commandExists(cmd, preArgs) {
  const r = tryRun(cmd, preArgs, "import sys; sys.exit(0)");
  return !r.error && r.status === 0;
}

function hasPillow(cmd, preArgs) {
  const r = tryRun(cmd, preArgs, "import PIL, PIL.features; sys=__import__('sys'); sys.exit(0 if PIL.features.check('webp') else 2)");
  if (r.error || r.status === null) return { ok: false, reason: "error" };
  if (r.status === 0) return { ok: true };
  // status 2 => 有 Pillow 但不支持 WebP；其它非 0 => 无法导入 Pillow
  if (r.status === 2) return { ok: false, reason: "nowebp" };
  return { ok: false, reason: "nopillow" };
}

function fail(msg) {
  process.stderr.write(
    "\n[错误] " + msg + "\n\n" +
      "请确认本机已安装 Python 3 与 Pillow（需支持 WebP），例如：\n" +
      "  Windows :  py -3 -m pip install --upgrade Pillow\n" +
      "  macOS   :  python3 -m pip install --upgrade Pillow\n" +
      "  Linux   :  python3 -m pip install --upgrade Pillow\n" +
      "\n安装后重新运行：npm run assets\n"
  );
  process.exit(1);
}

if (!existsSync(PY_SCRIPT)) {
  process.stderr.write(`[错误] 未找到 Python 脚本：${PY_SCRIPT}\n`);
  process.exit(1);
}

// 1) 找到可用的 Python 解释器
let chosen = null;
for (const [cmd, preArgs] of CANDIDATES) {
  if (commandExists(cmd, preArgs)) {
    chosen = { cmd, preArgs };
    break;
  }
}

if (!chosen) {
  fail(
    "未找到可用的 Python 3 解释器（已尝试：python、py -3、python3）。\n" +
      "       请安装 Python 3 并确保其可通过上面任一命令在命令行中调用。"
  );
}

// 2) 校验 Pillow 与 WebP 支持
const pillow = hasPillow(chosen.cmd, chosen.preArgs);
if (!pillow.ok) {
  if (pillow.reason === "nowebp") {
    fail("检测到 Pillow，但当前 Pillow 不支持 WebP 编码，无法生成 .webp 文件。");
  } else if (pillow.reason === "nopillow") {
    fail(
      `检测到 Python 解释器「${chosen.cmd}」，但未安装 Pillow 库。\n` +
        `       请执行：${chosen.cmd} ${chosen.preArgs.join(" ")} -m pip install --upgrade Pillow`.trim()
    );
  } else {
    fail(`调用 Python 解释器「${chosen.cmd}」失败。`);
  }
}

// 3) 运行真正的生成脚本
const label = [chosen.cmd, ...chosen.preArgs].join(" ");
process.stdout.write(`[assets] 使用 ${label} 运行 ${PY_SCRIPT}\n`);
const run = spawnSync(chosen.cmd, [...chosen.preArgs, PY_SCRIPT, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
});

if (run.error) {
  process.stderr.write(`[错误] 执行 Python 脚本失败：${run.error.message}\n`);
  process.exit(1);
}

process.exit(run.status === null ? 1 : run.status);
