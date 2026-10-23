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

    // Format seconds as m:ss, counting whole seconds like the video player does (119.6 -> "1:59")
    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(seconds));
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    }

    // Same, for the start/end display: "None" until a time is set (0 seconds is a real time)
    function formatTimeForDisplay(seconds) {
        if (seconds === null || seconds === undefined) return "None";
        return formatTime(seconds);
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
    const RESERVED_KEYS = ["id", "start", "end", "duration"]; // interval fields; dimension ids become keys next to them

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
            } else if (RESERVED_KEYS.includes(dim.id)) {
                errors.push(`${path}: "id" cannot be ${RESERVED_KEYS.map((key) => `"${key}"`).join(", ")}`);
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

    // ---- Annotations (session format v2) ----------------------------------------
    // A session is
    //   { tool: "DevSelfTrace", schemaVersion: 2, revision, labelset, video: { name, duration },
    //     lastId (highest interval ID ever given), intervals: [...] }
    // and every interval stores one key per dimension id, e.g. with S-IASE:
    //   { id: 3, start: 95.248, end: 190.112, duration: 94.864,
    //     intention: "To Implement Code",
    //     actions: [{ action: "Writing New Code", tool: "AI Tools" }],
    //     emotion: "Positive" }
    // A "single" answer is a string; a "pairs" answer is a list of objects keyed by field id,
    // with null for an optional field left empty.
    // selection (the answers being chosen in the page) uses the same shapes.

    const SCHEMA_VERSION = 2;

    function emptySession() {
        return { tool: "DevSelfTrace", schemaVersion: SCHEMA_VERSION, intervals: [] };
    }

    function hasAnswer(dimension, value) {
        if (dimension.type === "pairs") return Array.isArray(value) && value.length > 0;
        return isText(value);
    }

    // True when every dimension has an answer (required before adding an interval)
    function isSelectionComplete(labelset, selection) {
        return labelset.dimensions.every((dim) => hasAnswer(dim, selection[dim.id]));
    }

    // IDs are never reused, even after deletions: lastId (saved with the session) is the highest ID ever given
    function nextId(intervals, lastId) {
        return intervals.reduce((max, interval) => Math.max(max, interval.id || 0), lastId || 0) + 1;
    }

    function roundSeconds(seconds) {
        return Math.round(seconds * 1000) / 1000;
    }

    function copyAnswer(dimension, value) {
        if (dimension.type === "pairs") return value.map((pair) => Object.assign({}, pair));
        return value;
    }

    // Build a new interval from the current selection
    function createInterval(intervals, startTime, endTime, labelset, selection, lastId) {
        const interval = {
            id: nextId(intervals, lastId),
            start: startTime,
            end: endTime,
            duration: roundSeconds(endTime - startTime),
        };
        labelset.dimensions.forEach((dim) => {
            interval[dim.id] = hasAnswer(dim, selection[dim.id]) ? copyAnswer(dim, selection[dim.id]) : null;
        });
        return interval;
    }

    // Apply an edit to an existing interval; dimensions left unanswered keep their old value
    function applyEdit(interval, labelset, selection) {
        labelset.dimensions.forEach((dim) => {
            if (hasAnswer(dim, selection[dim.id])) interval[dim.id] = copyAnswer(dim, selection[dim.id]);
        });
        return interval;
    }

    // Intervals that share some time with start..end (touching at an edge does not count)
    function findOverlaps(intervals, start, end, ignoreId) {
        return intervals.filter((interval) => interval.id !== ignoreId && start < interval.end && end > interval.start);
    }

    // Keep a row index inside the list after rows were removed (0 for an empty list)
    function clampIndex(index, length) {
        if (length === 0) return 0;
        return Math.min(Math.max(index, 0), length - 1);
    }

    // Keep intervals in video order
    function sortIntervals(intervals) {
        return intervals.sort((a, b) => a.start - b.start || a.id - b.id);
    }

    // Text for one answer in the logs table, e.g. "[Writing New Code, AI Tools]; [Search, —]"
    function formatValue(dimension, value) {
        if (dimension.type === "pairs") {
            if (!Array.isArray(value) || value.length === 0) return "—";
            return value
                .map((pair) => `[${dimension.fields.map((field) => pair[field.id] || "—").join(", ")}]`)
                .join("; ");
        }
        return isText(value) ? value : "—";
    }

    // One-line summary of the current selection, e.g. "Q1: x, Q2: [a, b], Q3: None"
    function describeSelection(labelset, selection) {
        return labelset.dimensions
            .map((dim, i) => `Q${i + 1}: ${hasAnswer(dim, selection[dim.id]) ? formatValue(dim, selection[dim.id]) : "None"}`)
            .join(", ");
    }

    // ---- Older files (format v1) ---------------------------------------------------
    // DevSelfTrace v1 (used in the FSE'26 study) saved
    //   { logs: [{ ID, Timestamps: { start, end }, TimeInState, Label1, Label2, Label3 }] }
    // where Label<i> is the answer to dimension i and a pairs answer is a string such as
    //   "([Writing New Code, AI Tools]; [Search, null])"
    // scripts/convert_v1_to_v2.py does the same conversion for batches of files.

    function isV1Session(data) {
        return Boolean(data) && Array.isArray(data.logs) && !Array.isArray(data.intervals);
    }

    function optionValues(options) {
        return new Set((options || []).map((option) => (typeof option === "string" ? option : option.value)));
    }

    // Split "A, T" into its two fields. Custom labels may themselves contain ", ", so prefer the
    // split where the first part is a known first-field option, else where the second part is a
    // known second-field option (or "null"), else the last ", ".
    function splitV1Pair(text, dimension) {
        const firstKnown = optionValues(dimension.fields[0].options);
        const secondKnown = optionValues(dimension.fields[1].options);
        const cuts = [];
        for (let i = text.indexOf(", "); i !== -1; i = text.indexOf(", ", i + 1)) cuts.push(i);
        if (cuts.length === 0) return { parts: [text, null], ambiguous: false };
        const at = (i) => [text.slice(0, i), text.slice(i + 2)];
        const byFirst = cuts.find((i) => firstKnown.has(text.slice(0, i)));
        if (byFirst !== undefined) return { parts: at(byFirst), ambiguous: false };
        const bySecond = cuts.find((i) => {
            const second = text.slice(i + 2);
            return second === "null" || secondKnown.has(second);
        });
        if (bySecond !== undefined) return { parts: at(bySecond), ambiguous: false };
        return { parts: at(cuts[cuts.length - 1]), ambiguous: cuts.length > 1 };
    }

    // Parse a v1 pairs string into [{ <field0>: a, <field1>: b }, ...]
    function parseV1Pairs(text, dimension) {
        const result = { pairs: [], ambiguous: [] };
        if (!isText(text) || text === "N/A") return result;
        let body = text.trim();
        if (body.startsWith("(") && body.endsWith(")")) body = body.slice(1, -1).trim();
        if (body.startsWith("[")) body = body.slice(1);
        if (body.endsWith("]")) body = body.slice(0, -1);
        if (body === "") return result;
        body.split("]; [").forEach((pairText) => {
            const split = splitV1Pair(pairText, dimension);
            const pair = {};
            dimension.fields.forEach((field, i) => {
                const value = split.parts[i];
                pair[field.id] = value === undefined || value === null || value === "null" || value === "" ? null : value;
            });
            result.pairs.push(pair);
            if (split.ambiguous) result.ambiguous.push({ text: pairText, pair: pair });
        });
        return result;
    }

    // Convert a v1 session. labelset is the label set the logs were made with
    // (the one saved in the file by DevSelfTrace 2 previews, else the default S-IASE).
    function convertV1(data, labelset) {
        const warnings = [];
        const session = emptySession();
        if (typeof data.revision === "number") session.revision = data.revision;
        session.labelset = labelset;
        const seen = new Set();
        const needNewId = []; // missing or repeated IDs (older versions could repeat an ID after a deletion)

        data.logs.forEach((log, n) => {
            const timestamps = log.Timestamps || {};
            const start = Number(timestamps.start);
            const end = Number(timestamps.end);
            const interval = { id: log.ID, start: start, end: end, duration: roundSeconds(end - start) };
            labelset.dimensions.forEach((dim, i) => {
                const raw = log[`Label${i + 1}`];
                if (dim.type === "pairs") {
                    const parsed = parseV1Pairs(raw, dim);
                    interval[dim.id] = parsed.pairs.length > 0 ? parsed.pairs : null;
                    parsed.ambiguous.forEach((item) => {
                        const reading = dim.fields.map((field) => `${field.label.toLowerCase()} "${item.pair[field.id]}"`).join(" + ");
                        warnings.push(`Log ${log.ID}: "[${item.text}]" can be split more than one way; read as ${reading}.`);
                    });
                } else {
                    interval[dim.id] = isText(raw) && raw !== "N/A" ? raw : null;
                }
            });
            if (!Number.isInteger(interval.id) || seen.has(interval.id)) {
                needNewId.push(interval);
                warnings.push(`Log ${n + 1} (ID ${JSON.stringify(log.ID)}) had a missing or repeated ID; it was given a new one.`);
            } else {
                seen.add(interval.id);
            }
            session.intervals.push(interval);
        });
        let maxId = Math.max(0, ...seen);
        needNewId.forEach((interval) => {
            maxId += 1;
            interval.id = maxId;
        });
        session.lastId = maxId;
        sortIntervals(session.intervals);
        return { session: session, warnings: warnings };
    }

    // Accept whatever a file or the browser holds and return a v2 session.
    //   labelsetForV1 - label set to read v1 logs with when the file does not name one
    // Returns { session, converted, warnings }.
    function normalizeSession(data, labelsetForV1) {
        if (!data || typeof data !== "object") return { session: emptySession(), converted: false, warnings: [] };
        if (isV1Session(data)) {
            let labelset = labelsetForV1;
            if (data.labelset) {
                const checked = validateLabelset(data.labelset);
                if (checked.ok) labelset = checked.labelset;
            }
            const result = convertV1(data, labelset);
            return { session: result.session, converted: true, warnings: result.warnings };
        }
        const session = Object.assign(emptySession(), data);
        if (!Array.isArray(session.intervals)) session.intervals = [];
        return { session: session, converted: false, warnings: [] };
    }

    // ---- Export and import ---------------------------------------------------------

    // e.g. "devselftrace_p01_recording_20261022-2015.json"
    function exportFileName(session, extension, now) {
        const date = now || new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
        const videoName = session.video && isText(session.video.name) ? session.video.name.replace(/\.[^.]+$/, "") : "";
        const base = videoName.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "session";
        return `devselftrace_${base}_${stamp}.${extension}`;
    }

    // The session as written to an exported JSON file (revision only matters for saving in place)
    function exportSession(session) {
        const copy = JSON.parse(JSON.stringify(session));
        delete copy.revision;
        return copy;
    }

    // Quote a CSV field when needed (RFC 4180)
    function csvField(value) {
        const text = value === null || value === undefined ? "" : String(value);
        return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    // One row per interval. A "pairs" dimension becomes one column per field (e.g. actions.action,
    // actions.tool) listing the pairs' values in the same order, separated by "; ".
    function sessionToCsv(session, labelset) {
        const header = ["id", "start", "end", "duration"];
        labelset.dimensions.forEach((dim) => {
            if (dim.type === "pairs") dim.fields.forEach((field) => header.push(`${dim.id}.${field.id}`));
            else header.push(dim.id);
        });
        const rows = session.intervals.map((interval) => {
            const row = [interval.id, interval.start, interval.end, interval.duration];
            labelset.dimensions.forEach((dim) => {
                const value = interval[dim.id];
                if (dim.type === "pairs") {
                    const pairs = Array.isArray(value) ? value : [];
                    dim.fields.forEach((field) => row.push(pairs.map((pair) => pair[field.id] ?? "").join("; ")));
                } else {
                    row.push(value);
                }
            });
            return row;
        });
        return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
    }

    // Read an annotation file (exported, saved by server.py, or from DevSelfTrace v1).
    // Returns { ok: true, session, converted, warnings } or { ok: false, error }.
    function parseSessionFile(text, defaultLabelset) {
        let data;
        try {
            data = JSON.parse(text);
        } catch (error) {
            return { ok: false, error: `it is not valid JSON (${error.message})` };
        }
        if (!data || typeof data !== "object" || (!Array.isArray(data.intervals) && !Array.isArray(data.logs))) {
            return { ok: false, error: 'it is not a DevSelfTrace annotation file (there is no "intervals" or "logs" list)' };
        }
        if (data.labelset) {
            const checked = validateLabelset(data.labelset);
            if (!checked.ok) return { ok: false, error: `its label set is not valid (${checked.errors.slice(0, 3).join("; ")})` };
            data.labelset = checked.labelset;
        } else if (Array.isArray(data.intervals)) {
            data.labelset = defaultLabelset;
        }
        const result = normalizeSession(data, defaultLabelset);
        const broken = result.session.intervals.findIndex((interval) => typeof interval.start !== "number" || typeof interval.end !== "number");
        if (broken !== -1) return { ok: false, error: `interval ${broken + 1} has no start or end time` };
        delete result.session.revision;
        return { ok: true, session: result.session, converted: result.converted, warnings: result.warnings };
    }

    return {
        SCHEMA_VERSION: SCHEMA_VERSION,
        formatTime: formatTime,
        formatTimeForDisplay: formatTimeForDisplay,
        escapeHtml: escapeHtml,
        validateLabelset: validateLabelset,
        resolveLabelset: resolveLabelset,
        emptySession: emptySession,
        isSelectionComplete: isSelectionComplete,
        nextId: nextId,
        createInterval: createInterval,
        applyEdit: applyEdit,
        sortIntervals: sortIntervals,
        findOverlaps: findOverlaps,
        clampIndex: clampIndex,
        formatValue: formatValue,
        describeSelection: describeSelection,
        isV1Session: isV1Session,
        parseV1Pairs: parseV1Pairs,
        convertV1: convertV1,
        normalizeSession: normalizeSession,
        exportFileName: exportFileName,
        exportSession: exportSession,
        csvField: csvField,
        sessionToCsv: sessionToCsv,
        parseSessionFile: parseSessionFile,
    };
});
