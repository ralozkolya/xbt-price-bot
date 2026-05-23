import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const TG_TOKEN = "test-token-1234567890";
process.env.TG_TOKEN ??= TG_TOKEN;
process.env.WEBHOOK ??= "http://localhost:9999";
process.env.DB_PATH ??= ":memory:";
process.env.NODE_ENV ??= "test";

let nock;
let listAlerts;
let deleteAlertFromCommand;
let insertAlert;
let getAlertsByChatId;
let deleteAlert;
let app;
let server;
let baseUrl;

before(async () => {
  nock = (await import("nock")).default;
  nock.disableNetConnect();
  nock.enableNetConnect("127.0.0.1");

  ({ listAlerts, deleteAlertFromCommand } = await import("../src/alerts.js"));
  ({ insertAlert, getAlertsByChatId, deleteAlert } = await import(
    "../src/db.js"
  ));
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

// Captures a single outgoing Telegram sendMessage body. Returns a promise that
// resolves to the captured body once the request fires.
const captureSendMessage = () => {
  let resolveBody;
  const seen = new Promise((r) => (resolveBody = r));
  const scope = nock("https://api.telegram.org")
    .post(`/bot${TG_TOKEN}/sendMessage`, (body) => {
      resolveBody(body);
      return true;
    })
    .reply(200, { ok: true, result: {} });
  return { scope, seen };
};

const MD_V2_SPECIALS = new Set("_*[]()~`>#+-=|{}.!");

// In Telegram MarkdownV2 every special (except \) must appear as "\X". Walk
// the string consuming escape pairs ("\X" → fine, regardless of X), and flag
// any remaining bare special. A trailing lone backslash is also a leak.
const unescapedSpecials = (text) => {
  const found = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      if (i + 1 >= text.length) {
        found.push({ ch: "\\", index: i, reason: "trailing backslash" });
      }
      i += 2;
      continue;
    }
    if (MD_V2_SPECIALS.has(ch)) {
      found.push({ ch, index: i });
    }
    i += 1;
  }
  return found;
};

// ---------- DB-level tests (the chatId isolation invariant lives here) ----------

test("getAlertsByChatId: empty for an unknown chatId", async () => {
  const rows = await getAlertsByChatId("chat-empty-1");
  assert.deepEqual(rows, []);
});

test("getAlertsByChatId: returns only rows belonging to the requesting chatId", async () => {
  // NOTE: getAlertsByChatId projects `id, target, pair, alertOn` (no chatId),
  // so isolation must be verified via value-set membership rather than
  // r.chatId equality. The WHERE clause is the security boundary.
  const chatA = "chat-A-isolation";
  const chatB = "chat-B-isolation";

  await insertAlert({ chatId: chatA, target: 30000, pair: "XBT/USD", alertOn: "higher" });
  await insertAlert({ chatId: chatA, target: 25000, pair: "XBT/EUR", alertOn: "lower" });
  await insertAlert({ chatId: chatB, target: 99999, pair: "XBT/USD", alertOn: "higher" });

  const rowsA = await getAlertsByChatId(chatA);
  const rowsB = await getAlertsByChatId(chatB);

  assert.equal(rowsA.length, 2, "chatA should see exactly its 2 alerts");
  assert.equal(rowsB.length, 1, "chatB should see exactly its 1 alert");

  const targetsA = rowsA.map((r) => r.target).sort();
  assert.deepEqual(targetsA, [25000, 30000], "chatA must see exactly its own targets");
  assert.ok(
    rowsA.every((r) => r.target !== 99999),
    "chatB's target must not leak into chatA's listing"
  );

  const targetsB = rowsB.map((r) => r.target);
  assert.deepEqual(targetsB, [99999], "chatB must see exactly its own target");
  assert.ok(
    rowsB.every((r) => r.target !== 30000 && r.target !== 25000),
    "chatA's targets must not leak into chatB's listing"
  );
});


test("getAlertsByChatId: rows are ordered by id ascending (insertion order)", async () => {
  const chat = "chat-order";
  await insertAlert({ chatId: chat, target: 10000, pair: "XBT/USD", alertOn: "lower" });
  await insertAlert({ chatId: chat, target: 50000, pair: "XBT/USD", alertOn: "higher" });
  await insertAlert({ chatId: chat, target: 80000, pair: "XBT/USD", alertOn: "higher" });

  const rows = await getAlertsByChatId(chat);
  assert.equal(rows.length, 3);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      rows[i].id > rows[i - 1].id,
      `expected ascending id order, got ${rows.map((r) => r.id).join(",")}`
    );
  }
  assert.deepEqual(
    rows.map((r) => r.target),
    [10000, 50000, 80000]
  );
});

