import express from "express";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { createJob, getJob, subscribe } from "./jobs.js";
import { UploadedAudio } from "./types.js";
import { ensureDir, formatFromFilename, sanitizeFilename, toPublicJob } from "./utils.js";

const app = express();
await ensureDir(config.tempRoot);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const metaTuneDir = path.join(projectRoot, "metatune");
const localPython = path.join(projectRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const pythonCommand = process.env.METATUNE_PYTHON || (fs.existsSync(localPython) ? localPython : process.platform === "win32" ? "python" : "python3");
let metaTuneProcess: ChildProcess | undefined;

async function startMetaTune() {
  metaTuneProcess = spawn(pythonCommand, [
    "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(config.metaTunePort)
  ], { cwd: metaTuneDir, stdio: "inherit" });

  metaTuneProcess.on("error", (error) => {
    console.error("Could not start the MetaTune service:", error);
  });
  metaTuneProcess.on("exit", (code, signal) => {
    console.error(`MetaTune service exited (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
  });

  const healthUrl = `http://127.0.0.1:${config.metaTunePort}/health`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (metaTuneProcess.exitCode !== null) {
      throw new Error("MetaTune exited before it became ready. Install metatune/requirements.txt into the configured Python environment.");
    }
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        console.log("MetaTune service is ready.");
        return;
      }
    } catch {
      // The Python service can take a moment to import its dependencies.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("MetaTune did not become ready within 15 seconds.");
}

const metaTuneApiRoutes = new Set([
  "/api/read-metadata", "/api/generate-cover", "/api/proxy-image", "/api/export-zip"
]);

function isMetaTuneRoute(requestPath: string) {
  return requestPath === "/metatune" || requestPath.startsWith("/metatune/")
    || requestPath === "/static" || requestPath.startsWith("/static/")
    || requestPath === "/generate" || requestPath.startsWith("/download/")
    || metaTuneApiRoutes.has(requestPath);
}

function proxyToMetaTune(req: express.Request, res: express.Response) {
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
    if (req.path === "/metatune" || req.path === "/metatune/") {
      const policy = headers["content-security-policy"];
      if (typeof policy === "string") {
        headers["content-security-policy"] = policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
      }
      headers["x-frame-options"] = "SAMEORIGIN";
    }
    res.writeHead(response.statusCode ?? 502, headers);
    response.pipe(res);
  });

  upstream.setTimeout(5 * 60 * 1000, () => upstream.destroy(new Error("MetaTune request timed out.")));
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.status(503).json({ error: "MetaTune is temporarily unavailable." });
    } else {
      res.destroy(error);
    }
  });
  req.pipe(upstream);
}

// Keep Helmet's policy enabled while allowing the inline style attributes used by React.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Rate limit uploads to prevent abuse (20 job requests per 15 minutes per IP)
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads, please try again later." }
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
    fileSize: config.maxFileMb * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const format = formatFromFilename(file.originalname);
    if (!format) cb(new Error(`Unsupported file format: ${path.extname(file.originalname)}`));
    else cb(null, true);
  }
});

app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, services: ["AudioCompress", "MetaTune"] });
});

app.use((req, res, next) => {
  if (!isMetaTuneRoute(req.path)) {
    next();
    return;
  }
  proxyToMetaTune(req, res);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/api/jobs", uploadLimiter, (req, res, next) => {
  upload.array("files", config.maxUploadFiles)(req, res, (err) => {
    if (err) {
      console.error("Upload error:", err);
      // Clean up orphaned upload directory on failure
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

    console.log(`Job request: ${files.length} files, target ${targetMb}MB, force ${force}`);

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
    jobCreated = true;
    console.log(`Created job ${job.id}`);
    res.status(202).json(toPublicJob(job));
  } catch (error) {
    console.error("Job creation error:", error);
    if (!jobCreated) removeFailedUpload(req as UploadRequest);
    res.status(400).json({ error: error instanceof Error ? error.message : "Upload failed." });
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Compression job not found or expired." });
    return;
  }
  res.json(toPublicJob(job));
});

app.get("/api/jobs/:id/events", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  // Keep-alive heartbeat to prevent proxy/load-balancer timeouts
  const keepAlive = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch { /* connection gone */ }
  }, 20_000);

  const unsubscribe = subscribe(job.id, (payload) => {
    try {
      res.write(`data: ${payload}\n\n`);
      // Close SSE when job reaches a terminal state
      const parsed = JSON.parse(payload);
      if (parsed.status === "completed" || parsed.status === "failed") {
        clearInterval(keepAlive);
        res.end();
      }
    } catch { /* connection gone */ }
  });

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

app.get("/api/download/:jobId/zip", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.zipPath || !fs.existsSync(job.zipPath)) {
    res.status(404).json({ error: "ZIP file is not ready." });
    return;
  }
  res.download(job.zipPath, "audiocompress-files.zip");
});

app.get("/api/download/:jobId/:fileId", (req, res) => {
  const job = getJob(req.params.jobId);
  const file = job?.files.find((item) => item.id === req.params.fileId);
  if (!file?.outputPath || !fs.existsSync(file.outputPath)) {
    res.status(404).json({ error: "Compressed file is not ready." });
    return;
  }
  res.download(file.outputPath, file.outputName ?? sanitizeFilename(file.originalName));
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "../client");
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "API endpoint not found." });
      return;
    }
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    return next(error);
  }
  const status = (error as Error & { status?: number }).status ?? 400;
  res.status(status).json({ error: error.message || "Something went wrong." });
});

await startMetaTune();

app.listen(config.port, "0.0.0.0", () => {
  console.log(`AudioCompress listening on ${config.port}`);
});

const stopMetaTune = () => metaTuneProcess?.kill();
process.on("SIGINT", stopMetaTune);
process.on("SIGTERM", stopMetaTune);
