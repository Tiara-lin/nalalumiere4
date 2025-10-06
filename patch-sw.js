// scripts/patch-sw.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIST = resolve(__dirname, "../dist");
const CANDIDATES = [
  "firebase-messaging-sw.js",
  "service-worker.js",
  "firebase-app-check-sw.js"
];

const BANNER = "/* ==== HARD BLOCK reCAPTCHA in SW (auto patch) ==== */";
const PATCH = `${BANNER}
(() => {
  const origImportScripts = self.importScripts;
  self.importScripts = function (...urls) {
    const shouldBlock = urls.some(u =>
      /(?:www\\.)?google\\.com\\/recaptcha|gstatic\\.com\\/recaptcha/i.test(String(u))
    );
    if (shouldBlock) {
      try { console.log('[SW] reCAPTCHA import blocked:', urls); } catch (_) {}
      return;
    }
    return origImportScripts.apply(self, urls);
  };
})();
`;

function patchOne(swPath) {
  const abs = resolve(DIST, swPath);
  if (!existsSync(abs)) return false;
  const src = readFileSync(abs, "utf8");
  if (src.includes(BANNER)) {
    console.log(`⚡ Already patched: ${swPath}`);
    return true;
  }
  writeFileSync(abs, PATCH + "\n" + src, "utf8");
  console.log(`✅ Patched: ${swPath}`);
  return true;
}

(function main() {
  let found = false;
  for (const f of CANDIDATES) {
    found = patchOne(f) || found;
  }
  if (!found) {
    console.warn("⚠️ No service worker file found in dist/. Skipped patch.");
  }
})();
