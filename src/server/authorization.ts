import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function createAuthorization(tokens: Record<string, string>) {
  const owners = Object.entries(tokens).map(([id, token]) => ({ id, digest: createHash("sha256").update(token).digest() }));
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || "";
    const match = /^Bearer ([^\s]{1,256})$/.exec(header);
    const digest = createHash("sha256").update(match?.[1] || "").digest();
    // Compare all fixed-size digests; never log credentials or use caller-supplied owner IDs.
    let owner: string | undefined;
    for (const candidate of owners) {
      if (timingSafeEqual(candidate.digest, digest) && match) owner = candidate.id;
    }
    if (!owner) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "A valid backend access token is required." });
      return;
    }
    res.locals.ownerId = owner;
    next();
  };
}
