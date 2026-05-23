import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TG_TOKEN ??= "test-token-1234567890";
process.env.WEBHOOK ??= "http://localhost:9999";
process.env.DB_PATH ??= ":memory:";
process.env.NODE_ENV ??= "test";

let nock;
let setMyCommands;
let COMMANDS;

before(async () => {
  nock = (await import("nock")).default;
  nock.disableNetConnect();
  nock.enableNetConnect("127.0.0.1");

  ({ setMyCommands } = await import("../src/api.js"));
  ({ COMMANDS } = await import("../src/telegram.js"));
});

after(() => {
  if (nock) {
    nock.cleanAll();
    nock.enableNetConnect();
  }
});

// --- shape / static validation of the COMMANDS export ---------------------

test("COMMANDS exports an array including all routed slash commands", () => {
  assert.ok(Array.isArray(COMMANDS), "COMMANDS must be an array");
  assert.ok(COMMANDS.length > 0, "COMMANDS must not be empty");

  const names = COMMANDS.map((c) => c.command);
  for (const required of [
    "start",
    "help",
    "current",
    "alert",
    "alerts",
    "deletealert",
    "deletechange",
  ]) {
    assert.ok(
      names.includes(required),
      `COMMANDS missing routed command "${required}" (got: ${names.join(",")})`
    );
  }
});

test("COMMANDS entries pass Telegram's setMyCommands validation rules", () => {
  // Per Telegram BotCommand spec:
  //   command:     1-32 chars, [a-z0-9_], must be lowercase
  //   description: 3-256 chars
  // https://core.telegram.org/bots/api#botcommand
  const cmdRe = /^[a-z0-9_]{1,32}$/;
  const seen = new Set();
  for (const entry of COMMANDS) {
    assert.equal(typeof entry, "object", `entry must be an object: ${JSON.stringify(entry)}`);
    assert.equal(typeof entry.command, "string", `command must be a string in ${JSON.stringify(entry)}`);
    assert.equal(
      typeof entry.description,
      "string",
      `description must be a string in ${JSON.stringify(entry)}`
    );
    assert.ok(
      cmdRe.test(entry.command),
      `command "${entry.command}" violates Telegram's [a-z0-9_]{1,32} rule`
    );
    assert.ok(
      entry.description.length >= 3 && entry.description.length <= 256,
      `description for "${entry.command}" must be 3-256 chars, got length ${entry.description.length}`
    );
    // Telegram silently rejects duplicate commands; guard against accidental dupes.
    assert.ok(!seen.has(entry.command), `duplicate command in COMMANDS: ${entry.command}`);
    seen.add(entry.command);
  }
});

// --- happy-path request shape ---------------------------------------------

test("setMyCommands POSTs { commands } to /setMyCommands and returns response.data", async () => {
  let observedBody = null;
  let observedHeaders = null;
  const scope = nock("https://api.telegram.org")
    .post(`/bot${process.env.TG_TOKEN}/setMyCommands`, (body) => {
      observedBody = body;
      return true;
    })
    .reply(function () {
      observedHeaders = this.req.headers;
      return [200, { ok: true, result: true }];
    });

  const result = await setMyCommands(COMMANDS);

  assert.ok(scope.isDone(), "setMyCommands did not call Telegram");
  assert.deepEqual(
    observedBody,
    { commands: COMMANDS },
    `request body must be exactly { commands: COMMANDS }, got: ${JSON.stringify(observedBody)}`
  );
  // axios sends JSON by default.
  assert.match(
    String(observedHeaders?.["content-type"] ?? ""),
    /application\/json/i,
    "expected JSON content-type"
  );
  assert.deepEqual(result, { ok: true, result: true }, "must return response.data");
});

test("setMyCommands serializes commands in stable order (no array reshuffling)", async () => {
  let observedBody = null;
  const scope = nock("https://api.telegram.org")
    .post(`/bot${process.env.TG_TOKEN}/setMyCommands`, (body) => {
      observedBody = body;
      return true;
    })
    .reply(200, { ok: true, result: true });

  await setMyCommands(COMMANDS);
  assert.ok(scope.isDone());
  assert.deepEqual(
    observedBody.commands.map((c) => c.command),
    COMMANDS.map((c) => c.command),
    "command order must match COMMANDS source order"
  );
});

// --- error paths ----------------------------------------------------------

test("setMyCommands rethrows on a 4xx Telegram error response", async () => {
  const scope = nock("https://api.telegram.org")
    .post(`/bot${process.env.TG_TOKEN}/setMyCommands`)
    .reply(400, { ok: false, description: "Bad Request: invalid command" });

  await assert.rejects(
    () => setMyCommands(COMMANDS),
    (e) => {
      // axios wraps non-2xx into an error with response.status.
      assert.equal(e.response?.status, 400, `expected 400 status, got: ${e.response?.status}`);
      return true;
    }
  );
  assert.ok(scope.isDone());
});

test("setMyCommands rethrows on a network error (so startup .catch fires)", async () => {
  const scope = nock("https://api.telegram.org")
    .post(`/bot${process.env.TG_TOKEN}/setMyCommands`)
    .replyWithError("connection refused");

  await assert.rejects(() => setMyCommands(COMMANDS), /connection refused/);
  assert.ok(scope.isDone());
});

// --- startup-isolation regression -----------------------------------------

test("importing index.js as a module does NOT fire setMyCommands (test isolation)", async () => {
  // nock.disableNetConnect() is active; if the import triggered a real
  // outbound call to api.telegram.org we'd see it as a NetConnectNotAllowed.
  // We additionally arm an interceptor that fails the test if it fires.
  let unexpectedHit = false;
  const guard = nock("https://api.telegram.org")
    .post(`/bot${process.env.TG_TOKEN}/setMyCommands`, () => {
      unexpectedHit = true;
      return true;
    })
    .reply(200, { ok: true, result: true });

  // Re-import is a no-op (modules are cached) but the assertion still holds:
  // if startup registration had fired on first import it would have been
  // recorded by api.telegram.org connection attempts before this test ran.
  await import("../index.js");

  // Give any fire-and-forget a tick to escape.
  await new Promise((r) => setImmediate(r));

  assert.equal(unexpectedHit, false, "index.js import must not fire setMyCommands");

  // Clean up the unused interceptor so it doesn't bleed into later tests.
  nock.removeInterceptor(guard.interceptors?.[0] ?? {});
  nock.cleanAll();
});
