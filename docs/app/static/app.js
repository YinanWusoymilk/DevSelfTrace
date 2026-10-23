// DevSelfTrace UI: wires the page to DSTCore (static/core.js) and DSTStorage (static/storage.js)

// Storage backend, chosen at startup (server file or browser localStorage)
var store = null;
var autosave = null; // debounced, conflict-checked saving (DSTStorage.createAutosave)
var tabLock = null; // only one tab may edit a session at a time
var session = DSTCore.emptySession(); // the annotations being edited (format v2, see core.js)
var currentVideoName = null; // file name of the loaded video
var currentVideo = null; // { name, duration } of the loaded video, saved with the session when an interval is added

// Variables
var index_log = 0;
var autoPlay = false;
var startTime = null;
var endTime = null;

// HTML Elements
var video = document.getElementById("codeVideo");
var state_text = document.getElementById("state");
var button_prev = document.getElementById("prev_index");
var button_next = document.getElementById("next_index");
var button_auto_play = document.getElementById("autoPlay");
var button_replay = document.getElementById("replay_event");
var speed_slider = document.getElementById("speed_slider");
var table_events = document.getElementById("table_events");
var button_add_row = document.getElementById("addRow");
var button_delete_row = document.getElementById("deleteRow");
var button_edit_label = document.getElementById("editLabel");
var setStartTimeButton = document.getElementById("setStartTime");
var setEndTimeButton = document.getElementById("setEndTime");
var startTimeInput = document.getElementById("startTimeInput");
var endTimeInput = document.getElementById("endTimeInput");
var toastsEl = document.getElementById("toasts");
var saveStatusEl = document.getElementById("save-status");
var saveBannerEl = document.getElementById("save-banner");

// Label set (dimensions and options) and the answers chosen for the current interval
var labelset = null;
var selection = {}; // dimension id -> option (single) or list of pairs ({ field id -> value })
var pairDrafts = {}; // dimension id -> { field id -> value } for the pair being put together
var questionResets = []; // one function per question that clears its controls
var questionsContainer = document.getElementById("questionsView");
var labelsetSelect = document.getElementById("labelset-select");
var labelsetLoadButton = document.getElementById("labelset-load");
var labelsetFileInput = document.getElementById("labelset-file");
var labelsetLockNote = document.getElementById("labelset-lock");
var readOnly = false; // another tab is editing this session

// Pick the storage backend and load existing logs
async function initialization() {
    try {
        // The hosted copy (docs/app) and pages opened from disk never have a server to ask
        const declared = document.querySelector('meta[name="devselftrace-mode"]');
        const mode = location.protocol === "file:" ? "browser" : declared ? declared.content : "auto";
        store = await DSTStorage.detect(window.fetch.bind(window), window.localStorage, (message) => showBanner(message, [["Dismiss", hideBanner]]), mode);
        console.info(`DevSelfTrace running in ${store.mode} mode.`);
        const loaded = await store.load();
        // Older (v1) files are converted here; on the server the original was copied to <file>.v1.json at startup
        const normalized = DSTCore.normalizeSession(loaded.data, presetLabelset(DSTPresets.defaultId));
        session = normalized.session;
        if (loaded.videoPath) video.src = loaded.videoPath;
        currentVideoName = loaded.videoName;
        autosave = DSTStorage.createAutosave(store, {
            revision: loaded.revision,
            getData: () => session,
            onStatus: showSaveStatus,
        });
        showSaveStatus({ state: "saved", at: null });
        chooseInitialLabelset(loaded.labelset);

        if (normalized.converted && session.intervals.length > 0) {
            autoSaveLogs(); // store the converted (v2) version
            const kept = store.mode === "server" ? " The original file was kept next to it with the ending .v1.json." : "";
            const notes = normalized.warnings.length > 0 ? ` Notes: ${normalized.warnings.join(" ")}` : "";
            showBanner(`These annotations were saved by an older version of DevSelfTrace and have been converted to the current format.${kept}${notes}`, [["Dismiss", hideBanner]]);
        }

        tabLock = DSTStorage.createTabLock("devselftrace:session", {
            onReleased: () => showBanner("The other tab was closed. Reload this tab to edit here.", [["Reload", () => location.reload()]]),
        });
        if (!(await tabLock.claim())) enterReadOnly();
    } catch (error) {
        console.error("Failed to load logs.", error);
        showSaveStatus({ state: "error", message: "Could not load the annotations." });
    }
}

