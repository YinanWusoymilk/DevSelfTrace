// Unit tests for app_study/static/core.js (run with: node --test tests/js/*.test.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../app_study/static/core.js");
const presets = require("../../app_study/static/presets.js").presets;

const SIASE = core.validateLabelset(presets["s-iase"]).labelset;
const CUPS = core.validateLabelset(presets.cups).labelset;
const [INTENTION, ACTIONS, EMOTION] = SIASE.dimensions;

// --- formatting ---------------------------------------------------------------

test("formatTime renders minutes and zero-padded seconds", () => {
    assert.equal(core.formatTime(0), "0:00");
    assert.equal(core.formatTime(75), "1:15");
    assert.equal(core.formatTime(125.4), "2:05");
});

test("formatTime rolls over instead of showing 60 seconds", { todo: "fixed in step 9" }, () => {
    assert.equal(core.formatTime(119.6), "2:00");
});

test("formatTimeForDisplay shows None when no time is set", () => {
    assert.equal(core.formatTimeForDisplay(null), "None");
    assert.equal(core.formatTimeForDisplay(61.9), "1:01");
});

test("formatTimeForDisplay treats 0 seconds as a real time", { todo: "fixed in step 9" }, () => {
    assert.equal(core.formatTimeForDisplay(0), "0:00");
});

test("escapeHtml neutralizes markup in custom labels", () => {
    assert.equal(core.escapeHtml("<b>x</b> & \"y\" 'z'"), "&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot; &#39;z&#39;");
    assert.equal(core.escapeHtml(3), "3");
});

test("formatValue shows answers for the logs table", () => {
    assert.equal(core.formatValue(INTENTION, "To Implement Code"), "To Implement Code");
    assert.equal(core.formatValue(INTENTION, null), "—");
    assert.equal(
        core.formatValue(ACTIONS, [{ action: "Writing New Code", tool: "AI Tools" }, { action: "Search", tool: null }]),
        "[Writing New Code, AI Tools]; [Search, —]"
    );
    assert.equal(core.formatValue(ACTIONS, []), "—");
});

// --- label set validation -----------------------------------------------------

function minimal(overrides) {
    return Object.assign({ name: "Test", dimensions: [{ id: "a", label: "A", type: "single", options: ["x", "y"] }] }, overrides);
}

test("validateLabelset fills in defaults and turns string options into objects", () => {
    const result = core.validateLabelset(minimal());
    assert.equal(result.ok, true);
    assert.deepEqual(result.labelset.dimensions[0], {
        id: "a",
        label: "A",
        prompt: "A",
        type: "single",
        allowCustom: true,
        placeholder: "Select an option",
        options: [{ value: "x" }, { value: "y" }],
    });
});

test("validateLabelset keeps option hints", () => {
    const result = core.validateLabelset(minimal({ dimensions: [{ id: "a", label: "A", type: "single", options: [{ value: "x", hint: "an x" }] }] }));
    assert.deepEqual(result.labelset.dimensions[0].options, [{ value: "x", hint: "an x" }]);
});

test("validateLabelset explains what is wrong", () => {
    const cases = [
        [null, /JSON object/],
        [{ dimensions: minimal().dimensions }, /"name" is required/],
        [minimal({ dimensions: [] }), /non-empty list/],
        [minimal({ dimensions: [{ id: "1a", label: "A", type: "single", options: ["x"] }] }), /"id" must start with a letter/],
        [minimal({ dimensions: [{ id: "start", label: "A", type: "single", options: ["x"] }] }), /"id" cannot be "id", "start", "end", "duration"/],
        [minimal({ dimensions: [{ id: "a", label: "A", type: "single", options: ["x"] }, { id: "a", label: "B", type: "single", options: ["y"] }] }), /duplicate id "a"/],
        [minimal({ dimensions: [{ id: "a", label: "A", type: "multi", options: ["x"] }] }), /"type" must be "single" or "pairs"/],
        [minimal({ dimensions: [{ id: "a", label: "A", type: "single", options: [] }] }), /non-empty list of options/],
        [minimal({ dimensions: [{ id: "a", label: "A", type: "single", options: ["x", "x"] }] }), /duplicate option "x"/],
        [minimal({ dimensions: [{ id: "a", label: "A", type: "pairs", fields: [{ id: "f", label: "F", options: ["x"] }] }] }), /exactly 2 "fields"/],
        [
            minimal({
                dimensions: [{
                    id: "a", label: "A", type: "pairs",
                    fields: [{ id: "f", label: "F", optional: true, options: ["x"] }, { id: "g", label: "G", optional: true, options: ["y"] }],
                }],
            }),
            /must not be optional/,
        ],
    ];
    for (const [input, message] of cases) {
        const result = core.validateLabelset(input);
        assert.equal(result.ok, false, JSON.stringify(input));
        assert.match(result.errors.join("\n"), message);
    }
});

// --- choosing a label set for a session ---------------------------------------