// ---------- listAlerts rendering tests (via the api.js → nock boundary) ----------

test("listAlerts: empty case sends the alertsEmpty template", async () => {
  const chat = "chat-listAlerts-empty";
  const { scope, seen } = captureSendMessage();

  await listAlerts(chat);

  const body = await seen;
  assert.ok(scope.isDone(), "Telegram sendMessage was not invoked");
  assert.equal(body.chat_id, chat);
  assert.equal(body.parse_mode, "MarkdownV2");
  assert.ok(
    /no active alerts/i.test(body.text),
    `expected empty-alerts copy, got: ${body.text}`
  );
  assert.ok(
    !body.text.includes("%"),
    `empty template should have no unresolved substitutions: ${body.text}`
  );
});

test("listAlerts: single alert renders id, direction, amount, currency", async () => {
  const chat = "chat-listAlerts-single";
  await insertAlert({ chatId: chat, target: 22000, pair: "XBT/USD", alertOn: "higher" });
  const { scope, seen } = captureSendMessage();

  await listAlerts(chat);

  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(body.text.includes("USD"), `missing currency: ${body.text}`);
  assert.ok(body.text.includes("rises above"), `missing direction: ${body.text}`);
  // Amount goes through Intl.NumberFormat → "22,000"; the comma is not a
  // MarkdownV2 special so it appears as-is.
  assert.ok(body.text.includes("22,000"), `missing formatted amount: ${body.text}`);
  // The row prefix "#<id>" — the # must be escaped to "\#".
  assert.ok(/\\#\d+/.test(body.text), `missing escaped #id prefix: ${body.text}`);
  assert.ok(
    !body.text.includes("%ALERTS%"),
    `template placeholder was not substituted: ${body.text}`
  );
});

test("listAlerts: multiple alerts same currency render in id-asc order on separate lines", async () => {
  const chat = "chat-listAlerts-multi";
  await insertAlert({ chatId: chat, target: 15000, pair: "XBT/USD", alertOn: "lower" });
  await insertAlert({ chatId: chat, target: 60000, pair: "XBT/USD", alertOn: "higher" });
  await insertAlert({ chatId: chat, target: 90000, pair: "XBT/USD", alertOn: "higher" });
  const { scope, seen } = captureSendMessage();

  await listAlerts(chat);

  const body = await seen;
  assert.ok(scope.isDone());

  const idx15 = body.text.indexOf("15,000");
  const idx60 = body.text.indexOf("60,000");
  const idx90 = body.text.indexOf("90,000");
  assert.ok(idx15 !== -1 && idx60 !== -1 && idx90 !== -1, `missing amounts: ${body.text}`);
  assert.ok(
    idx15 < idx60 && idx60 < idx90,
    `expected ascending id order in output, got positions ${idx15}/${idx60}/${idx90}`
  );

  assert.ok(body.text.includes("drops below"), "lower-direction row missing");
  assert.ok(body.text.includes("rises above"), "higher-direction row missing");

  // listAlerts joins rows with "\n"; the rendered text should contain at least
  // two newlines between the three rows (the literal newline char survives
  // escaping — MarkdownV2 does not require escaping LF).
  const rowSeparators = (body.text.match(/\n/g) ?? []).length;
  assert.ok(
    rowSeparators >= 2,
    `expected at least 2 row separators (newlines), got ${rowSeparators} in: ${body.text}`
  );
});

test("listAlerts: multi-currency listing shows both USD and EUR", async () => {
  const chat = "chat-listAlerts-multicurrency";
  await insertAlert({ chatId: chat, target: 22000, pair: "XBT/USD", alertOn: "higher" });
  await insertAlert({ chatId: chat, target: 18000, pair: "XBT/EUR", alertOn: "lower" });
  const { scope, seen } = captureSendMessage();

  await listAlerts(chat);

  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(body.text.includes("USD"), `missing USD row: ${body.text}`);
  assert.ok(body.text.includes("EUR"), `missing EUR row: ${body.text}`);
  assert.ok(body.text.includes("22,000"), `missing USD amount: ${body.text}`);
  assert.ok(body.text.includes("18,000"), `missing EUR amount: ${body.text}`);
});

test("listAlerts: isolation — listing for chatA does NOT include chatB's alerts", async () => {
  const chatA = "chat-listAlerts-iso-A";
  const chatB = "chat-listAlerts-iso-B";
  await insertAlert({ chatId: chatA, target: 11111, pair: "XBT/USD", alertOn: "higher" });
  await insertAlert({ chatId: chatB, target: 77777, pair: "XBT/EUR", alertOn: "lower" });

  const { scope, seen } = captureSendMessage();
  await listAlerts(chatA);
  const body = await seen;
  assert.ok(scope.isDone());

  assert.equal(body.chat_id, chatA, "message must go to the requesting chatId");
  assert.ok(body.text.includes("11,111"), `chatA's own alert missing: ${body.text}`);
  assert.ok(
    !body.text.includes("77,777"),
    `chatB's alert leaked into chatA's listing: ${body.text}`
  );
  assert.ok(
    !body.text.includes("EUR"),
    `chatB's currency (EUR) leaked into chatA's USD-only listing: ${body.text}`
  );
});

test("listAlerts: MarkdownV2 safety — every special char in the rendered body is escaped", async () => {
  const chat = "chat-listAlerts-mdv2";
  await insertAlert({ chatId: chat, target: 12345.5, pair: "XBT/USD", alertOn: "higher" });
  const { scope, seen } = captureSendMessage();

  await listAlerts(chat);

  const body = await seen;
  assert.ok(scope.isDone());

  const leaks = unescapedSpecials(body.text);
  assert.equal(
    leaks.length,
    0,
    `found unescaped MarkdownV2 specials: ${JSON.stringify(leaks)} in text: ${JSON.stringify(body.text)}`
  );

  // Spot-check: the "#" in "#<id>" and the "." in "12,345.5" must each be
  // escaped exactly once (no double-escape regression a la PERCENTAGE hyphen).
  assert.ok(body.text.includes("\\#"), "expected escaped #");
  assert.ok(body.text.includes("\\."), "expected escaped .");
  assert.ok(!body.text.includes("\\\\#"), "found double-escaped \\\\#");
  assert.ok(!body.text.includes("\\\\."), "found double-escaped \\\\.");
});

// ---------- Webhook routing tests (regression: /alerts vs /alert) ----------

test("webhook routing: bare /alerts is dispatched to listAlerts (empty path)", async () => {
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 1001,
    message: { message_id: 1, chat: { id: "route-alerts-bare" }, text: "/alerts" },
  });
  assert.ok(res.status >= 200 && res.status < 300, `expected 2xx, got ${res.status}`);
  const body = await seen;
  assert.ok(scope.isDone(), "listAlerts was not invoked");
  assert.ok(
    /no active alerts/i.test(body.text),
    `/alerts (no rows) should hit alertsEmpty, got: ${body.text}`
  );
});