// Show where and when the logs were last saved, and explain any problem
function showSaveStatus(status) {
    const where = store && store.mode === "server" ? "to file" : "in this browser";
    let text = "";
    let level = "busy";
    switch (status.state) {
        case "saved":
            text = status.at ? `Saved ${where} · ${status.at.toLocaleTimeString()}` : `All changes saved ${where}`;
            level = "ok";
            if (saveBannerEl.dataset.kind === "save") hideBanner(); // the save problem is over; other notices stay
            break;
        case "pending":
            text = "Unsaved changes…";
            break;
        case "saving":
            text = "Saving…";
            break;
        case "error":
            level = "error";
            if (status.retryInMs) {
                text = `Not saved · retrying in ${Math.round(status.retryInMs / 1000)}s`;
                showBanner(`Could not save your annotations: ${status.message} Your work is still in this page.`, [
                    ["Retry now", () => autosave.flush()],
                    ["Export a backup", exportJson],
                ], "save");
            } else {
                text = status.message;
            }
            break;
        case "conflict":
            text = "Not saved · changed elsewhere";
            level = "error";
            showBanner("These annotations were changed somewhere else (another tab or program) after you loaded them.", [
                ["Load their version", loadRemoteVersion],
                ["Keep mine", () => autosave.overwrite()],
                ["Export mine", exportJson],
            ], "save");
            break;
        case "readonly":
            text = "Read-only";
            level = "readonly";
            break;
    }
    saveStatusEl.textContent = text;
    saveStatusEl.className = `save-status ${level}`;
}

// Banner with a message and action buttons (actions: [label, handler] pairs).
// kind "save" marks a save problem, which a later successful save clears; other notices stay until dismissed.
function showBanner(message, actions, kind) {
    saveBannerEl.dataset.kind = kind || "info";
    saveBannerEl.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    saveBannerEl.appendChild(text);
    actions.forEach(([label, handler]) => {
        const button = document.createElement("button");
        button.textContent = label;
        button.addEventListener("click", handler);
        saveBannerEl.appendChild(button);
    });
    saveBannerEl.classList.remove("hidden");
    saveBannerEl.scrollIntoView({ block: "nearest" }); // on a short window it may be below the fold
}

function hideBanner() {
    saveBannerEl.classList.add("hidden");
}

// Conflict: continue from the version saved elsewhere
function loadRemoteVersion() {
    const conflict = autosave.getConflict();
    if (!conflict) return; // already resolved
    session = conflict.data;
    autosave.acceptRemote();
    // The other version may use a different label set
    const checked = session.labelset ? DSTCore.validateLabelset(session.labelset) : null;
    applyLabelset(checked && checked.ok ? checked.labelset : presetLabelset(DSTPresets.defaultId));
}

// ---- Export, import, start over -----------------------------------------------

