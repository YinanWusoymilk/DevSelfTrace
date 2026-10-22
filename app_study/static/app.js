// DevSelfTrace UI: wires the page to DSTCore (static/core.js) and DSTStorage (static/storage.js)

// Storage backend, chosen at startup (server file or browser localStorage)
var store = null;
var autosave = null; // debounced, conflict-checked saving (DSTStorage.createAutosave)
var tabLock = null; // only one tab may edit a session at a time
var logs_data = { logs: [] }; // Initialize with empty logs if no data loaded initially

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
var saveStatusEl = document.getElementById("save-status");
var saveBannerEl = document.getElementById("save-banner");

// Label set (dimensions and options) and the answers chosen for the current interval
var labelset = null;
var selection = {}; // dimension id -> option (single) or list of [a, b] pairs
var pairDrafts = {}; // dimension id -> { field id -> value } for the pair being put together
var questionsContainer = document.getElementById("questionsView");
var labelsetSelect = document.getElementById("labelset-select");
var labelsetLoadButton = document.getElementById("labelset-load");
var labelsetFileInput = document.getElementById("labelset-file");

// Pick the storage backend and load existing logs
async function initialization() {
    try {
        store = await DSTStorage.detect(window.fetch.bind(window), window.localStorage, (message) => alert(message));
        console.info(`DevSelfTrace running in ${store.mode} mode.`);
        const session = await store.load();
        logs_data = session.data;
        if (session.videoPath) video.src = session.videoPath;
        autosave = DSTStorage.createAutosave(store, {
            revision: session.revision,
            getData: () => logs_data,
            onStatus: showSaveStatus,
        });
        showSaveStatus({ state: "saved", at: null });
        chooseInitialLabelset(session.labelset);

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
            hideBanner();
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
                    ["Export a backup", exportBackup],
                ]);
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
                ["Export mine", exportBackup],
            ]);
            break;
        case "readonly":
            text = "Read-only";
            level = "readonly";
            break;
    }
    saveStatusEl.textContent = text;
    saveStatusEl.className = `save-status ${level}`;
}

// Banner with a message and action buttons (actions: [label, handler] pairs)
function showBanner(message, actions) {
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
}

function hideBanner() {
    saveBannerEl.classList.add("hidden");
}

// Conflict: continue from the version saved elsewhere
function loadRemoteVersion() {
    const conflict = autosave.getConflict();
    if (!conflict) return; // already resolved
    logs_data = conflict.data;
    autosave.acceptRemote();
    // The other version may use a different label set
    const checked = logs_data.labelset ? DSTCore.validateLabelset(logs_data.labelset) : null;
    applyLabelset(checked && checked.ok ? checked.labelset : presetLabelset(DSTPresets.defaultId));
}