test("webhook routing: /alerts@SomeBot suffix is dispatched to listAlerts", async () => {
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 1002,
    message: { message_id: 2, chat: { id: "route-alerts-suffix" }, text: "/alerts@XbtPriceBot" },
  });
  assert.ok(res.status >= 200 && res.status < 300, `expected 2xx, got ${res.status}`);
  const body = await seen;
  assert.ok(scope.isDone(), "listAlerts was not invoked for /alerts@BotName");
  assert.ok(
    /no active alerts/i.test(body.text),
    `/alerts@Bot should hit alertsEmpty, got: ${body.text}`
  );
});

test("webhook routing: /alert (singular, no target) is NOT swallowed by the /alerts case", async () => {
  // /alert with no arg hits alertAcknowledgment, which loads
  // messages/alert-acknowledgment.md. We only need to assert it is NOT the
  // alertsEmpty template (which would mean /alerts swallowed the request).
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 1003,
    message: { message_id: 3, chat: { id: "route-alert-bare" }, text: "/alert" },
  });
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    !/no active alerts/i.test(body.text),
    `/alert was incorrectly routed to listAlerts: ${body.text}`
  );
});

test("routing regex: /^\\/alerts(@\\w+)?(\\s|$)/i matches the right set of inputs", () => {
  // Pure regex check mirroring src/telegram.js — guards against accidental
  // edits to the alerts route that would change what gets swallowed.
  const re = /^\/alerts(@\w+)?(\s|$)/i;

  // SHOULD match → listAlerts:
  assert.ok(re.test("/alerts"), "/alerts must match");
  assert.ok(re.test("/alerts "), "/alerts (trailing space) must match");
  assert.ok(re.test("/Alerts"), "/Alerts (case-insensitive) must match");
  assert.ok(re.test("/alerts@SomeBot"), "/alerts@SomeBot must match");
  assert.ok(re.test("/alerts@SomeBot "), "/alerts@SomeBot<space> must match");

  // MUST NOT match → falls through to /alert prefix or default:
  assert.ok(!re.test("/alert"), "/alert must NOT match the /alerts route");
  assert.ok(!re.test("/alert 22k"), "/alert 22k must NOT match");
  assert.ok(!re.test("/alertfoo"), "/alertfoo must NOT match");
  assert.ok(!re.test("/alertsfoo"), "/alertsfoo (no boundary) must NOT match");
  assert.ok(!re.test("alerts"), "no leading slash must NOT match");
  assert.ok(!re.test(" /alerts"), "leading space must NOT match");
});