function downloadFile(name, text, type) {
    const blob = new Blob([text], { type: type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Download the annotations as JSON (the same format can be imported again)
function exportJson() {
    downloadFile(DSTCore.exportFileName(session, "json"), JSON.stringify(DSTCore.exportSession(session), null, 2) + "\n", "application/json");
}

// Download the annotations as a CSV table, one row per interval
function exportCsv() {
    downloadFile(DSTCore.exportFileName(session, "csv"), DSTCore.sessionToCsv(session, labelset), "text/csv");
}

// Replace the current annotations with those in an exported (or older DevSelfTrace) JSON file
async function importSession(file) {
    loadSessionText(await file.text(), `"${file.name}"`, `Imported {n} annotation(s) from "${file.name}"`);
}

// Try DevSelfTrace without your own data: a made-up session (static/sample.js), not from any participant
function loadSample() {
    loadSessionText(JSON.stringify(DSTSample), "the sample session", "Loaded the sample session: {n} made-up annotations, not data from any participant");
}

// Replace the current annotations with a session read from JSON text.
// done is the message shown afterwards; "{n}" becomes the number of annotations.
function loadSessionText(text, source, done) {
    const result = DSTCore.parseSessionFile(text, presetLabelset(DSTPresets.defaultId));
    if (!result.ok) {
        toast(`${source} could not be imported: ${result.error}.`, "error");
        return;
    }
    const replace = () => {
        session = result.session;
        index_log = 0;
        applyLabelset(session.labelset);
        autoSaveLogs();
        const converted = result.converted ? " (converted from the older DevSelfTrace format)" : "";
        const notes = result.warnings.length > 0 ? ` Notes: ${result.warnings.join(" ")}` : "";
        showBanner(`${done.replace("{n}", session.intervals.length)}${converted}.${notes}`, [["Dismiss", hideBanner]]);
    };
    const count = session.intervals.length;
    if (count === 0) {
        replace();
        return;
    }
    showBanner(`Replace the ${count} current annotation(s) with the ${result.session.intervals.length} in ${source}? Export the current ones first if you want to keep them.`, [
        ["Export current", exportJson],
        ["Replace", () => {
            hideBanner();
            replace();
        }],
        ["Cancel", hideBanner],
    ]);
}

// Clear the annotations (keeping the label set, which can then be changed)
function startOver() {
    const count = session.intervals.length;
    if (count === 0) {
        resetSession();
        return;
    }
    const where = store.mode === "server" ? "the logs file (the previous version stays in its .bak backups)" : "this browser";
    showBanner(`Start over? The ${count} current annotation(s) will be cleared from ${where}. Export them first to keep a copy.`, [
        ["Export JSON", exportJson],
        ["Start over", () => {
            hideBanner();
            resetSession();
        }],
        ["Cancel", hideBanner],
    ]);
}

function resetSession() {
    const keep = labelset;
    session = DSTCore.emptySession();
    index_log = 0;
    startTime = null;
    endTime = null;
    updateSelectedTimes();
    applyLabelset(keep);
    autoSaveLogs();
}

document.getElementById("export-json").addEventListener("click", exportJson);
document.getElementById("export-csv").addEventListener("click", exportCsv);
document.getElementById("import-json").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) importSession(file);
});
document.getElementById("start-over").addEventListener("click", startOver);
document.getElementById("load-sample").addEventListener("click", loadSample);

// Another tab is already editing this session
function enterReadOnly() {
    readOnly = true;
    autosave.setReadOnly(true);
    const editingControls = [button_add_row, button_delete_row, button_edit_label, labelsetSelect, labelsetLoadButton,
        document.getElementById("import-json"), document.getElementById("start-over"), document.getElementById("load-sample")];
    editingControls.forEach((button) => {
        button.disabled = true;
        button.title = "Read-only: this session is open in another tab";
    });
    showBanner("This session is already open in another tab. This tab is read-only so the two tabs cannot overwrite each other.", [
        ["Reload", () => location.reload()],
    ]);
}

// Warn before leaving with changes that are not saved yet; let other tabs know this one is gone
window.addEventListener("beforeunload", (event) => {
    if (autosave && autosave.isDirty()) {
        event.preventDefault();
        event.returnValue = "";
    }
});
window.addEventListener("pagehide", () => {
    if (tabLock) tabLock.release();
});

// Populate logs table
function populateLogsTable() {
    if (!labelset) return;
    // One column per dimension of the label set
    const escape = DSTCore.escapeHtml;
    const headers = labelset.dimensions.map((dim) => `<th>${escape(dim.label)}</th>`).join("");
    table_events.innerHTML = `
        <tr>
            <th>ID</th>
            <th>Time</th>
            ${headers}
        </tr>`;
    session.intervals.forEach((interval) => {
        const startTimestamp = DSTCore.formatTime(interval.start);
        const endTimestamp = DSTCore.formatTime(interval.end);
        const cells = labelset.dimensions.map((dim) => `<td>${escape(DSTCore.formatValue(dim, interval[dim.id]))}</td>`).join("");

        const row = table_events.insertRow();
        row.innerHTML = `
            <td>${escape(interval.id)}</td>
            <td>${startTimestamp} - ${endTimestamp}</td>
            ${cells}
        `;
    });
    updateLabelsetLock(); // adding the first log locks the label set, deleting the last one unlocks it
}