test("resolveLabelset uses the requested set for a new session", () => {
    assert.deepEqual(core.resolveLabelset(null, CUPS, false, SIASE), { labelset: CUPS, warning: null });
    assert.deepEqual(core.resolveLabelset(null, null, false, SIASE), { labelset: SIASE, warning: null });
});

test("resolveLabelset keeps the session's own set once it has annotations", () => {
    const result = core.resolveLabelset(CUPS, SIASE, true, SIASE);
    assert.equal(result.labelset, CUPS);
    assert.match(result.warning, /already has annotations made with the "CUPS" label set/);
    assert.equal(core.resolveLabelset(CUPS, CUPS, true, SIASE).warning, null);
});

test("resolveLabelset treats older files without a label set as made with the default", () => {
    assert.equal(core.resolveLabelset(null, null, true, SIASE).labelset, SIASE);
    assert.match(core.resolveLabelset(null, CUPS, true, SIASE).warning, /"S-IASE"/);
});

// --- intervals ----------------------------------------------------------------

const fullSelection = {
    intention: "To Implement Code",
    actions: [{ action: "Writing New Code", tool: "AI Tools" }],
    emotion: "Positive",
};

test("emptySession is a v2 session", () => {
    assert.deepEqual(core.emptySession(), { tool: "DevSelfTrace", schemaVersion: 2, intervals: [] });
});

test("createInterval stores one key per dimension", () => {
    const interval = core.createInterval([], 1, 3.5, SIASE, fullSelection);
    assert.deepEqual(interval, {
        id: 1,
        start: 1,
        end: 3.5,
        duration: 2.5,
        intention: "To Implement Code",
        actions: [{ action: "Writing New Code", tool: "AI Tools" }],
        emotion: "Positive",
    });
    assert.notEqual(interval.actions, fullSelection.actions); // a copy, not the selection itself
});

test("createInterval works for any label set, e.g. CUPS with one dimension", () => {
    assert.deepEqual(core.createInterval([], 0, 2, CUPS, { state: "Prompt Crafting" }), {
        id: 1, start: 0, end: 2, duration: 2, state: "Prompt Crafting",
    });
});

test("createInterval rounds the duration to milliseconds", () => {
    assert.equal(core.createInterval([], 0.1, 0.3, CUPS, { state: "x" }).duration, 0.2);
});

test("createInterval never repeats an ID that is in use", () => {
    const interval = core.createInterval([{ id: 1 }, { id: 3 }], 0, 1, SIASE, fullSelection);
    assert.equal(interval.id, 4);
    assert.equal(core.nextId([]), 1);
});

test("createInterval does not hand out the ID of a deleted interval again", () => {
    // intervals 1, 2, 3 existed (lastId 3) and 3 was deleted
    const interval = core.createInterval([{ id: 1 }, { id: 2 }], 0, 1, SIASE, fullSelection, 3);
    assert.equal(interval.id, 4);
    assert.equal(core.nextId([], 5), 6);
});

test("isSelectionComplete requires an answer for every dimension", () => {
    assert.equal(core.isSelectionComplete(SIASE, fullSelection), true);
    assert.equal(core.isSelectionComplete(SIASE, { ...fullSelection, actions: [] }), false);
    assert.equal(core.isSelectionComplete(SIASE, { ...fullSelection, emotion: "" }), false);
    assert.equal(core.isSelectionComplete(CUPS, { state: "Not Thinking" }), true);
});

test("applyEdit only changes the dimensions that were answered", () => {
    const original = {
        id: 2, start: 0, end: 5, duration: 5,
        intention: "To Understand Context",
        actions: [{ action: "Reading and Comprehension", tool: "IDE" }],
        emotion: "Neutral",
    };
    const edited = core.applyEdit(JSON.parse(JSON.stringify(original)), SIASE, { emotion: "Negative" });
    assert.deepEqual(edited, { ...original, emotion: "Negative" });

    const edited2 = core.applyEdit(JSON.parse(JSON.stringify(original)), SIASE, {
        intention: "To Resolve Errors",
        actions: [{ action: "Running Tests", tool: "IDE" }],
    });
    assert.equal(edited2.intention, "To Resolve Errors");
    assert.deepEqual(edited2.actions, [{ action: "Running Tests", tool: "IDE" }]);
    assert.equal(edited2.emotion, "Neutral");
});

test("sortIntervals keeps intervals in video order", () => {
    const intervals = [{ id: 3, start: 20 }, { id: 1, start: 5 }, { id: 2, start: 5 }];
    assert.deepEqual(core.sortIntervals(intervals).map((interval) => interval.id), [1, 2, 3]);
});

test("describeSelection lists every dimension in order", () => {
    assert.equal(core.describeSelection(SIASE, {}), "Q1: None, Q2: None, Q3: None");
    assert.equal(
        core.describeSelection(SIASE, fullSelection),
        "Q1: To Implement Code, Q2: [Writing New Code, AI Tools], Q3: Positive"
    );
    assert.equal(core.describeSelection(CUPS, { state: "Not Thinking" }), "Q1: Not Thinking");
});
