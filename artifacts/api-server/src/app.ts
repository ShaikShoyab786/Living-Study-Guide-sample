import express, {
  type ErrorRequestHandler,
  type Express,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { createOriginProtection } from "./lib/origin-security";
import { REPLIT_TRUSTED_PROXY_HOPS } from "./lib/replit-proxy";

const app: Express = express();
// The Replit preview ingress reaches this server through its local proxy peer
// and supplies three X-Forwarded-For entries. Trust only that observed chain.
app.set("trust proxy", REPLIT_TRUSTED_PROXY_HOPS);
const originProtection = createOriginProtection();
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set to secure guest sessions.");
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors(originProtection.corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb", parameterLimit: 50 }));
const requestBodyLimitHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  next(error);
};
app.use(requestBodyLimitHandler);
app.use(cookieParser(sessionSecret));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", originProtection.requireSafeMutationOrigin);
app.use("/api", router);

export default app;