// ---- Label sets --------------------------------------------------------------

// A bundled label set (labels/*.json, packed into static/presets.js), checked and with defaults filled in
function presetLabelset(id) {
    const raw = DSTPresets.presets[id];
    return raw ? DSTCore.validateLabelset(raw).labelset : null;
}

// Pick the label set for this session: the one saved with it, else ?labels= or server.py --labels, else the default
function chooseInitialLabelset(serverLabelset) {
    const fallback = presetLabelset(DSTPresets.defaultId);
    const problems = [];

    let requested = null;
    if (serverLabelset) {
        const checked = DSTCore.validateLabelset(serverLabelset);
        if (checked.ok) requested = checked.labelset;
        else problems.push(`The label set given to server.py is not valid (${checked.errors.slice(0, 3).join("; ")}).`);
    } else {
        const id = new URLSearchParams(location.search).get("labels");
        if (id) {
            requested = presetLabelset(id);
            if (!requested) problems.push(`Unknown label set "${id}". Available: ${Object.keys(DSTPresets.presets).join(", ")}.`);
        }
    }

    let stored = null;
    if (session.labelset) {
        const checked = DSTCore.validateLabelset(session.labelset);
        if (checked.ok) stored = checked.labelset;
        else problems.push("The label set saved with this session is not valid; showing the default label set.");
    }

    const choice = DSTCore.resolveLabelset(stored, requested, session.intervals.length > 0, fallback);
    if (choice.warning) problems.push(choice.warning);
    applyLabelset(choice.labelset);
    if (problems.length > 0) showBanner(problems.join(" "), [["Dismiss", hideBanner]]);
}

// Use a label set: rebuild the questions, the picker and the table. It is saved with the session.
function applyLabelset(newLabelset) {
    labelset = newLabelset;
    session.labelset = newLabelset;
    renderQuestions();
    renderLabelsetPicker();
    populateLogsTable();
}

// Switching is only allowed before the first annotation, so logs never mix label sets
function switchLabelset(newLabelset) {
    if (session.intervals.length > 0) {
        toast(`This session already has annotations made with the "${labelset.name}" label set. Export them and click "Start over" to use a different label set.`, "error");
        renderLabelsetPicker();
        return;
    }
    applyLabelset(newLabelset);
    autoSaveLogs();
}

function renderLabelsetPicker() {
    labelsetSelect.replaceChildren();
    let matched = false;
    // Default label set first, then the others alphabetically
    const ids = Object.keys(DSTPresets.presets).sort((a, b) => (a === DSTPresets.defaultId ? -1 : b === DSTPresets.defaultId ? 1 : a.localeCompare(b)));
    ids.forEach((id) => {
        const preset = presetLabelset(id);
        const option = new Option(preset.name, id);
        if (JSON.stringify(preset) === JSON.stringify(labelset)) {
            option.selected = true;
            matched = true;
        }
        labelsetSelect.appendChild(option);
    });
    if (!matched) {
        const option = new Option(`${labelset.name} (from file)`, "");
        option.selected = true;
        labelsetSelect.appendChild(option);
    }
    updateLabelsetLock();
}

// Once a session has annotations its label set is fixed; show that instead of letting the picker snap back
function updateLabelsetLock() {
    const locked = session.intervals.length > 0;
    labelsetSelect.disabled = locked || readOnly;
    labelsetLoadButton.disabled = locked || readOnly;
    labelsetLockNote.classList.toggle("hidden", !locked);
    if (locked) {
        const why = "A session never mixes label sets, so the label set cannot change once there are annotations. To use another one, export the annotations and click \"Start over\".";
        // The note just says "Locked"; hovering (or focusing) it shows why
        labelsetLockNote.dataset.tip = `This session already has annotations made with "${labelset.name}". ${why}`;
        labelsetSelect.title = why;
        labelsetLoadButton.title = why;
    } else {
        labelsetSelect.title = labelset.description || "";
        labelsetLoadButton.title = "Load a label set from a JSON file";
    }
}

