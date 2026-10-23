// Tests for reading v1 files (convertV1 / normalizeSession in core.js).
// tests/py/test_convert.py checks scripts/convert_v1_to_v2.py against the same fixture.
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../app_study/static/core.js");
const presets = require("../../app_study/static/presets.js").presets;
const v1 = require("../fixtures/v1_session.json");
const expected = require("../fixtures/v1_session_expected.json");

const SIASE = core.validateLabelset(presets["s-iase"]).labelset;
const CUPS = core.validateLabelset(presets.cups).labelset;
const actions = SIASE.dimensions[1];

test("convertV1 turns the v1 fixture into the expected v2 intervals", () => {
    const result = core.convertV1(JSON.parse(JSON.stringify(v1)), SIASE);
    assert.deepEqual(result.session.intervals, expected.intervals);
    assert.equal(result.warnings.length, expected.warnings);
    assert.equal(result.session.schemaVersion, 2);
    assert.equal(result.session.labelset, SIASE);
    assert.equal(result.session.lastId, 6); // new intervals continue after the highest ID
});

test("convertV1 explains ambiguous pairs and repeated IDs", () => {
    const { warnings } = core.convertV1(JSON.parse(JSON.stringify(v1)), SIASE);
    assert.match(warnings[0], /"\[Foo, bar, baz\]" can be split more than one way; read as action "Foo, bar" \+ supporting tool "baz"/);
    assert.match(warnings[1], /repeated ID/);
});

test("parseV1Pairs reads the stored pair strings", () => {
    assert.deepEqual(core.parseV1Pairs("([Writing New Code, AI Tools])", actions).pairs, [{ action: "Writing New Code", tool: "AI Tools" }]);
    assert.deepEqual(core.parseV1Pairs("([Search, null])", actions).pairs, [{ action: "Search", tool: null }]);
    assert.deepEqual(core.parseV1Pairs("()", actions).pairs, []);
    assert.deepEqual(core.parseV1Pairs("N/A", actions).pairs, []);
    assert.deepEqual(core.parseV1Pairs(undefined, actions).pairs, []);
});

test("parseV1Pairs uses the known options to place commas inside custom labels", () => {
    // known action on the left
    assert.deepEqual(core.parseV1Pairs("([Search, Slack, Teams])", actions).pairs, [{ action: "Search", tool: "Slack, Teams" }]);
    // known tool on the right
    assert.deepEqual(core.parseV1Pairs("([Reading docs, then coding, IDE])", actions).pairs, [{ action: "Reading docs, then coding", tool: "IDE" }]);
    // neither known: last comma, flagged
    const unknown = core.parseV1Pairs("([Foo, bar, baz])", actions);
    assert.deepEqual(unknown.pairs, [{ action: "Foo, bar", tool: "baz" }]);
    assert.equal(unknown.ambiguous.length, 1);
});

test("convertV1 maps Label<i> to the i-th dimension of any label set", () => {
    const { session } = core.convertV1({ logs: [{ ID: 1, Timestamps: { start: 0, end: 2 }, Label1: "Prompt Crafting" }] }, CUPS);
    assert.deepEqual(session.intervals, [{ id: 1, start: 0, end: 2, duration: 2, state: "Prompt Crafting" }]);
});

test("normalizeSession converts v1, keeps v2, and starts empty otherwise", () => {
    const fromV1 = core.normalizeSession(JSON.parse(JSON.stringify(v1)), SIASE);
    assert.equal(fromV1.converted, true);
    assert.equal(fromV1.session.intervals.length, 5);

    const v2 = { tool: "DevSelfTrace", schemaVersion: 2, revision: 4, intervals: [{ id: 1, start: 0, end: 1, duration: 1 }] };
    const kept = core.normalizeSession(v2, SIASE);
    assert.equal(kept.converted, false);
    assert.deepEqual(kept.session, v2);

    assert.deepEqual(core.normalizeSession(null, SIASE).session, core.emptySession());
    assert.deepEqual(core.normalizeSession({}, SIASE).session, core.emptySession());
});

test("normalizeSession reads v1 logs with the label set saved in the file", () => {
    const data = { labelset: presets.cups, logs: [{ ID: 1, Timestamps: { start: 0, end: 2 }, Label1: "Not Thinking" }] };
    const { session } = core.normalizeSession(data, SIASE);
    assert.equal(session.labelset.name, "CUPS");
    assert.equal(session.intervals[0].state, "Not Thinking");
});
