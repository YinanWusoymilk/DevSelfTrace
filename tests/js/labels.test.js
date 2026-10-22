// Tests for the bundled label sets in labels/*.json (run with: node --test tests/js/*.test.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../../app_study/static/core.js");
const bundle = require("../../app_study/static/presets.js");

const LABELS_DIR = path.join(__dirname, "..", "..", "labels");
const files = fs.readdirSync(LABELS_DIR).filter((name) => name.endsWith(".json")).sort();

test("presets.js contains exactly labels/*.json (run scripts/build_presets.py after editing them)", () => {
    const fromFiles = {};
    for (const name of files) {
        fromFiles[name.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(LABELS_DIR, name), "utf8"));
    }
    assert.deepEqual(bundle.presets, fromFiles);
    assert.ok(bundle.presets[bundle.defaultId], "the default preset exists");
});

for (const name of files) {
    test(`labels/${name} is a valid label set`, () => {
        const raw = JSON.parse(fs.readFileSync(path.join(LABELS_DIR, name), "utf8"));
        const result = core.validateLabelset(raw);
        assert.deepEqual(result.errors, []);
    });
}

// The default label set must stay the one the 84 study participants annotated with
// (the options of DevSelfTrace v1, before label sets became configurable).
test("the default S-IASE label set matches the options used in the study", () => {
    const siase = core.validateLabelset(bundle.presets["s-iase"]).labelset;
    const [intention, actions, emotion] = siase.dimensions;
    const values = (options) => options.map((option) => option.value);

    assert.deepEqual(values(intention.options), [
        "To Understand Context", "To Clarify Requirements/ Ambiguities", "To Understand Required Knowledge",
        "To Design/Plan New Code", "To Set Up Project Environment", "To Explore Alternative Solutions",
        "To Evaluate Suggestions", "To Verify Existing Code", "To Implement Code", "To Resolve Errors",
        "To Optimize Code", "Do Nothing",
    ]);
    assert.ok(intention.options.every((option) => option.hint), "every intention has a hover hint");
    assert.equal(intention.allowCustom, true);

    assert.equal(actions.type, "pairs");
    assert.deepEqual(values(actions.fields[0].options), [
        "Configuration", "Reading and Comprehension", "Executing the Code", "Waiting", "Search",
        "Writing New Code", "Editing Existing Code", "Crafting Query/Prompt", "Editing Query/Prompt",
        "Accepting the results returned by supporting tools", "Rejecting the results returned by supporting tools",
        "Refining the results returned by supporting tools", "Writing Documentation", "Running Tests", "Logging",
        "Watching Program Status",
    ]);
    assert.deepEqual(values(actions.fields[1].options), [
        "AI Tools", "IDE", "Search Engine", "Database Tools", "Compiler", "Static Program Analysis",
        "Proprietary Developer Platform (e.g. Github)", "Not using any tools",
    ]);
    assert.equal(actions.fields[1].optional, true);

    assert.deepEqual(values(emotion.options), [
        "Extremely Negative", "Negative", "Slightly Negative", "Neutral", "Slightly Positive", "Positive", "Extremely Positive",
    ]);
    assert.equal(emotion.allowCustom, false);
});

test("the CUPS preset has the 12 CUPS states and no custom labels", () => {
    const cups = core.validateLabelset(bundle.presets.cups).labelset;
    assert.equal(cups.dimensions.length, 1);
    assert.equal(cups.dimensions[0].options.length, 12);
    assert.equal(cups.dimensions[0].allowCustom, false);
    assert.match(cups.source, /microsoft\/coderec_programming_states/);
});