labelsetSelect.addEventListener("change", () => {
    const chosen = presetLabelset(labelsetSelect.value);
    if (chosen) switchLabelset(chosen);
});

labelsetLoadButton.addEventListener("click", () => labelsetFileInput.click());

labelsetFileInput.addEventListener("change", async () => {
    const file = labelsetFileInput.files[0];
    labelsetFileInput.value = "";
    if (!file) return;
    let raw;
    try {
        raw = JSON.parse(await file.text());
    } catch (error) {
        toast(`"${file.name}" is not valid JSON: ${error.message}`, "error");
        return;
    }
    const checked = DSTCore.validateLabelset(raw);
    if (!checked.ok) {
        toast(`"${file.name}" is not a valid label set: ${checked.errors.slice(0, 5).join("; ")}`, "error");
        return;
    }
    switchLabelset(checked.labelset);
});

// ---- Questions ---------------------------------------------------------------
// One block per dimension of the label set: its name, question and optional help text, then a dropdown
// ("single") or a row of dropdowns that adds pairs shown as removable chips ("pairs").
// Where custom labels are allowed, the dropdown ends with "Other", which opens a text box in place.

const OTHER = "__other__";

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// A dropdown, the text box for "Other", and a line showing the chosen option's hint.
// onChange receives the chosen option, the typed text, or "" while nothing is chosen.
function choiceControl(placeholder, options, allowCustom, label, onChange) {
    const wrap = element("div", "choice");
    const select = element("select", "dimension-select");
    const first = new Option(placeholder, "");
    first.disabled = true;
    first.selected = true;
    select.appendChild(first);
    options.forEach((option) => {
        const item = new Option(option.value, option.value);
        if (option.hint) item.title = option.hint;
        select.appendChild(item);
    });
    if (allowCustom) select.appendChild(new Option("Other (type your own)", OTHER));

    const other = element("input", "other-input hidden");
    other.type = "text";
    other.placeholder = `Type your own ${label.toLowerCase()}`;
    const hint = element("div", "option-hint hidden");
    const hints = new Map(options.filter((option) => option.hint).map((option) => [option.value, option.hint]));

    const report = () => onChange(select.value === OTHER ? other.value.trim() : select.value);
    select.addEventListener("change", () => {
        const isOther = select.value === OTHER;
        other.classList.toggle("hidden", !isOther);
        if (isOther) other.focus();
        const text = hints.get(select.value) || "";
        hint.textContent = text; // also shown here because some browsers do not show hover text on options
        hint.classList.toggle("hidden", !text);
        report();
    });
    other.addEventListener("input", report);

    wrap.append(select, other, hint);
    wrap.other = other;
    wrap.reset = () => {
        select.value = "";
        other.value = "";
        other.classList.add("hidden");
        hint.classList.add("hidden");
    };
    return wrap;
}

function renderQuestions() {
    selection = {};
    pairDrafts = {};
    questionResets = [];
    questionsContainer.replaceChildren();
    labelset.dimensions.forEach((dim) => {
        const block = element("section", "dimension");
        block.appendChild(element("h3", "dimension-title", dim.label));
        if (dim.prompt !== dim.label) block.appendChild(element("p", "dimension-prompt", dim.prompt));
        if (dim.help) block.appendChild(element("p", "dimension-help", dim.help));
        if (dim.type === "pairs") renderPairsQuestion(block, dim);
        else renderSingleQuestion(block, dim);
        questionsContainer.appendChild(block);
    });
    updateSummary();
}

function renderSingleQuestion(block, dim) {
    const choice = choiceControl(dim.placeholder, dim.options, dim.allowCustom, dim.label, (value) => {
        selection[dim.id] = value;
        updateSummary();
    });
    block.appendChild(choice);
    questionResets.push(choice.reset);
}

