// Tests for exporting and importing annotations (core.js; run with: node --test tests/js/*.test.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../app_study/static/core.js");
const presets = require("../../app_study/static/presets.js").presets;
const v1 = require("../fixtures/v1_session.json");

const SIASE = core.validateLabelset(presets["s-iase"]).labelset;
const CUPS = core.validateLabelset(presets.cups).labelset;

function sampleSession() {
    return {
        tool: "DevSelfTrace",
        schemaVersion: 2,
        revision: 7,
        labelset: SIASE,
        video: { name: "P01 recording (final).mp4", duration: 1500 },
        lastId: 3,
        intervals: [
            { id: 1, start: 0, end: 12.5, duration: 12.5, intention: "To Understand Context", actions: [{ action: "Reading and Comprehension", tool: "IDE" }], emotion: "Neutral" },
            {
                id: 3, start: 12.5, end: 30, duration: 17.5,
                intention: 'Checked "edge, cases"',
                actions: [{ action: "Writing New Code", tool: "AI Tools" }, { action: "Search", tool: null }],
                emotion: "Slightly Positive",
            },
            { id: 2, start: 30, end: 31, duration: 1, intention: "Line one\nline two", actions: null, emotion: null },
        ],
    };
}

test("exportFileName uses the video name and the time", () => {
    const at = new Date(2026, 9, 22, 20, 5);
    assert.equal(core.exportFileName(sampleSession(), "json", at), "devselftrace_P01_recording_final_20261022-2005.json");
    assert.equal(core.exportFileName(core.emptySession(), "csv", at), "devselftrace_session_20261022-2005.csv");
});

test("exportSession leaves out the save revision and does not change the session", () => {
    const session = sampleSession();
    const exported = core.exportSession(session);
    assert.equal(exported.revision, undefined);
    assert.equal(session.revision, 7);
    assert.deepEqual(exported.intervals, session.intervals);
});

test("csvField quotes only when needed", () => {
    assert.equal(core.csvField("plain"), "plain");
    assert.equal(core.csvField(12.5), "12.5");
    assert.equal(core.csvField(null), "");
    assert.equal(core.csvField("a, b"), '"a, b"');
    assert.equal(core.csvField('say "hi"'), '"say ""hi"""');
    assert.equal(core.csvField("two\nlines"), '"two\nlines"');
    assert.equal(core.csvField(" padded"), '" padded"');
});

test("sessionToCsv writes one row per interval and one column per pair field", () => {
    const lines = core.sessionToCsv(sampleSession(), SIASE).split("\r\n");
    assert.equal(lines[0], "id,start,end,duration,intention,actions.action,actions.tool,emotion");
    assert.equal(lines[1], "1,0,12.5,12.5,To Understand Context,Reading and Comprehension,IDE,Neutral");
    // the second pair has no tool, so actions.tool is "AI Tools; " (quoted to keep the trailing space)
    assert.equal(lines[2], '3,12.5,30,17.5,"Checked ""edge, cases""",Writing New Code; Search,"AI Tools; ",Slightly Positive');
    assert.equal(lines[3], '2,30,31,1,"Line one\nline two",,,'); // the line break stays inside the quoted field
    assert.equal(lines[4], "");
});

test("sessionToCsv follows the label set, e.g. CUPS", () => {
    const session = { intervals: [{ id: 1, start: 0, end: 2, duration: 2, state: "Prompt Crafting" }] };
    assert.equal(core.sessionToCsv(session, CUPS), "id,start,end,duration,state\r\n1,0,2,2,Prompt Crafting\r\n");
});

test("an exported JSON file imports back to the same annotations", () => {
    const session = sampleSession();
    const text = JSON.stringify(core.exportSession(session), null, 2);
    const result = core.parseSessionFile(text, SIASE);
    assert.equal(result.ok, true);
    assert.equal(result.converted, false);
    assert.deepEqual(result.session.intervals, session.intervals);
    assert.deepEqual(result.session.labelset, SIASE);
    assert.deepEqual(result.session.video, session.video);
    assert.equal(result.session.lastId, 3);
    assert.equal(result.session.revision, undefined);
});

test("importing a DevSelfTrace v1 file converts it", () => {
    const result = core.parseSessionFile(JSON.stringify(v1), SIASE);
    assert.equal(result.ok, true);
    assert.equal(result.converted, true);
    assert.equal(result.session.intervals.length, 5);
    assert.equal(result.warnings.length, 2);
});

test("importing explains files it cannot use", () => {
    const cases = [
        ["{not json", /not valid JSON/],
        [JSON.stringify({ name: "S-IASE", dimensions: [] }), /not a DevSelfTrace annotation file/],
        [JSON.stringify({ intervals: [], labelset: { name: "Broken", dimensions: [] } }), /label set is not valid/],
        [JSON.stringify({ intervals: [{ id: 1, start: "soon" }] }), /interval 1 has no start or end time/],
    ];
    for (const [text, message] of cases) {
        const result = core.parseSessionFile(text, SIASE);
        assert.equal(result.ok, false, text);
        assert.match(result.error, message);
    }
});

test("an imported file without a label set is read with the default one", () => {
    const result = core.parseSessionFile(JSON.stringify({ intervals: [{ id: 1, start: 0, end: 1, duration: 1, intention: "x" }] }), SIASE);
    assert.equal(result.ok, true);
    assert.equal(result.session.labelset, SIASE);
});
