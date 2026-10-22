// Unit tests for app_study/static/core.js (run with: node --test tests/js/*.test.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../app_study/static/core.js");
const presets = require("../../app_study/static/presets.js").presets;

const SIASE = core.validateLabelset(presets["s-iase"]).labelset;
const CUPS = core.validateLabelset(presets.cups).labelset;

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

test("formatActionToolPairs matches the stored Label2 format", () => {
    assert.equal(core.formatActionToolPairs([["Writing New Code", "AI Tools"]]), "([Writing New Code, AI Tools])");
    assert.equal(
        core.formatActionToolPairs([["Search", "Search Engine"], ["Executing the Code", "null"]]),
        "([Search, Search Engine]; [Executing the Code, null])"
    );
});

test("describeActionToolPairs summarizes the current selection", () => {
    assert.equal(core.describeActionToolPairs([]), "None");
    assert.equal(core.describeActionToolPairs([["Search", "IDE"], ["", ""]]), "[Search, IDE], [Undefined Action, Undefined Tool]");
});

test("escapeHtml neutralizes markup in custom labels", () => {
    assert.equal(core.escapeHtml("<b>x</b> & \"y\" 'z'"), "&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot; &#39;z&#39;");
    assert.equal(core.escapeHtml(3), "3");
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

// --- annotations --------------------------------------------------------------

const fullSelection = {
    intention: "To Implement Code",
    actions: [["Writing New Code", "AI Tools"]],
    emotion: "Positive",
};

test("createLog stores the S-IASE answers exactly as before (Label1-3)", () => {
    const log = core.createLog([], 1, 3.5, SIASE, fullSelection);
    assert.deepEqual(log, {
        ID: 1,
        Timestamps: { start: 1, end: 3.5 },
        TimeInState: "2.500",
        Label1: "To Implement Code",
        Label2: "([Writing New Code, AI Tools])",
        Label3: "Positive",
    });
});

test("createLog works for any label set, e.g. CUPS with one dimension", () => {
    const log = core.createLog([], 0, 2, CUPS, { state: "Prompt Crafting" });
    assert.equal(log.Label1, "Prompt Crafting");
    assert.equal(log.Label2, undefined);
});

test("createLog fills missing answers with N/A", () => {
    const log = core.createLog([{ ID: 1 }], 0, 1, SIASE, {});
    assert.equal(log.ID, 2);
    assert.equal(log.Label1, "N/A");
    assert.equal(log.Label2, "()");
    assert.equal(log.Label3, "N/A");
});

test("createLog never reuses an ID after a deletion", { todo: "fixed in step 5" }, () => {
    const log = core.createLog([{ ID: 1 }, { ID: 3 }], 0, 1, SIASE, fullSelection);
    assert.equal(log.ID, 4);
});

test("isSelectionComplete requires an answer for every dimension", () => {
    assert.equal(core.isSelectionComplete(SIASE, fullSelection), true);
    assert.equal(core.isSelectionComplete(SIASE, { ...fullSelection, actions: [] }), false);
    assert.equal(core.isSelectionComplete(SIASE, { ...fullSelection, emotion: "" }), false);
    assert.equal(core.isSelectionComplete(CUPS, { state: "Not Thinking" }), true);
});

test("applyEdit only changes the dimensions that were answered", () => {
    const original = {
        ID: 2,
        Label1: "To Understand Context",
        Label2: "([Reading and Comprehension, IDE])",
        Label3: "Neutral",
    };
    const edited = core.applyEdit({ ...original }, SIASE, { emotion: "Negative" });
    assert.equal(edited.Label1, original.Label1);
    assert.equal(edited.Label2, original.Label2);
    assert.equal(edited.Label3, "Negative");

    const edited2 = core.applyEdit({ ...original }, SIASE, { intention: "To Resolve Errors", actions: [["Running Tests", "IDE"]] });
    assert.equal(edited2.Label1, "To Resolve Errors");
    assert.equal(edited2.Label2, "([Running Tests, IDE])");
    assert.equal(edited2.Label3, "Neutral");
});

test("describeSelection lists every dimension in order", () => {
    assert.equal(core.describeSelection(SIASE, {}), "Q1: None, Q2: None, Q3: None");
    assert.equal(
        core.describeSelection(SIASE, fullSelection),
        "Q1: To Implement Code, Q2: [Writing New Code, AI Tools], Q3: Positive"
    );
    assert.equal(core.describeSelection(CUPS, { state: "Not Thinking" }), "Q1: Not Thinking");
});
