// Tests for the sample session behind "Load sample" (app_study/static/sample.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../app_study/static/core.js");
const presets = require("../../app_study/static/presets.js").presets;
const sample = require("../../app_study/static/sample.js");

const SIASE = core.validateLabelset(presets["s-iase"]).labelset;
const [INTENTION, ACTIONS, EMOTION] = SIASE.dimensions;
const values = (options) => new Set(options.map((option) => option.value));

test("the sample loads like an exported file", () => {
    const result = core.parseSessionFile(JSON.stringify(sample), SIASE);
    assert.equal(result.ok, true);
    assert.equal(result.converted, false);
    assert.equal(result.session.intervals.length, 9);
    assert.equal(result.session.labelset, SIASE);
    assert.equal(result.session.video, undefined, "no video, so loading your own recording raises no mismatch warning");
});

test("the sample says it is made up", () => {
    assert.match(sample.note, /Made-up example/);
    assert.match(sample.note, /Not data from any participant/);
});

test("the sample uses S-IASE options, plus exactly one custom intention as an example", () => {
    const intentions = values(INTENTION.options);
    const custom = sample.intervals.filter((interval) => !intentions.has(interval.intention));
    assert.deepEqual(custom.map((interval) => interval.intention), ["To Check API Rate Limits"]);

    const actionValues = values(ACTIONS.fields[0].options);
    const toolValues = values(ACTIONS.fields[1].options);
    const emotions = values(EMOTION.options);
    for (const interval of sample.intervals) {
        assert.ok(emotions.has(interval.emotion), interval.emotion);
        for (const pair of interval.actions) {
            assert.ok(actionValues.has(pair.action), pair.action);
            assert.ok(pair.tool === null || toolValues.has(pair.tool), pair.tool);
        }
    }
});

test("the sample's times, durations and IDs are consistent", () => {
    const ids = sample.intervals.map((interval) => interval.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(sample.lastId >= Math.max(...ids));
    sample.intervals.forEach((interval, i) => {
        assert.equal(interval.duration, interval.end - interval.start, `interval ${interval.id}`);
        if (i > 0) assert.ok(interval.start >= sample.intervals[i - 1].start, "in video order");
    });
});
