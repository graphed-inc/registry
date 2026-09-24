import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractJson,
  looksGarbled,
  parseAgentDecision,
  replySubject,
} from "./agent";
import {
  jobDisposition,
  playbookReady,
  STARTER_PLAYBOOK,
} from "./playbook";

describe("parseAgentDecision", () => {
  const payload = {
    reasoning: "They asked what it costs.",
    action: "reply",
    deal_status: "negotiating",
    reply_subject: "Re: pricing",
    reply_body: "Happy to walk through it.",
    escalation_reason: null,
    summary_for_owner: null,
  };

  it("parses a raw JSON object", () => {
    const decision = parseAgentDecision(JSON.stringify(payload));
    assert.equal(decision.action, "reply");
    assert.equal(decision.reply_body, "Happy to walk through it.");
  });

  it("parses JSON wrapped in a fence", () => {
    const decision = parseAgentDecision(
      "```json\n" + JSON.stringify(payload) + "\n```",
    );
    assert.equal(decision.deal_status, "negotiating");
  });

  it("rejects an unknown action", () => {
    assert.throws(() =>
      parseAgentDecision(JSON.stringify({ ...payload, action: "send" })),
    );
  });
});

describe("extractJson", () => {
  it("returns the object inside a fence", () => {
    const value = extractJson('```json\n{"ok":true}\n```');
    assert.deepEqual(value, { ok: true });
  });
});

describe("looksGarbled", () => {
  it("flags a leaked escape and a triple repeat", () => {
    assert.equal(looksGarbled("See you then."), false);
    assert.equal(looksGarbled("hello \\n there"), true);
    assert.equal(looksGarbled("yes yes yes"), true);
  });
});

describe("replySubject", () => {
  it("adds a single Re prefix", () => {
    assert.equal(replySubject("Re: Re: Hello", "Fallback"), "Re: Hello");
    assert.equal(replySubject("", "Hello"), "Re: Hello");
  });
});

describe("playbook gates", () => {
  it("treats the starter document as incomplete", () => {
    assert.equal(playbookReady(STARTER_PLAYBOOK), false);
    assert.equal(jobDisposition("send", STARTER_PLAYBOOK), "skip-incomplete");
  });

  it("lets a finished playbook draft or send", () => {
    const ready = STARTER_PLAYBOOK.replace("FILL IN BEFORE GOING LIVE", "ready");
    assert.equal(playbookReady(ready), true);
    assert.equal(jobDisposition("draft", ready), "draft");
    assert.equal(jobDisposition("send", ready), "send");
    assert.equal(jobDisposition("off", ready), "skip-off");
  });
});
