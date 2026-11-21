import express from "express";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { config as defaultConfig, type ServerConfig } from "./config.js";
import { createJob, getJob, subscribe } from "./jobs.js";
import { UploadedAudio } from "./types.js";
import { ensureDir, formatFromFilename, sanitizeFilename, toPublicJob } from "./utils.js";
import { APP_VERSION } from "../shared/version.js";
import { createAuthorization } from "./authorization.js";
import { ProjectStore, validateProjectIndex } from "./projectStore.js";
import { fetchApprovedImage, ImageFetchError } from "./imageFetch.js";

export async function createApp(overrides: Partial<ServerConfig> & { clientDir?: string } = {}) {
const config = { ...defaultConfig, ...overrides };
const app = express();
await ensureDir(config.tempRoot);
const authorize = createAuthorization(config.apiTokens);
const syncAvailable = Boolean(config.syncStorageDir && Object.keys(config.apiTokens).length);
const projectStore = syncAvailable ? new ProjectStore(config.syncStorageDir) : null;
const jobOwners = new Map<string, string>();

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const metaTuneDir = path.join(projectRoot, "metatune");
const localPython = path.join(projectRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const pythonCommand = process.env.METATUNE_PYTHON || (fs.existsSync(localPython) ? localPython : process.platform === "win32" ? "python" : "python3");
let metaTuneProcess: ChildProcess | undefined;
let isMetaTuneRunning = false;

async function startMetaTune() {
  try {
    metaTuneProcess = spawn(pythonCommand, [
      "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(config.metaTunePort)
    ], { cwd: metaTuneDir, stdio: "ignore", windowsHide: true });

    metaTuneProcess.on("error", (error) => {
      console.warn("MetaTune service could not be spawned:", error.message);
    });
    metaTuneProcess.on("exit", (code, signal) => {
      isMetaTuneRunning = false;
      console.log(`MetaTune service stopped (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
    });

    const healthUrl = `http://127.0.0.1:${config.metaTunePort}/health`;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (metaTuneProcess.exitCode !== null) break;
      try {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          isMetaTuneRunning = true;
          console.log("MetaTune backend service is ready.");
          return;
        }
      } catch {
        // waiting for python service
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (err: unknown) {
    console.warn("MetaTune service initialization skipped:", err instanceof Error ? err.message : String(err));
  }
}

const metaTuneApiRoutes = new Set([
  "/api/read-metadata", "/api/export-zip"
]);

function isMetaTuneRoute(requestPath: string) {
  return requestPath.startsWith("/metatune/")
    || requestPath === "/static" || requestPath.startsWith("/static/")
    || requestPath === "/generate" || requestPath.startsWith("/download/")
    || metaTuneApiRoutes.has(requestPath);
}

function proxyToMetaTune(req: express.Request, res: express.Response) {
  if (!isMetaTuneRunning) {
    res.status(503).json({ error: "MetaTune service is operating in local device mode." });
    return;
  }

  let targetPath = req.originalUrl;
  if (req.path === "/metatune" || req.path.startsWith("/metatune/")) {
    targetPath = targetPath.replace(/^\/metatune(?=\/|\?|$)/, "") || "/";
    if (targetPath.startsWith("?")) targetPath = `/${targetPath}`;
  }

  const upstream = http.request({
    hostname: "127.0.0.1",
    port: config.metaTunePort,
    method: req.method,
    path: targetPath,
    headers: {
      ...req.headers,
      host: req.headers.host ?? `127.0.0.1:${config.metaTunePort}`,
      "x-forwarded-host": req.headers["x-forwarded-host"] ?? req.headers.host,
      "x-forwarded-proto": req.headers["x-forwarded-proto"] ?? req.protocol
    }
  }, (response) => {
    const headers = { ...response.headers };
    delete headers.connection;
    res.writeHead(response.statusCode ?? 502, headers);
    response.pipe(res);
  });

  let received = 0;
  req.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > config.maxRequestMb * 1024 * 1024) upstream.destroy(new Error("Upload exceeds the request size limit."));
  });
  req.on("aborted", () => upstream.destroy());
  upstream.setTimeout(30_000, () => upstream.destroy(new Error("MetaTune request timed out.")));
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.status(503).json({ error: "MetaTune service is temporarily unavailable." });
    } else {
      res.destroy(error);
    }
  });
  req.pipe(upstream);
}

