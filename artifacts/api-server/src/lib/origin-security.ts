import type { CorsOptionsDelegate } from "cors";
import type { Request, RequestHandler } from "express";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const csrfHeader = "x-study-csrf";

function parseOrigin(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function parseConfiguredOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of value?.split(",") ?? []) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const parsed = parseOrigin(trimmed);
    if (!parsed) {
      throw new Error(
        "STUDY_TRUSTED_ORIGINS must contain only comma-separated HTTP(S) origins without paths.",
      );
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function requestOrigin(req: Request): string | undefined {
  const rawProtocol =
    req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const protocol = rawProtocol.toLowerCase().replace(/:$/, "");
  const host =
    req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  if (!host || (protocol !== "http" && protocol !== "https")) return undefined;

  const parsed = parseOrigin(`${protocol}://${host}`);
  return parsed?.origin;
}

function refererOrigin(referer: string): string | undefined {
  try {
    const parsed = new URL(referer);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function createOriginProtection(
  configuredOrigins = process.env.STUDY_TRUSTED_ORIGINS,
): {
  corsOptions: CorsOptionsDelegate<Request>;
  requireSafeMutationOrigin: RequestHandler;
  isTrustedOrigin: (req: Request, origin: string) => boolean;
} {
  const trustedOrigins = parseConfiguredOrigins(configuredOrigins);

  const isTrustedOrigin = (req: Request, origin: string): boolean => {
    const parsed = parseOrigin(origin);
    if (!parsed) return false;
    return (
      parsed.origin === requestOrigin(req) ||
      trustedOrigins.has(parsed.origin)
    );
  };

  const corsOptions: CorsOptionsDelegate<Request> = (req, callback) => {
    const origin = req.get("origin");
    callback(null, {
      origin: origin && isTrustedOrigin(req, origin) ? origin : false,
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Study-CSRF"],
      maxAge: 600,
    });
  };

  const requireSafeMutationOrigin: RequestHandler = (req, res, next) => {
    if (
      !stateChangingMethods.has(req.method.toUpperCase()) ||
      req.path.startsWith("/__clerk/")
    ) {
      next();
      return;
    }

    const originHeader = req.get("origin");
    const refererHeader = req.get("referer");
    const origin = originHeader
      ? originHeader
      : refererHeader
        ? refererOrigin(refererHeader)
        : undefined;

    if (!origin || !isTrustedOrigin(req, origin)) {
      res.status(403).json({ error: "This request origin is not allowed." });
      return;
    }

    if (req.get(csrfHeader) !== "1") {
      res.status(403).json({ error: "Request verification is required." });
      return;
    }

    next();
  };

  return { corsOptions, requireSafeMutationOrigin, isTrustedOrigin };
}