function renderPairsQuestion(block, dim) {
    pairDrafts[dim.id] = {};
    const row = element("div", "pair-row");
    const choices = dim.fields.map((field) => {
        const choice = choiceControl(field.placeholder, field.options, dim.allowCustom, field.label, (value) => {
            pairDrafts[dim.id][field.id] = value;
        });
        choice.classList.add("pair-field");
        // Small caption above each dropdown, so the dropdown itself can stay short
        choice.prepend(element("div", "field-label", field.optional ? `${field.label} (optional)` : field.label));
        row.appendChild(choice);
        return choice;
    });
    const addButton = element("button", "pair-add", "+ Add");
    addButton.title = `Add this ${dim.label.toLowerCase()}; an interval can have several`;
    row.appendChild(addButton);
    const chips = element("div", "chips");

    const renderChips = () => {
        chips.replaceChildren();
        const pairs = selection[dim.id] || [];
        if (pairs.length === 0) {
            chips.appendChild(element("span", "chips-empty", `No ${dim.label.toLowerCase()} added yet`));
            return;
        }
        pairs.forEach((pair, i) => {
            const text = dim.fields.map((field) => pair[field.id]).filter(Boolean).join(" · ");
            const chip = element("span", "chip", text);
            const remove = element("button", "", "×");
            remove.title = "Remove";
            remove.setAttribute("aria-label", `Remove ${text}`);
            remove.addEventListener("click", () => {
                selection[dim.id] = pairs.filter((_, j) => j !== i);
                renderChips();
                updateSummary();
            });
            chip.appendChild(remove);
            chips.appendChild(chip);
        });
    };

    const addPair = () => {
        const draft = pairDrafts[dim.id];
        const missing = dim.fields.find((field) => !field.optional && !draft[field.id]);
        if (missing) {
            toast(`Choose the ${missing.label.toLowerCase()} first.`, "error");
            return;
        }
        const pair = {};
        dim.fields.forEach((field) => (pair[field.id] = draft[field.id] || null)); // optional fields left empty are null
        selection[dim.id] = (selection[dim.id] || []).concat([pair]);
        pairDrafts[dim.id] = {};
        choices.forEach((choice) => choice.reset());
        renderChips();
        updateSummary();
    };
    addButton.addEventListener("click", addPair);
    choices.forEach((choice) => choice.other.addEventListener("keydown", (event) => {
        if (event.key === "Enter") addPair();
    }));

    block.append(row, chips);
    renderChips();
    questionResets.push(() => {
        pairDrafts[dim.id] = {};
        choices.forEach((choice) => choice.reset());
        renderChips();
    });
}

// Clear the answers after an interval is added or edited
function resetSelection() {
    selection = {};
    questionResets.forEach((reset) => reset());
    updateSummary();
}

// Short message at the bottom of the page that goes away by itself (instead of a pop-up)
function toast(message, kind) {
    const node = element("div", kind === "error" ? "toast error" : "toast", message);
    toastsEl.appendChild(node);
    setTimeout(() => {
        node.classList.add("fade");
        setTimeout(() => node.remove(), 400);
    }, kind === "error" ? 6000 : 3000);
}

// Highlight row during navigation
function highlightRow(index) {
    const rows = document.querySelectorAll("#table_events tr");
    rows.forEach((row, i) => {
        if (i === index + 1) { // Adjust for table header
            row.classList.add("highlighted-row");
        } else {
            row.classList.remove("highlighted-row");
        }
    });
}

// Summary of the interval being annotated, and what is still needed before "Add Log" works
function updateSummary() {
    if (!labelset) return;
    const show = (seconds) => (seconds === null ? "—" : DSTCore.formatTimeInput(seconds));
    state_text.replaceChildren(element("div", "", `Current interval: ${show(startTime)} – ${show(endTime)} · ${DSTCore.describeSelection(labelset, selection)}`));
    const missing = DSTCore.missingForInterval(labelset, selection, startTime, endTime);
    if (missing.length > 0) state_text.appendChild(element("div", "missing", `Still needed to add it: ${missing.join(", ")}`));
    button_add_row.disabled = readOnly || missing.length > 0;
    button_add_row.title = missing.length > 0 ? `Still needed: ${missing.join(", ")}` : "Add the interval with these answers";
}

