import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const TG_TOKEN = "test-token-1234567890";
process.env.TG_TOKEN = TG_TOKEN;
process.env.WEBHOOK = "http://localhost:9999";
process.env.NODE_ENV = "test";

const tmpDir = mkdtempSync(join(tmpdir(), "xbt-test-"));
process.env.DB_PATH = ":memory:";

let nock;
let app;
let server;
let baseUrl;

before(async () => {
  nock = (await import("nock")).default;
  nock.disableNetConnect();
  nock.enableNetConnect("127.0.0.1");

  ({ app } = await import("../index.js"));

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  if (server) server.close();
  if (nock) {
    nock.cleanAll();
    nock.enableNetConnect();
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

const postJson = (path, body) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, baseUrl);
    const req = http.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => resolve({ status: res.statusCode, body: chunks }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });

test("POST /:token with /help dispatches sendMessage and returns 2xx", async () => {
  let observedBody = null;
  const scope = nock("https://api.telegram.org")
    .post(`/bot${TG_TOKEN}/sendMessage`, (body) => {
      observedBody = body;
      return true;
    })
    .reply(200, { ok: true, result: {} });

  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 42 },
      text: "/help",
    },
  });

  assert.ok(
    res.status >= 200 && res.status < 300,
    `expected 2xx, got ${res.status}`
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(scope.isDone(), "Telegram sendMessage was not invoked");
  assert.equal(observedBody?.chat_id, 42);
  assert.equal(typeof observedBody?.text, "string");
  assert.ok(observedBody.text.length > 0);
});

test("POST /:token with wrong token returns 401", async () => {
  const res = await postJson(`/wrong-token`, {
    update_id: 2,
    message: { message_id: 2, chat: { id: 43 }, text: "/help" },
  });
  assert.equal(res.status, 401);
});

test("POST /:token with non-text message is a no-op 2xx", async () => {
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 3,
    message: {
      message_id: 3,
      chat: { id: 44 },
      photo: [{ file_id: "x" }],
    },
  });
  assert.ok(
    res.status >= 200 && res.status < 300,
    `expected 2xx, got ${res.status}`
  );
});
