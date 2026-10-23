// A made-up annotation session for trying DevSelfTrace. It is NOT data from any study participant.
// Loaded by the "Load sample" button. It is a script rather than a JSON file so that it also
// works when index.html is opened straight from disk.
(function (root) {
    var sample = {
        tool: "DevSelfTrace",
        schemaVersion: 2,
        note: "Made-up example: a developer using an AI assistant to write a Python script against the GitHub REST API. Not data from any participant.",
        lastId: 9,
        intervals: [
            { id: 1, start: 0, end: 42.5, duration: 42.5, intention: "To Understand Context",
              actions: [{ action: "Reading and Comprehension", tool: "IDE" }], emotion: "Neutral" },
            { id: 2, start: 42.5, end: 80, duration: 37.5, intention: "To Clarify Requirements/ Ambiguities",
              actions: [{ action: "Search", tool: "Search Engine" },
                        { action: "Reading and Comprehension", tool: "Proprietary Developer Platform (e.g. Github)" }],
              emotion: "Slightly Negative" },
            { id: 3, start: 80, end: 118, duration: 38, intention: "To Design/Plan New Code",
              actions: [{ action: "Crafting Query/Prompt", tool: "AI Tools" }, { action: "Waiting", tool: "AI Tools" }],
              emotion: "Neutral" },
            { id: 4, start: 118, end: 171, duration: 53, intention: "To Evaluate Suggestions",
              actions: [{ action: "Reading and Comprehension", tool: "AI Tools" },
                        { action: "Accepting the results returned by supporting tools", tool: "AI Tools" }],
              emotion: "Slightly Positive" },
            { id: 5, start: 171, end: 214, duration: 43, intention: "To Implement Code",
              actions: [{ action: "Editing Existing Code", tool: "IDE" }, { action: "Executing the Code", tool: "IDE" }],
              emotion: "Positive" },
            { id: 6, start: 214, end: 262, duration: 48, intention: "To Resolve Errors",
              actions: [{ action: "Watching Program Status", tool: "IDE" }, { action: "Editing Query/Prompt", tool: "AI Tools" }],
              emotion: "Negative" },
            { id: 7, start: 262, end: 301, duration: 39, intention: "To Resolve Errors",
              actions: [{ action: "Refining the results returned by supporting tools", tool: "AI Tools" },
                        { action: "Running Tests", tool: "IDE" }],
              emotion: "Slightly Positive" },
            { id: 8, start: 301, end: 333.5, duration: 32.5, intention: "To Check API Rate Limits",
              actions: [{ action: "Search", tool: "Search Engine" }], emotion: "Neutral" },
            { id: 9, start: 333.5, end: 360, duration: 26.5, intention: "To Verify Existing Code",
              actions: [{ action: "Running Tests", tool: "IDE" }, { action: "Logging", tool: null }],
              emotion: "Extremely Positive" },
        ],
    };
    if (typeof module === "object" && module.exports) {
        module.exports = sample;
    } else {
        root.DSTSample = sample;
    }
})(typeof self !== "undefined" ? self : this);