// Start / end times: typed into the boxes, or taken from the video with "Set from video"
setStartTimeButton.onclick = function () {
    startTime = parseFloat(video.currentTime.toFixed(3));
    updateSelectedTimes();
};

setEndTimeButton.onclick = function () {
    endTime = parseFloat(video.currentTime.toFixed(3));
    updateSelectedTimes();
};

// Show the times in the boxes
function updateSelectedTimes() {
    startTimeInput.value = DSTCore.formatTimeInput(startTime);
    endTimeInput.value = DSTCore.formatTimeInput(endTime);
    startTimeInput.classList.remove("invalid");
    endTimeInput.classList.remove("invalid");
    updateSummary();
}

// Read a typed time; an empty box clears it. Returns undefined (and marks the box) if it is not a time.
function readTimeInput(input) {
    const text = input.value.trim();
    if (text === "") {
        input.classList.remove("invalid");
        return null;
    }
    const seconds = DSTCore.parseTime(text);
    if (seconds === null) {
        input.classList.add("invalid");
        toast(`"${text}" is not a time. Type minutes:seconds such as 1:02.5, or just seconds.`, "error");
        return undefined;
    }
    input.classList.remove("invalid");
    input.value = DSTCore.formatTimeInput(seconds);
    return seconds;
}

startTimeInput.addEventListener("change", () => {
    const seconds = readTimeInput(startTimeInput);
    if (seconds !== undefined) startTime = seconds;
    updateSummary();
});
endTimeInput.addEventListener("change", () => {
    const seconds = readTimeInput(endTimeInput);
    if (seconds !== undefined) endTime = seconds;
    updateSummary();
});
[startTimeInput, endTimeInput].forEach((input) => input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur(); // applies the typed time
}));

document.getElementById("jumpToStart").addEventListener("click", () => {
    if (startTime === null) {
        toast("Set a start time first.", "error");
        return;
    }
    video.currentTime = startTime;
});

// Add log row
button_add_row.onclick = function () {
    // Times and every dimension of the label set are needed (the button stays disabled until then)
    const missing = DSTCore.missingForInterval(labelset, selection, startTime, endTime);
    if (missing.length > 0) {
        toast(`Still needed: ${missing.join(", ")}.`, "error");
        return;
    }

    // Record which video the session belongs to (the first time one is loaded)
    if (!session.video && currentVideo) session.video = currentVideo;
    const overlaps = DSTCore.findOverlaps(session.intervals, startTime, endTime);
    const interval = DSTCore.createInterval(session.intervals, startTime, endTime, labelset, selection, session.lastId);
    session.lastId = interval.id;
    session.intervals.push(interval);
    DSTCore.sortIntervals(session.intervals);
    populateLogsTable();
    autoSaveLogs();

    toast(`Interval #${interval.id} added (${DSTCore.formatTime(interval.start)}–${DSTCore.formatTime(interval.end)}).`);
    // Overlaps are allowed (activities can overlap), but are often a slip, so point them out
    if (overlaps.length > 0) {
        const list = overlaps.map((other) => `#${other.id} (${DSTCore.formatTime(other.start)}–${DSTCore.formatTime(other.end)})`).join(", ");
        showBanner(`The new interval #${interval.id} overlaps ${list}. It was added anyway; edit or delete it if that was not intended.`, [["Dismiss", hideBanner]]);
    }

    // The next interval usually starts where this one ended
    startTime = endTime;
    endTime = null;
    updateSelectedTimes();
    resetSelection();
  };

// Delete log row
button_delete_row.onclick = function () {
    const selectedRow = document.querySelector(".highlighted-row");
    if (!selectedRow) {
        toast("Select a row first with ‹ › (or in the Logs Table).", "error");
        return;
    }
    const rowIndex = Array.from(table_events.rows).indexOf(selectedRow) - 1; // Adjust for header
    deleteRow(rowIndex);
};

