import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "path";
import type { Plugin } from "vite";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// Inside Replit the dev server sits behind Replit's proxy, whose hostnames vary
// (*.replit.dev, *.repl.co, ...) and cannot be listed up front, so it has to accept
// any Host and bind every interface. Anywhere else keep Vite's defaults: loopback
// only, and only localhost-style Host headers, which is what stops a hostile web
// page from DNS-rebinding onto the dev server and reading source through it.
const inReplit = process.env.REPL_ID !== undefined;
const devHost = inReplit ? "0.0.0.0" : "127.0.0.1";
const devAllowedHosts = inReplit ? true : undefined;

// Tesseract.js fetches its worker script, WebAssembly core and language data from
// jsDelivr unless told otherwise. Serving them from this origin keeps the page's
// Content-Security-Policy at 'self' for scripts and connections, and keeps OCR
// working when a third-party CDN is down or blocked. Files keep fixed names under
// `ocr/` because tesseract.js builds `<langPath>/<lang>.traineddata.gz` itself.
const OCR_ASSETS: Record<string, string> = {
  "ocr/worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  // Only the LSTM cores are ever requested (createWorker's default OEM); the SIMD
  // build is picked at runtime when the browser supports it.
  "ocr/core/tesseract-core-simd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "ocr/core/tesseract-core-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  "ocr/lang/eng.traineddata.gz": "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
};

function selfHostedOcrAssets(): Plugin {
  const root = path.resolve(import.meta.dirname);
  const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return {
    name: "self-hosted-ocr-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0];
        const rel = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, "");
        const file = Object.hasOwn(OCR_ASSETS, rel) ? OCR_ASSETS[rel] : undefined;
        if (!file) return next();
        res.setHeader("Content-Type", rel.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        fs.createReadStream(path.resolve(root, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(OCR_ASSETS)) {
        this.emitFile({ type: "asset", fileName, source: fs.readFileSync(path.resolve(root, file)) });
      }
    },
  };
}

// index.html carries the production Content-Security-Policy as a <meta> tag. The dev
// server cannot run under it: Vite's React refresh preamble is an inline script and
// HMR needs a WebSocket. So the tag is removed when serving, and only `vite build`
// and `vite preview` output carries it.
function cspOnlyInBuild(): Plugin {
  return {
    name: "csp-only-in-build",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/i, "");
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    cspOnlyInBuild(),
    selfHostedOcrAssets(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: devHost,
    allowedHosts: devAllowedHosts,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: devHost,
    allowedHosts: devAllowedHosts,
  },
});