app.use(cors((req, callback) => callback(null, {
  origin: (origin, done) => {
    if (!origin || config.allowedOrigins.includes(origin) || origin === `${req.protocol}://${req.headers.host}`) done(null, true);
    else done(Object.assign(new Error("Origin is not allowed."), { status: 403 }));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
})));

app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:"], mediaSrc: ["'self'", "blob:"], workerSrc: ["'self'", "blob:"],
    connectSrc: ["'self'", ...config.allowedOrigins, "https://image.pollinations.ai", "https://gen.pollinations.ai"],
    objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
  } },
  crossOriginEmbedderPolicy: false
}));

app.use((req, res, next) => {
  if (Number(req.headers["content-length"]) > config.maxRequestMb * 1024 * 1024) {
    res.status(413).json({ error: `The total upload limit is ${config.maxRequestMb} MB.` });
    return;
  }
  next();
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit reached. Please try again later." }
});

type UploadRequest = express.Request & { audioCompressUploadDir?: string };

function removeFailedUpload(req: UploadRequest) {
  const uploadDir = req.audioCompressUploadDir;
  if (!uploadDir) return;
  void fs.promises.rm(path.dirname(uploadDir), { recursive: true, force: true }).catch((error) => {
    console.error("Could not clean up failed upload:", error);
  });
}