// Edit label
button_edit_label.onclick = function () {
    const rows = document.querySelectorAll("#table_events tr");
    const selectedRow = Array.from(rows).find((row) =>
        row.classList.contains("highlighted-row")
    );

    if (!selectedRow) {
        toast("Select a row first with ‹ › (or in the Logs Table).", "error");
        return;
    }

    const rowIndex = Array.from(table_events.rows).indexOf(selectedRow) - 1; // Adjust for header
    // Update the interval with new selections; empty fields keep their old value
    DSTCore.applyEdit(session.intervals[rowIndex], labelset, selection);

    populateLogsTable();
    index_log = rowIndex;
    highlightRow(rowIndex); // keep the edited row selected, e.g. for another edit
    autoSaveLogs();

    toast(`Interval #${session.intervals[rowIndex].id} updated.`);

    resetSelection();
};

// Delete log row
function deleteRow(index) {
    const [removed] = session.intervals.splice(index, 1);
    index_log = DSTCore.clampIndex(index_log, session.intervals.length); // never point past the last row
    populateLogsTable();
    autoSaveLogs();
    toast(`Interval #${removed.id} deleted.`);
}

// Auto-save logs (debounced; see showSaveStatus for progress)
function autoSaveLogs() {
    if (autosave) autosave.schedule();
}

// AutoPlay functionality
button_auto_play.onclick = function () {
    if (video.paused) {
        video.play();
        button_auto_play.innerText = "Pause";
    } else {
        video.pause();
        button_auto_play.innerText = "Play";
    }
};

// Navigate events
button_prev.onclick = function () {
    if (session.intervals.length === 0) return;
    index_log = DSTCore.clampIndex(index_log - 1, session.intervals.length);
    navigateToLog(index_log);
    highlightRow(index_log);
};

button_next.onclick = function () {
    if (session.intervals.length === 0) return;
    index_log = DSTCore.clampIndex(index_log + 1, session.intervals.length);
    navigateToLog(index_log);
    highlightRow(index_log);
};

// Replay event: play the selected interval and pause at its end.
// The end is checked in video time, so this also works at other playback speeds.
var replayStopAt = null;

button_replay.onclick = function () {
    if (session.intervals.length === 0) return;
    index_log = DSTCore.clampIndex(index_log, session.intervals.length);
    const interval = session.intervals[index_log];
    replayStopAt = interval.end;
    video.currentTime = interval.start;
    video.play();
    highlightRow(index_log);
};

video.addEventListener("timeupdate", () => {
    if (replayStopAt !== null && video.currentTime >= replayStopAt) {
        replayStopAt = null;
        video.pause();
    }
});
video.addEventListener("pause", () => {
    replayStopAt = null; // pausing by hand ends the replay
});

// Navigate to log
function navigateToLog(index) {
    const interval = session.intervals[index];
    if (!interval) return;
    video.currentTime = interval.start;
    video.pause(); // Pause video on navigate to allow for replay
}

// Remember which video is loaded; warn if it is not the one these annotations were made on
video.addEventListener("loadedmetadata", () => {
    if (!currentVideoName) return;
    currentVideo = { name: currentVideoName, duration: Math.round(video.duration * 1000) / 1000 };
    if (session.video && session.intervals.length > 0 && session.video.name !== currentVideo.name) {
        showBanner(`These annotations were made on "${session.video.name}", but the video you loaded is "${currentVideo.name}".`, [["Dismiss", hideBanner]]);
    }
});

// Update speed
speed_slider.oninput = function () {
    video.playbackRate = parseFloat(speed_slider.value);
    document.getElementById("speed_value").textContent = `${video.playbackRate}×`;
};

// Video upload functionality
const videoUploadInput = document.getElementById("video-upload");
const loadVideoButton = document.getElementById("loadVideoButton");

// Load selected video
loadVideoButton.addEventListener("click", () => {
    if (!videoUploadInput.files || videoUploadInput.files.length === 0) {
        toast("Choose a video file first.", "error");
        return;
    }

    const file = videoUploadInput.files[0];
    if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src); // free the previously loaded video
    const fileURL = URL.createObjectURL(file);
    currentVideoName = file.name;

    video.src = fileURL; // Set the video source to the selected file
    video.playbackRate = parseFloat(speed_slider.value); // keep the chosen speed
    toast(`Loaded "${file.name}".`);
});

// Initialize everything
initialization();