test("webhook routing: /alertfoo (no space) is NOT routed to listAlerts", async () => {
  // /alertfoo should fall through to /alert prefix check, then into
  // alertFromCommand → alertFromResponse("foo") → unsupportedTarget.
  // It must NOT hit the /alerts regex (which requires (\s|$) after "alerts").
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 1005,
    message: { message_id: 5, chat: { id: "route-alertfoo" }, text: "/alertfoo" },
  });
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    !/no active alerts/i.test(body.text) && !/Your active alerts/i.test(body.text),
    `/alertfoo was incorrectly routed to listAlerts: ${body.text}`
  );
});

test("webhook routing: /alertsfoo (extra chars, no space) is NOT routed to listAlerts", async () => {
  // Regression guard on the (\s|$) boundary in /^\/alerts(@\w+)?(\s|$)/i.
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 1006,
    message: { message_id: 6, chat: { id: "route-alertsfoo" }, text: "/alertsfoo" },
  });
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(
    !/no active alerts/i.test(body.text) && !/Your active alerts/i.test(body.text),
    `/alertsfoo was incorrectly routed to listAlerts: ${body.text}`
  );
});

// ---------- /deletealert -------------------------------------------------

test("deleteAlert: own-chat delete removes the row and sends success", async () => {
  const chat = "del-own-1";
  const { lastID } = await insertAlert({
    chatId: chat,
    target: 40000,
    pair: "XBT/USD",
    alertOn: "higher",
  });
  const { scope, seen } = captureSendMessage();

  await deleteAlertFromCommand(chat, `/deletealert ${lastID}`);
  const body = await seen;

  assert.ok(scope.isDone());
  assert.ok(/deleted/i.test(body.text), `expected deleted copy, got: ${body.text}`);
  assert.ok(
    body.text.includes(String(lastID)),
    `success message should include id: ${body.text}`
  );
  const rows = await getAlertsByChatId(chat);
  assert.ok(
    !rows.some((r) => r.id === lastID),
    "row should be gone after delete"
  );
});

test("deleteAlert: cross-tenant delete returns not-found and does NOT touch the row", async () => {
  const chatA = "del-A-tenant";
  const chatB = "del-B-tenant";
  const { lastID } = await insertAlert({
    chatId: chatA,
    target: 42000,
    pair: "XBT/USD",
    alertOn: "higher",
  });
  const { scope, seen } = captureSendMessage();

  await deleteAlertFromCommand(chatB, `/deletealert ${lastID}`);
  const body = await seen;

  assert.ok(scope.isDone());
  assert.ok(/no alert with that id/i.test(body.text), `expected not-found copy, got: ${body.text}`);
  // The unified copy must NOT echo the id back (no oracle).
  assert.ok(
    !body.text.includes(String(lastID)),
    `not-found message must not echo the id: ${body.text}`
  );
  const rowsA = await getAlertsByChatId(chatA);
  assert.ok(rowsA.some((r) => r.id === lastID), "chatA's row must still exist");
});

test("deleteAlert: nonexistent id returns not-found and does not throw", async () => {
  const chat = "del-nonexistent";
  const { scope, seen } = captureSendMessage();
  await deleteAlertFromCommand(chat, "/deletealert 9999999");
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(/no alert with that id/i.test(body.text));
});