const storage = multer.diskStorage({
  destination: (req: UploadRequest, _file, cb) => {
    try {
      if (!req.audioCompressUploadDir) {
        const jobId = nanoid(12);
        req.audioCompressUploadDir = path.join(config.tempRoot, jobId, "uploads");
        fs.mkdirSync(req.audioCompressUploadDir, { recursive: true });
      }
      cb(null, req.audioCompressUploadDir);
    } catch (error) {
      cb(error as Error, "");
    }
  },
  filename: (_req, file, cb) => {
    cb(null, `${nanoid(10)}-${sanitizeFilename(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: {
    files: config.maxUploadFiles,
    fileSize: config.maxFileMb * 1024 * 1024,
    fields: 5,
    fieldSize: 1024,
    parts: config.maxUploadFiles + 5
  },
  fileFilter: (_req, file, cb) => {
    const format = formatFromFilename(file.originalname);
    if (!format) cb(new Error(`Unsupported file format: ${path.extname(file.originalname)}`));
    else cb(null, true);
  }
});

app.disable("x-powered-by");

// Health Check
app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    version: APP_VERSION,
    service: "Audio Studio Lightweight Coordinator",
    mode: "device-first",
    metaTuneRunning: isMetaTuneRunning,
    syncAvailable,
    coverGenerationAvailable: Boolean(config.pollinationsApiKey && Object.keys(config.apiTokens).length)
  });
});

// App Configuration endpoint
app.get("/api/config", (_req, res) => {
  res.json({
    appName: "Audio Studio",
    version: APP_VERSION,
    processingArchitecture: "device-powered",
    maxUploadFiles: config.maxUploadFiles,
    maxFileMb: config.maxFileMb,
    services: {
      cloudSync: syncAvailable,
      coverGeneration: Boolean(config.pollinationsApiKey && Object.keys(config.apiTokens).length),
      metaTune: isMetaTuneRunning
    }
  });
});

app.use("/api/cloud", (_req, res, next) => {
  if (!projectStore) { res.status(501).json({ error: "Library index sync requires API_TOKENS and a persistent SYNC_STORAGE_DIR." }); return; }
  next();
}, authorize);

app.post("/api/cloud/sync", uploadLimiter, express.json({ limit: "1mb" }), async (req, res) => {
  let tracks;
  try { tracks = validateProjectIndex(req.body); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid library index." }); return; }
  try {
    const index = await projectStore!.save(res.locals.ownerId as string, tracks);
    res.json({ success: true, syncedAt: index.syncedAt, trackCount: index.trackCount });
  } catch { res.status(500).json({ error: "The library index could not be saved." }); }
});

app.get("/api/cloud/projects", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(await projectStore!.load(res.locals.ownerId as string)); }
  catch { res.status(500).json({ error: "The saved library index could not be read." }); }
});

// AI Cover Art Proxy
app.post("/api/generate-cover", (_req, res, next) => {
  if (!config.pollinationsApiKey || !Object.keys(config.apiTokens).length) {
    res.status(501).json({ error: "AI artwork requires a configured provider key and backend access token. The local cover designer works offline." }); return;
  }
  next();
}, authorize, rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false }), express.json({ limit: "8kb" }), async (req, res) => {
  try {
    const { prompt, style = "cinematic", mood = "vibrant" } = req.body;
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 1000 || typeof style !== "string" || style.length > 80 || typeof mood !== "string" || mood.length > 80) {
      res.status(400).json({ error: "Supply an artwork description of 1–1,000 characters." }); return;
    }
    const fullPrompt = `${prompt}, ${style} style, ${mood} mood, album cover`;
    const seed = Math.floor(Math.random() * 100000);
    const imageUrl = `https://gen.pollinations.ai/image/${encodeURIComponent(fullPrompt)}?model=flux&width=1024&height=1024&seed=${seed}`;
    const image = await fetchApprovedImage(imageUrl, ["gen.pollinations.ai"], { timeoutMs: 60_000, authorization: `Bearer ${config.pollinationsApiKey}` });
    res.type(image.contentType).set("Cache-Control", "no-store").send(image.buffer);
  } catch (error) {
    res.status(error instanceof ImageFetchError ? error.status : 502).json({ error: error instanceof ImageFetchError ? error.message : "Artwork generation failed." });
  }
});

app.get("/api/proxy-image", uploadLimiter, async (req, res) => {
  try {
    const url = req.query.url;
    if (typeof url !== "string" || url.length > 4000) {
      res.status(400).json({ error: "Missing image url." });
      return;
    }
    const image = await fetchApprovedImage(url, config.imageHosts);
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(image.buffer);
  } catch (error) {
    res.status(error instanceof ImageFetchError ? error.status : 502).json({ error: error instanceof ImageFetchError ? error.message : "Could not download artwork." });
  }
});

// MetaTune routes proxy
app.use((req, res, next) => {
  if (!isMetaTuneRoute(req.path)) {
    next();
    return;
  }
  proxyToMetaTune(req, res);
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "8kb" }));

const authorizeJobs: express.RequestHandler = (req, res, next) => {
  if (Object.keys(config.apiTokens).length) { authorize(req, res, next); return; }
  if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "")) {
    res.locals.ownerId = "local"; next(); return;
  }
  res.status(503).json({ error: "Remote server processing requires a configured backend access token." });
};
app.use(["/api/jobs", "/api/download"], authorizeJobs);

app.use("/api/jobs", (req, res, next) => {
  if (req.method === "POST" && req.headers["transfer-encoding"]) {
    res.status(411).json({ error: "A bounded Content-Length is required for batch uploads." }); return;
  }
  next();
});

