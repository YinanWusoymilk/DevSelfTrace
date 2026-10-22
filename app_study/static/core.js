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

    // ---- Label sets ------------------------------------------------------------
    // A label set lists the dimensions a participant answers for every interval.
    // Each dimension is "single" (pick one option) or "pairs" (add one or more
    // pairs of two fields, e.g. action + supporting tool). See labels/*.json.

    const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

    function isText(value) {
        return typeof value === "string" && value.trim() !== "";
    }

    // Options may be plain strings or { value, hint } objects; returns { value, hint? } objects
    function normalizeOptions(raw, path, errors) {
        if (!Array.isArray(raw) || raw.length === 0) {
            errors.push(`${path}: needs a non-empty list of options`);
            return [];
        }
        const seen = new Set();
        const options = [];
        raw.forEach((item, i) => {
            const option = typeof item === "string" ? { value: item } : item;
            if (!option || !isText(option.value)) {
                errors.push(`${path}[${i}]: an option needs a non-empty "value"`);
                return;
            }
            if (option.hint !== undefined && typeof option.hint !== "string") {
                errors.push(`${path}[${i}]: "hint" must be text`);
            }
            if (seen.has(option.value)) errors.push(`${path}[${i}]: duplicate option "${option.value}"`);
            seen.add(option.value);
            options.push(isText(option.hint) ? { value: option.value, hint: option.hint } : { value: option.value });
        });
        return options;
    }

    // Check a label set and fill in defaults. Returns { ok, errors, labelset }.
    function validateLabelset(raw) {
        const errors = [];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return { ok: false, errors: ["A label set must be a JSON object."] };
        }
        if (!isText(raw.name)) errors.push('"name" is required');
        if (!Array.isArray(raw.dimensions) || raw.dimensions.length === 0) {
            errors.push('"dimensions" must be a non-empty list');
            return { ok: false, errors: errors };
        }

        const ids = new Set();
        const dimensions = raw.dimensions.map((dim, i) => {
            const path = `dimensions[${i}]`;
            if (!dim || typeof dim !== "object") {
                errors.push(`${path}: must be an object`);
                return null;
            }
            if (typeof dim.id !== "string" || !ID_PATTERN.test(dim.id)) {
                errors.push(`${path}: "id" must start with a letter and contain only letters, digits, "-" or "_"`);
            } else if (ids.has(dim.id)) {
                errors.push(`${path}: duplicate id "${dim.id}"`);
            }
            ids.add(dim.id);
            if (!isText(dim.label)) errors.push(`${path}: "label" is required`);

            const result = {
                id: dim.id,
                label: dim.label,
                prompt: isText(dim.prompt) ? dim.prompt : dim.label,
                type: dim.type,
                allowCustom: dim.allowCustom !== false,
                placeholder: isText(dim.placeholder) ? dim.placeholder : "Select an option",
            };
            if (dim.type === "single") {
                result.options = normalizeOptions(dim.options, `${path}.options`, errors);
            } else if (dim.type === "pairs") {
                if (!Array.isArray(dim.fields) || dim.fields.length !== 2) {
                    errors.push(`${path}: a "pairs" dimension needs exactly 2 "fields"`);
                    result.fields = [];
                } else {
                    const fieldIds = new Set();
                    result.fields = dim.fields.map((field, j) => {
                        const fieldPath = `${path}.fields[${j}]`;
                        if (!field || typeof field !== "object") {
                            errors.push(`${fieldPath}: must be an object`);
                            return null;
                        }
                        if (typeof field.id !== "string" || !ID_PATTERN.test(field.id)) {
                            errors.push(`${fieldPath}: "id" must start with a letter and contain only letters, digits, "-" or "_"`);
                        } else if (fieldIds.has(field.id)) {
                            errors.push(`${fieldPath}: duplicate id "${field.id}"`);
                        }
                        fieldIds.add(field.id);
                        if (!isText(field.label)) errors.push(`${fieldPath}: "label" is required`);
                        return {
                            id: field.id,
                            label: field.label,
                            placeholder: isText(field.placeholder) ? field.placeholder : "Select an option",
                            optional: field.optional === true,
                            options: normalizeOptions(field.options, `${fieldPath}.options`, errors),
                        };
                    });
                    if (result.fields.every((field) => !field || field.optional)) {
                        errors.push(`${path}: at least one of the two fields must not be optional`);
                    }
                }
            } else {
                errors.push(`${path}: "type" must be "single" or "pairs"`);
            }
            return result;
        });

        if (errors.length > 0) return { ok: false, errors: errors };
        const labelset = { name: raw.name, dimensions: dimensions };
        if (isText(raw.description)) labelset.description = raw.description;
        if (isText(raw.source)) labelset.source = raw.source;
        return { ok: true, errors: [], labelset: labelset };
    }

    function sameLabelset(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    // Decide which label set a session uses.
    //   stored    - label set saved with the session (null for older files, made with the default)
    //   requested - label set asked for by ?labels= or server.py --labels (null if none)
    //   hasLogs   - whether the session already has annotations
    //   fallback  - the default label set
    // Annotations are never relabeled: once a session has logs, its label set stays.
    function resolveLabelset(stored, requested, hasLogs, fallback) {
        if (hasLogs) {
            const current = stored || fallback;
            const warning = requested && !sameLabelset(requested, current)
                ? `This session already has annotations made with the "${current.name}" label set, so "${requested.name}" was not applied. Start a new session to use it.`
                : null;
            return { labelset: current, warning: warning };
        }
        return { labelset: requested || stored || fallback, warning: null };
    }

    // ---- Annotations -------------------------------------------------------------
    // selection maps a dimension id to the chosen option (single) or a list of [a, b] pairs.

    function hasAnswer(dimension, value) {
        if (dimension.type === "pairs") return Array.isArray(value) && value.length > 0;
        return isText(value) && value !== "N/A";
    }

    function formatAnswer(dimension, value) {
        if (dimension.type === "pairs") return formatActionToolPairs(value || []);
        return value || "N/A";
    }

    // True when every dimension has an answer (required before adding a log)
    function isSelectionComplete(labelset, selection) {
        return labelset.dimensions.every((dim) => hasAnswer(dim, selection[dim.id]));
    }

    // Build a new log entry; dimension i is stored as Label<i+1>
    function createLog(logs, startTime, endTime, labelset, selection) {
        const log = {
            ID: logs.length + 1,
            Timestamps: { start: startTime, end: endTime },
            TimeInState: (endTime - startTime).toFixed(3),
        };
        labelset.dimensions.forEach((dim, i) => {
            log[`Label${i + 1}`] = formatAnswer(dim, selection[dim.id]);
        });
        return log;
    }

    // Apply an edit to an existing log; dimensions left unanswered keep their old value
    function applyEdit(log, labelset, selection) {
        labelset.dimensions.forEach((dim, i) => {
            const key = `Label${i + 1}`;
            if (hasAnswer(dim, selection[dim.id])) {
                log[key] = formatAnswer(dim, selection[dim.id]);
            } else if (!log[key]) {
                log[key] = "N/A";
            }
        });
        return log;
    }

    // One-line summary of the current selection, e.g. "Q1: x, Q2: [a, b], Q3: None"
    function describeSelection(labelset, selection) {
        return labelset.dimensions
            .map((dim, i) => {
                const value = selection[dim.id];
                const text = dim.type === "pairs" ? describeActionToolPairs(value || []) : value || "None";
                return `Q${i + 1}: ${text}`;
            })
            .join(", ");
    }

    return {
        formatTime: formatTime,
        formatTimeForDisplay: formatTimeForDisplay,
        formatActionToolPairs: formatActionToolPairs,
        describeActionToolPairs: describeActionToolPairs,
        escapeHtml: escapeHtml,
        validateLabelset: validateLabelset,
        resolveLabelset: resolveLabelset,
        isSelectionComplete: isSelectionComplete,
        createLog: createLog,
        applyEdit: applyEdit,
        describeSelection: describeSelection,
    };
});
