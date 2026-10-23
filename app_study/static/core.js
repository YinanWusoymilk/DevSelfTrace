// DevSelfTrace core: pure helpers with no access to the page.
// Loaded as a plain <script> in the browser (exposes window.DSTCore)
// and with require() in the tests.
(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.DSTCore = api;
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Format seconds to [minutes:seconds] format for the logs table
    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = (seconds % 60).toFixed(0).padStart(2, "0");
        return `${minutes}:${remainingSeconds}`;
    }

    // Format time for display in mins:secs next to the start/end buttons
    function formatTimeForDisplay(seconds) {
        if (!seconds) return "None"; // Handle cases where time is not set
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
    }

    // Serialize action-tool pairs the way they are stored in Label2, e.g. "([A, T]; [A2, T2])"
    function formatActionToolPairs(pairs) {
        return `(${pairs.map((pair) => `[${pair[0]}, ${pair[1]}]`).join("; ")})`;
    }

    // Text for the "Selected States" box, e.g. "[A, T], [A2, T2]"
    function describeActionToolPairs(pairs) {
        if (pairs.length === 0) return "None";
        return pairs
            .map((pair) => {
                const action = pair[0] || "Undefined Action";
                const tool = pair[1] || "Undefined Tool";
                return `[${action}, ${tool}]`;
            })
            .join(", ");
    }

    // Escape text before it is inserted with innerHTML (custom labels are free text)
    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    // Build a new log entry from the current selection
    function createLog(logs, startTime, endTime, intention, actionToolPairs, emotion) {
        return {
            ID: logs.length + 1,
            Timestamps: { start: startTime, end: endTime },
            TimeInState: (endTime - startTime).toFixed(3),
            Label1: intention || "N/A",
            Label2: formatActionToolPairs(actionToolPairs),
            Label3: emotion || "N/A",
        };
    }

    // Apply an edit to an existing log; fields left empty keep their old value
    function applyEdit(log, intention, actionToolPairs, emotion) {
        log.Label1 = intention || log.Label1 || "N/A";
        if (actionToolPairs.length > 0) {
            log.Label2 = formatActionToolPairs(actionToolPairs);
        }
        log.Label3 = emotion || log.Label3 || "N/A";
        return log;
    }

    return {
        formatTime: formatTime,
        formatTimeForDisplay: formatTimeForDisplay,
        formatActionToolPairs: formatActionToolPairs,
        describeActionToolPairs: describeActionToolPairs,
        escapeHtml: escapeHtml,
        createLog: createLog,
        applyEdit: applyEdit,
    };
});