test("deleteAlert: idempotent repeat-delete — second call returns not-found", async () => {
  const chat = "del-idemp";
  const { lastID } = await insertAlert({
    chatId: chat,
    target: 33000,
    pair: "XBT/USD",
    alertOn: "higher",
  });
  const { scope: s1, seen: seen1 } = captureSendMessage();
  await deleteAlertFromCommand(chat, `/deletealert ${lastID}`);
  await seen1;
  assert.ok(s1.isDone());

  const { scope: s2, seen: seen2 } = captureSendMessage();
  await deleteAlertFromCommand(chat, `/deletealert ${lastID}`);
  const body2 = await seen2;
  assert.ok(s2.isDone());
  assert.ok(/no alert with that id/i.test(body2.text));
});

test("deleteAlert: malformed input variants all return the usage template", async () => {
  const chat = "del-malformed";
  const cases = ["/deletealert", "/deletealert ", "/deletealert #12", "/deletealert Δ5", "/deletealert 12abc", "/deletealert 1e5", "/deletealert -3", "/deletealert 0", "/deletealert 01", "/deletealert  "];
  for (const text of cases) {
    const { scope, seen } = captureSendMessage();
    await deleteAlertFromCommand(chat, text);
    const body = await seen;
    assert.ok(scope.isDone(), `no sendMessage fired for "${text}"`);
    assert.ok(
      /usage/i.test(body.text),
      `input "${text}" did not produce usage template, got: ${body.text}`
    );
  }
});

test("deleteAlert: concurrent fire + user delete — exactly one changes:1, no throw", async () => {
  // Simulate the race: both processAlert (via deleteAlert) and a user delete
  // hit the same row. Both calls go through the scoped DELETE; SQLite serializes
  // writes, so exactly one returns changes:1.
  const chat = "del-race";
  const { lastID } = await insertAlert({
    chatId: chat,
    target: 50000,
    pair: "XBT/USD",
    alertOn: "higher",
  });

  const [r1, r2] = await Promise.all([
    deleteAlert(lastID, chat),
    deleteAlert(lastID, chat),
  ]);
  const wins = [r1, r2].filter((r) => r?.changes === 1).length;
  assert.equal(wins, 1, "exactly one concurrent delete must succeed");
});

test("deleteAlert: dispatch regex matches expected forms only", () => {
  const re = /^\/deletealert(@\w+)?(\s|$)/i;
  assert.ok(re.test("/deletealert"));
  assert.ok(re.test("/deletealert "));
  assert.ok(re.test("/deletealert 5"));
  assert.ok(re.test("/Deletealert 5"));
  assert.ok(re.test("/deletealert@SomeBot"));
  assert.ok(re.test("/deletealert@SomeBot 5"));
  assert.ok(!re.test("/deletealerts"));
  assert.ok(!re.test("/deletealertfoo"));
  assert.ok(!re.test("/deletealert5"));
  assert.ok(!re.test(" /deletealert"));
  assert.ok(!re.test("deletealert"));
});

test("deleteAlert webhook: /deletealert <id> is routed and deletes the row", async () => {
  const chat = "del-webhook-1";
  const { lastID } = await insertAlert({
    chatId: chat,
    target: 60000,
    pair: "XBT/USD",
    alertOn: "higher",
  });
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 2001,
    message: { message_id: 1, chat: { id: chat }, text: `/deletealert ${lastID}` },
  });
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(/deleted/i.test(body.text));
  const rows = await getAlertsByChatId(chat);
  assert.ok(!rows.some((r) => r.id === lastID));
});

test("deleteAlert webhook: /deletealert is NOT swallowed by /alert prefix", async () => {
  const { scope, seen } = captureSendMessage();
  const res = await postJson(`/${TG_TOKEN}`, {
    update_id: 2002,
    message: { message_id: 2, chat: { id: "del-route-prefix" }, text: "/deletealert" },
  });
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await seen;
  assert.ok(scope.isDone());
  assert.ok(/usage/i.test(body.text), `/deletealert no-arg should hit usage, got: ${body.text}`);
});

test("deleteAlert: MarkdownV2 safety — success body has every special escaped", async () => {
  const chat = "del-mdv2";
  const { lastID } = await insertAlert({
    chatId: chat,
    target: 70000,
    pair: "XBT/USD",
    alertOn: "higher",
  });
  const { scope, seen } = captureSendMessage();
  await deleteAlertFromCommand(chat, `/deletealert ${lastID}`);
  const body = await seen;
  assert.ok(scope.isDone());
  const leaks = unescapedSpecials(body.text);
  assert.equal(
    leaks.length,
    0,
    `unescaped MarkdownV2 specials: ${JSON.stringify(leaks)} in: ${JSON.stringify(body.text)}`
  );
});
