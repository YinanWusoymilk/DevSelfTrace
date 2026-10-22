// Unit tests for app_study/static/core.js (run with: node --test tests/js/*.test.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../app_study/static/core.js");

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

test("createLog builds a log from the current selection", () => {
    const log = core.createLog([], 1, 3.5, "To Implement Code", [["Writing New Code", "AI Tools"]], "Positive");
    assert.deepEqual(log, {
        ID: 1,
        Timestamps: { start: 1, end: 3.5 },
        TimeInState: "2.500",
        Label1: "To Implement Code",
        Label2: "([Writing New Code, AI Tools])",
        Label3: "Positive",
    });
});

test("createLog fills missing labels with N/A", () => {
    const log = core.createLog([{ ID: 1 }], 0, 1, "", [], "");
    assert.equal(log.ID, 2);
    assert.equal(log.Label1, "N/A");
    assert.equal(log.Label3, "N/A");
});

test("createLog never reuses an ID after a deletion", { todo: "fixed in step 5" }, () => {
    const log = core.createLog([{ ID: 1 }, { ID: 3 }], 0, 1, "x", [["a", "b"]], "y");
    assert.equal(log.ID, 4);
});

test("applyEdit only changes the fields that were selected", () => {
    const original = {
        ID: 2,
        Label1: "To Understand Context",
        Label2: "([Reading and Comprehension, IDE])",
        Label3: "Neutral",
    };
    const edited = core.applyEdit({ ...original }, "", [], "Negative");
    assert.equal(edited.Label1, original.Label1);
    assert.equal(edited.Label2, original.Label2);
    assert.equal(edited.Label3, "Negative");

    const edited2 = core.applyEdit({ ...original }, "To Resolve Errors", [["Running Tests", "IDE"]], "");
    assert.equal(edited2.Label1, "To Resolve Errors");
    assert.equal(edited2.Label2, "([Running Tests, IDE])");
    assert.equal(edited2.Label3, "Neutral");
});