// Download the current annotations as a JSON file
function exportBackup() {
    const blob = new Blob([JSON.stringify(logs_data, null, 4)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `devselftrace_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Another tab is already editing this session
function enterReadOnly() {
    autosave.setReadOnly(true);
    [button_add_row, button_delete_row, button_edit_label, labelsetSelect, labelsetLoadButton].forEach((button) => {
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
    // One column per dimension of the label set; dimension i is stored as Label<i+1>
    const headers = labelset.dimensions.map((dim, i) => `<th>Question ${i + 1}</th>`).join("");
    table_events.innerHTML = `
        <tr>
            <th>ID</th>
            <th>Timestamps</th>
            ${headers}
        </tr>`;
    const escape = DSTCore.escapeHtml;
    logs_data.logs.forEach((log, index) => {
        const startTimestamp = DSTCore.formatTime(log.Timestamps.start);
        const endTimestamp = DSTCore.formatTime(log.Timestamps.end);
        const cells = labelset.dimensions.map((dim, i) => `<td>${escape(log[`Label${i + 1}`] || "N/A")}</td>`).join("");

        const row = table_events.insertRow();
        row.innerHTML = `
            <td>${escape(log.ID)}</td>
            <td>${startTimestamp} - ${endTimestamp}</td>
            ${cells}
        `;
    });
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
    if (logs_data.labelset) {
        const checked = DSTCore.validateLabelset(logs_data.labelset);
        if (checked.ok) stored = checked.labelset;
        else problems.push("The label set saved with this session is not valid; showing the default label set.");
    }

    const choice = DSTCore.resolveLabelset(stored, requested, logs_data.logs.length > 0, fallback);
    if (choice.warning) problems.push(choice.warning);
    applyLabelset(choice.labelset);
    if (problems.length > 0) showBanner(problems.join(" "), [["Dismiss", hideBanner]]);
}

// Use a label set: rebuild the questions, the picker and the table. It is saved with the session.
function applyLabelset(newLabelset) {
    labelset = newLabelset;
    logs_data.labelset = newLabelset;
    renderQuestions();
    renderLabelsetPicker();
    populateLogsTable();
}

// Switching is only allowed before the first annotation, so logs never mix label sets
function switchLabelset(newLabelset) {
    if (logs_data.logs.length > 0) {
        alert(`This session already has annotations made with the "${labelset.name}" label set. Export them and start a new session to use a different label set.`);
        renderLabelsetPicker();
        return;
    }
    applyLabelset(newLabelset);
    autoSaveLogs();
}

function renderLabelsetPicker() {
    labelsetSelect.replaceChildren();
    let matched = false;
    Object.keys(DSTPresets.presets).forEach((id) => {
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
    labelsetSelect.title = labelset.description || "";
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
        alert(`"${file.name}" is not valid JSON: ${error.message}`);
        return;
    }
    const checked = DSTCore.validateLabelset(raw);
    if (!checked.ok) {
        alert(`"${file.name}" is not a valid label set:\n- ${checked.errors.slice(0, 8).join("\n- ")}`);
        return;
    }
    switchLabelset(checked.labelset);
});

// ---- Questions ---------------------------------------------------------------

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function optionSelect(placeholder, options) {
    const select = element("select", "dimension-select");
    const first = new Option(placeholder, "");
    first.disabled = true;
    first.selected = true;
    select.appendChild(first);
    options.forEach((option) => {
        const item = new Option(option.value, option.value);
        if (option.hint) item.title = option.hint; // shown when hovering the option
        select.appendChild(item);
    });
    return select;
}

function selectRow(label, select) {
    const row = element("div", "dimension-row");
    row.append(element("span", "dimension-name", label), select);
    return row;
}

// Text box + "Add Custom <label>" button; onAdd receives the trimmed text
function customInput(label, onAdd) {
    const container = element("div", "state-input-container-inline");
    const input = element("input", "state-input");
    input.type = "text";
    input.placeholder = `Enter custom ${label.toLowerCase()}`;
    const button = element("button", "custom-state-btn", `Add Custom ${label}`);
    button.addEventListener("click", () => {
        const value = input.value.trim();
        if (!value) {
            alert(`Enter a valid custom ${label.toLowerCase()}.`);
            return;
        }
        onAdd(value);
        input.value = "";
    });
    container.append(input, button);
    return container;
}

// One block per dimension: a dropdown (single) or two dropdowns that add pairs (pairs)
function renderQuestions() {
    selection = {};
    pairDrafts = {};
    questionsContainer.replaceChildren();
    labelset.dimensions.forEach((dim, i) => {
        const block = element("div", "state-buttons-container-wrapper");
        block.appendChild(element("label", "dimension-prompt", `Q${i + 1}. ${dim.prompt}`));
        if (dim.type === "pairs") renderPairsQuestion(block, dim);
        else renderSingleQuestion(block, dim);
        questionsContainer.append(block, element("hr", "dimension-divider"));
    });
    updateSelectedStatesDisplay();
}

function renderSingleQuestion(block, dim) {
    const select = optionSelect(dim.placeholder, dim.options);
    select.addEventListener("change", () => {
        selection[dim.id] = select.value;
        updateSelectedStatesDisplay();
    });
    const rows = element("div", "dimension-rows");
    rows.appendChild(selectRow(dim.label, select));
    block.appendChild(rows);
    if (dim.allowCustom) {
        block.appendChild(customInput(dim.label, (value) => {
            selection[dim.id] = value;
            updateSelectedStatesDisplay();
        }));
    }
}

function renderPairsQuestion(block, dim) {
    pairDrafts[dim.id] = {};
    const rows = element("div", "dimension-rows");
    const selects = dim.fields.map((field) => {
        const select = optionSelect(field.placeholder, field.options);
        select.addEventListener("change", () => {
            pairDrafts[dim.id][field.id] = select.value;
        });
        rows.appendChild(selectRow(field.label, select));
        if (dim.allowCustom) {
            const custom = element("div");
            custom.append(
                element("p", "dimension-note", `* Only use the "Add Custom ${field.label}" button below to add a custom ${field.label.toLowerCase()}.`),
                customInput(field.label, (value) => {
                    pairDrafts[dim.id][field.id] = value;
                    alert(`Custom ${field.label} "${value}" added.`);
                })
            );
            rows.appendChild(custom);
        }
        return select;
    });
    block.appendChild(rows);

    const list = element("ul", "pair-list");
    const addButton = element("button", "custom-state-btn color-10 add-pair-btn", `Add ${dim.label}`);
    addButton.addEventListener("click", () => {
        const draft = pairDrafts[dim.id];
        const missing = dim.fields.find((field) => !field.optional && !draft[field.id]);
        if (missing) {
            alert(`Please select ${missing.label.toLowerCase()}.`);
            return;
        }
        const pair = dim.fields.map((field) => draft[field.id] || "null"); // optional fields left empty are stored as "null"
        selection[dim.id] = (selection[dim.id] || []).concat([pair]);
        list.appendChild(element("li", "", `[${pair[0]}, ${pair[1]}]`));
        updateSelectedStatesDisplay();

        pairDrafts[dim.id] = {};
        selects.forEach((select) => (select.value = ""));
    });
    const addRow = element("div", "add-pair-row");
    addRow.appendChild(addButton);

    const clearButton = element("button", "clear-pairs-btn", "Clear Selection");
    clearButton.addEventListener("click", () => {
        selection[dim.id] = [];
        list.replaceChildren();
        updateSelectedStatesDisplay();
        alert(`${dim.label} selections have been cleared!`);
    });

    block.append(
        element("p", "dimension-note", `* Use the "Add ${dim.label}" button to add selected or entered ${dim.label.toLowerCase()}.`),
        addRow,
        clearButton,
        element("h4", "pair-list-title", `Selected ${dim.label}s:`),
        list
    );
}

// Clear the answers after a log is added or edited
function resetSelection() {
    selection = {};
    Object.keys(pairDrafts).forEach((id) => (pairDrafts[id] = {}));
    questionsContainer.querySelectorAll("select").forEach((select) => (select.value = ""));
    questionsContainer.querySelectorAll(".pair-list").forEach((list) => list.replaceChildren());
    updateSelectedStatesDisplay();
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

function updateSelectedStatesDisplay() {
    state_text.innerText = `Selected States: ${DSTCore.describeSelection(labelset, selection)}`;
}

// Set start time
setStartTimeButton.onclick = function () {
    startTime = parseFloat(video.currentTime.toFixed(3));
    updateSelectedTimes();
};

// Set end time
setEndTimeButton.onclick = function () {
    endTime = parseFloat(video.currentTime.toFixed(3));
    updateSelectedTimes();
};

// Update the displayed times
function updateSelectedTimes() {
    document.getElementById("startTimeDisplay").innerText = `Start Time: ${DSTCore.formatTimeForDisplay(startTime)}`;
    document.getElementById("endTimeDisplay").innerText = `End Time: ${DSTCore.formatTimeForDisplay(endTime)}`;
}

// Add log row
button_add_row.onclick = function () {
    if (startTime === null || endTime === null || startTime >= endTime) {
      alert("Set valid start and end times.");
      return;
    }

    // Every dimension of the label set needs an answer
    if (!DSTCore.isSelectionComplete(labelset, selection)) {
        alert("Please answer all the questions to add a log.");
        return;
    }

    const newLog = DSTCore.createLog(logs_data.logs, startTime, endTime, labelset, selection);

    logs_data.logs.push(newLog);
    populateLogsTable();
    autoSaveLogs();

    alert("Log added successfully!");
  
    // Reset times and answers
    startTime = null;
    endTime = null;
    updateSelectedTimes();
    resetSelection();
  };

// Delete log row
button_delete_row.onclick = function () {
    const selectedRow = document.querySelector(".highlighted-row");
    if (selectedRow) {
        const rowIndex = Array.from(table_events.rows).indexOf(selectedRow) - 1; // Adjust for header
        deleteRow(rowIndex);
    }
};

// Edit label
button_edit_label.onclick = function () {
    const rows = document.querySelectorAll("#table_events tr");
    const selectedRow = Array.from(rows).find((row) =>
        row.classList.contains("highlighted-row")
    );

    if (!selectedRow) {
        alert("Please navigate to a row to edit its labels.");
        return;
    }

    const rowIndex = Array.from(table_events.rows).indexOf(selectedRow) - 1; // Adjust for header
    const log = logs_data.logs[rowIndex];

    // Update the log with new selections; empty fields keep their old value
    DSTCore.applyEdit(log, labelset, selection);

    populateLogsTable();
    autoSaveLogs();

    alert("Log edited successfully!");

    resetSelection();
};

// Delete log row
function deleteRow(index) {
    logs_data.logs.splice(index, 1);
    populateLogsTable();
    autoSaveLogs();
    alert("Row deleted successfully!");
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
    if (index_log > 0) index_log--;
    navigateToLog(index_log);
    highlightRow(index_log);
};

button_next.onclick = function () {
    if (index_log < logs_data.logs.length - 1) index_log++;
    navigateToLog(index_log);
    highlightRow(index_log);
};

// Replay event
button_replay.onclick = function () {
    if (logs_data.logs.length === 0) return;
    const log = logs_data.logs[index_log];
    video.currentTime = log.Timestamps.start;

    // Play for the interval
    video.play();
    setTimeout(() => {
        video.pause();
    }, (log.Timestamps.end - log.Timestamps.start) * 1000);
    highlightRow(index_log);
};

// Navigate to log
function navigateToLog(index) {
    const log = logs_data.logs[index];
    video.currentTime = log.Timestamps.start;
    video.pause(); // Pause video on navigate to allow for replay
}

// Update speed
speed_slider.oninput = function () {
    video.playbackRate = parseFloat(speed_slider.value);
};

// Video upload functionality
const videoUploadInput = document.getElementById("video-upload");
const loadVideoButton = document.getElementById("loadVideoButton");

// Load selected video
loadVideoButton.addEventListener("click", () => {
    if (!videoUploadInput.files || videoUploadInput.files.length === 0) {
        alert("Please select a video file.");
        return;
    }

    const file = videoUploadInput.files[0];
    const fileURL = URL.createObjectURL(file);

    video.src = fileURL; // Set the video source to the selected file
    alert("Video loaded successfully!");
});

// Initialize everything
initialization();