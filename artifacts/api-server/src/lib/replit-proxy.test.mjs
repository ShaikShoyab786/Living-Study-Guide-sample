import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import rateLimit from "express-rate-limit";
import { once } from "node:events";
import { REPLIT_TRUSTED_PROXY_HOPS } from "./replit-proxy.ts";

const ingressAddresses = {
  intermediate: "10.60.45.4",
  localProxy: "127.0.0.1",
};

async function withGuestLimitServer(callback) {
  const app = express();
  app.set("trust proxy", REPLIT_TRUSTED_PROXY_HOPS);

  // Model the observed Replit ingress: discard the caller's forwarding header
  // and set the client address followed by the two forwarded proxy addresses
  // observed in the preview.
  app.use((req, _res, next) => {
    const clientAddress = req.get("x-test-client-address");
    if (clientAddress) {
      req.headers["x-forwarded-for"] = [
        clientAddress,
        ingressAddresses.intermediate,
        ingressAddresses.localProxy,
      ].join(", ");
    }
    next();
  });

  app.post(
    "/guest",
    rateLimit({
      windowMs: 60_000,
      limit: 2,
      standardHeaders: false,
      legacyHeaders: false,
    }),
    (_req, res) => res.sendStatus(201),
  );

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function startGuest(baseUrl, clientAddress, forwardedFor) {
  return fetch(`${baseUrl}/guest`, {
    method: "POST",
    headers: {
      "x-test-client-address": clientAddress,
      "x-forwarded-for": forwardedFor,
    },
  });
}

test("guest-start quotas are independent for distinct Replit clients", async () => {
  await withGuestLimitServer(async (baseUrl) => {
    assert.equal((await startGuest(baseUrl, "198.51.100.10")).status, 201);
    assert.equal((await startGuest(baseUrl, "198.51.100.10")).status, 201);
    assert.equal((await startGuest(baseUrl, "198.51.100.10")).status, 429);

    assert.equal((await startGuest(baseUrl, "198.51.100.20")).status, 201);
    assert.equal((await startGuest(baseUrl, "198.51.100.20")).status, 201);
    assert.equal((await startGuest(baseUrl, "198.51.100.20")).status, 429);
  });
});

test("forged forwarding headers cannot escape the client's guest quota", async () => {
  await withGuestLimitServer(async (baseUrl) => {
    assert.equal((await startGuest(baseUrl, "198.51.100.10")).status, 201);
    assert.equal((await startGuest(baseUrl, "198.51.100.10")).status, 201);
    assert.equal(
      (
        await startGuest(
          baseUrl,
          "198.51.100.10",
          "203.0.113.99, 203.0.113.100",
        )
      ).status,
      429,
    );
  });
});
