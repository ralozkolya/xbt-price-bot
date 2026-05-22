import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TG_TOKEN ??= "test-token-1234567890";
process.env.WEBHOOK ??= "http://localhost:9999";
process.env.DB_PATH ??= ":memory:";
process.env.NODE_ENV ??= "test";

const { fileContent } = await import("../src/messages.js");

test("fileContent escapes every period, not just the first", async () => {
  const text = await fileContent("alert-triggered", {
    ACTION: "risen above",
    AMOUNT: 50.5,
    PRICE: 50000.5,
    CURRENCY: "USD",
  });
  const unescaped = (text.match(/(?<!\\)\./g) ?? []).length;
  assert.equal(
    unescaped,
    0,
    `expected all periods to be escaped, found ${unescaped} unescaped in: ${text}`
  );
});

test("fileContent escapes PERCENTAGE hyphen exactly once (no double-escape)", async () => {
  const text = await fileContent("alert-set", {
    CURRENCY: "USD",
    AMOUNT: 50000,
    ALERT_ON: "rises above",
    PERCENTAGE: -1.23,
  });
  assert.ok(
    text.includes("\\-1"),
    `expected single-escaped hyphen \\-1 in: ${text}`
  );
  assert.ok(
    !text.includes("\\\\-"),
    `found double-escaped hyphen \\\\- in: ${text}`
  );
});

test("fileContent formats AMOUNT with en-US thousands separators (locale-stable)", async () => {
  const text = await fileContent("alert-set", {
    CURRENCY: "USD",
    AMOUNT: 50000,
    ALERT_ON: "rises above",
    PERCENTAGE: 0,
  });
  assert.ok(
    text.includes("50,000"),
    `expected en-US-formatted AMOUNT (50,000) in: ${text}`
  );
});

test("fileContent passes a unicode replacement value through unchanged", async () => {
  const text = await fileContent("alert-set", {
    CURRENCY: "€",
    AMOUNT: 100,
    ALERT_ON: "rises above",
    PERCENTAGE: 0,
  });
  assert.ok(text.includes("€"), `expected € to survive, got: ${text}`);
});
