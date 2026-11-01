import assert from "node:assert/strict";
import test from "node:test";
import { createOriginProtection } from "./origin-security.ts";

function makeRequest({
  method = "POST",
  path = "/auth/onboarding",
  host = "study.example",
  protocol = "https",
  headers = {},
} = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    method,
    path,
    protocol,
    headers: normalizedHeaders,
    get(name) {
      return normalizedHeaders[name.toLowerCase()];
    },
  };
}

function runMiddleware(middleware, req) {
  const result = { status: undefined, body: undefined, nextCalled: false };
  const res = {
    status(status) {
      result.status = status;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  middleware(req, res, () => {
    result.nextCalled = true;
  });
  return result;
}

test("allows the exact same-origin browser request with the CSRF header", () => {
  const protection = createOriginProtection("");
  const req = makeRequest({
    headers: {
      host: "study.example",
      origin: "https://study.example",
      "x-study-csrf": "1",
    },
  });

  assert.equal(protection.isTrustedOrigin(req, "https://study.example"), true);
  assert.deepEqual(
    runMiddleware(protection.requireSafeMutationOrigin, req),
    { status: undefined, body: undefined, nextCalled: true },
  );
});

test("uses the forwarded public host and protocol for same-origin checks", () => {
  const protection = createOriginProtection("");
  const req = makeRequest({
    host: "internal-api:8080",
    headers: {
      host: "internal-api:8080",
      "x-forwarded-host": "study.example",
      "x-forwarded-proto": "https",
      origin: "https://study.example",
      "x-study-csrf": "1",
    },
  });

  assert.equal(protection.isTrustedOrigin(req, "https://study.example"), true);
});

test("allows only explicitly configured cross-origin application origins", () => {
  const protection = createOriginProtection("https://frontend.example");
  const req = makeRequest({
    headers: {
      host: "study.example",
      origin: "https://frontend.example",
      "x-study-csrf": "1",
    },
  });

  assert.equal(protection.isTrustedOrigin(req, "https://frontend.example"), true);
  assert.equal(protection.isTrustedOrigin(req, "https://other.example"), false);
  assert.equal(
    runMiddleware(protection.requireSafeMutationOrigin, req).nextCalled,
    true,
  );
});

test("rejects cross-origin mutations even when the marker header is present", () => {
  const protection = createOriginProtection("");
  const req = makeRequest({
    headers: {
      host: "study.example",
      origin: "https://attacker.example",
      "x-study-csrf": "1",
    },
  });

  assert.deepEqual(
    runMiddleware(protection.requireSafeMutationOrigin, req),
    {
      status: 403,
      body: { error: "This request origin is not allowed." },
      nextCalled: false,
    },
  );
});

test("rejects same-origin mutations without the required custom header", () => {
  const protection = createOriginProtection("");
  const req = makeRequest({
    headers: {
      host: "study.example",
      origin: "https://study.example",
    },
  });

  assert.deepEqual(
    runMiddleware(protection.requireSafeMutationOrigin, req),
    {
      status: 403,
      body: { error: "Request verification is required." },
      nextCalled: false,
    },
  );
});

test("allows a configured origin through CORS and denies an untrusted one", async () => {
  const protection = createOriginProtection("https://frontend.example");
  const getCorsOptions = (req) =>
    new Promise((resolve, reject) => {
      protection.corsOptions(req, (error, options) =>
        error ? reject(error) : resolve(options),
      );
    });

  const trusted = await getCorsOptions(
    makeRequest({
      headers: { host: "study.example", origin: "https://frontend.example" },
    }),
  );
  const untrusted = await getCorsOptions(
    makeRequest({
      headers: { host: "study.example", origin: "https://attacker.example" },
    }),
  );

  assert.equal(trusted.origin, "https://frontend.example");
  assert.equal(trusted.credentials, true);
  assert.equal(untrusted.origin, false);
});

test("rejects malformed trusted-origin configuration at startup", () => {
  assert.throws(
    () => createOriginProtection("https://frontend.example/path"),
    /STUDY_TRUSTED_ORIGINS/,
  );
});