// Optional Cloud Server Compression API (retained for backward compatibility / explicit cloud requests)
app.post("/api/jobs", uploadLimiter, (req, res, next) => {
  upload.array("files", config.maxUploadFiles)(req, res, (err) => {
    if (err) {
      console.error("Upload error:", err);
      removeFailedUpload(req as UploadRequest);
      return next(err);
    }
    next();
  });
}, async (req, res) => {
  let jobCreated = false;
  try {
    const files = (req.files ?? []) as Express.Multer.File[];
    const targetMb = Number(req.body.targetMb ?? 60);
    const force = req.body.force === "true";

    if (!Number.isFinite(targetMb) || targetMb <= 0 || targetMb > 1000) {
      removeFailedUpload(req as UploadRequest);
      res.status(400).json({ error: "Choose a target size between 1 MB and 1000 MB." });
      return;
    }
    if (files.length === 0) {
      removeFailedUpload(req as UploadRequest);
      res.status(400).json({ error: "Upload at least one MP3 or M4A file." });
      return;
    }

    const firstDir = path.dirname(files[0].path);
    const rootDir = path.dirname(firstDir);
    const outputDir = path.join(rootDir, "outputs");
    await ensureDir(outputDir);

    const uploaded: UploadedAudio[] = files.map((file) => {
      const format = formatFromFilename(file.originalname);
      if (!format) throw new Error("Only MP3 and M4A files are supported.");
      return {
        id: nanoid(10),
        originalName: file.originalname,
        safeName: sanitizeFilename(file.originalname),
        format,
        size: file.size,
        inputPath: file.path
      };
    });

    const job = createJob(uploaded, targetMb, force, { uploadDir: firstDir, outputDir });
    for (const id of jobOwners.keys()) if (!getJob(id)) jobOwners.delete(id);
    jobOwners.set(job.id, res.locals.ownerId as string);
    jobCreated = true;
    res.status(202).json(toPublicJob(job));
  } catch (error) {
    console.error("Job creation error:", error);
    if (!jobCreated) removeFailedUpload(req as UploadRequest);
    res.status((error as Error & { status?: number }).status || 400).json({ error: error instanceof Error ? error.message : "Upload failed." });
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job || jobOwners.get(job.id) !== res.locals.ownerId) {
    res.status(404).json({ error: "Compression job not found or expired." });
    return;
  }
  res.json(toPublicJob(job));
});

app.get("/api/jobs/:id/events", (req, res) => {
  const job = getJob(req.params.id);
  if (!job || jobOwners.get(job.id) !== res.locals.ownerId) {
    res.status(404).end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const keepAlive = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch { /* closed */ }
  }, 20_000);

  let unsubscribe = () => {};
  unsubscribe = subscribe(job.id, (payload) => {
    try {
      res.write(`data: ${payload}\n\n`);
      const parsed = JSON.parse(payload);
      if (parsed.status === "completed" || parsed.status === "failed") {
        clearInterval(keepAlive);
        res.end();
        queueMicrotask(() => unsubscribe());
      }
    } catch { /* closed */ }
  });

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

app.get("/api/download/:jobId/zip", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.zipPath || jobOwners.get(job.id) !== res.locals.ownerId || !fs.existsSync(job.zipPath)) {
    res.status(404).json({ error: "ZIP file is not ready." });
    return;
  }
  res.download(job.zipPath, "audiocompress-files.zip");
});

app.get("/api/download/:jobId/:fileId", (req, res) => {
  const job = getJob(req.params.jobId);
  const file = job?.files.find((item) => item.id === req.params.fileId);
  if (!file?.outputPath || !job || jobOwners.get(job.id) !== res.locals.ownerId || !fs.existsSync(file.outputPath)) {
    res.status(404).json({ error: "Compressed file is not ready." });
    return;
  }
  res.download(file.outputPath, file.outputName ?? sanitizeFilename(file.originalName));
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = overrides.clientDir || path.resolve(__dirname, "../../dist/client");
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/") || path.extname(req.path) || req.path.startsWith("/assets/")) {
      res.status(404).json({ error: "Resource not found." });
      return;
    }
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.use((_req, res) => res.status(404).json({ error: "Resource not found." }));

app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    return next(error);
  }
  const status = error instanceof multer.MulterError ? (error.code === "LIMIT_FILE_SIZE" ? 413 : 400) : (error as Error & { status?: number }).status ?? 400;
  res.status(status).json({ error: status >= 500 ? "The request could not be completed." : error.message || "Invalid request." });
});

if (config.enableMetaTune) await startMetaTune();
return { app, close: () => { metaTuneProcess?.kill(); } };
}
