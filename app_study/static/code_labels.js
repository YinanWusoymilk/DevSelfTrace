// Variables for paths
var json_path = ""; // Will be set dynamically
var video_path = ""; // Will be set dynamically
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
var state_buttons = document.querySelectorAll(".state-btn");
var customStateInputs = document.querySelectorAll("#customStateInput");
var customStateButtons = document.querySelectorAll("#setCustomState");
var setStartTimeButton = document.getElementById("setStartTime");
var setEndTimeButton = document.getElementById("setEndTime");

// Track selected states for Q1, Q2, and Q3
let selectedStateQ1 = "";
let selectedStateQ2 = "";
let selectedStateQ3 = "";
var q1IntentionDropdown = document.getElementById("intentions-section");
var q3ValenceDropdown = document.getElementById("q3-valence-form"); 

let currentAction = null; // Currently selected action
let currentTool = null; // Currently selected tool
let actionToolPairs = []; // Array to store all added pairs

// Initialize paths dynamically
function initialization() {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/initialize_html", true);
    xhr.setRequestHeader("Content-type", "application/json");
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && xhr.status === 200) {
            try {
                var response = JSON.parse(xhr.responseText);
                json_path = response.json_path;
                video_path = response.video_path;
                video.src = video_path;

                fetch(json_path)
                    .then((response) => response.json())
                    .then((data) => {
                        logs_data = data;
                        populateLogsTable();
                    })
                    .catch((error) => console.error("Failed to load logs.", error));
            } catch (error) {
                console.error("Failed to initialize paths.", error);
            }
        }
    };
    xhr.send();
}

// Populate logs table
function populateLogsTable() {
    table_events.innerHTML = `
        <tr>
            <th>ID</th>
            <th>Timestamps</th>
            <th>Question 1</th>
            <th>Question 2</th>
            <th>Question 3</th>
        </tr>`;
    logs_data.logs.forEach((log, index) => {
        const startTimestamp = formatTime(log.Timestamps.start);
        const endTimestamp = formatTime(log.Timestamps.end);

        const row = table_events.insertRow();
        row.innerHTML = `
            <td>${log.ID}</td>
            <td>${startTimestamp} - ${endTimestamp}</td>
            <td>${log.Label1 || "N/A"}</td>
            <td>${log.Label2 || "N/A"}</td>
            <td>${log.Label3 || "N/A"}</td>
        `;
    });
    autoSaveLogs(); // Auto-save logs after population
}

// Format seconds to [minutes:seconds] format
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(0).padStart(2, "0");
    return `${minutes}:${remainingSeconds}`;
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

// Event listeners for state buttons for Q1, Q2, and Q3
document.querySelectorAll("[id^='label_state']").forEach((label, index) => {
    const questionIndex = index + 1; // Q1, Q2, Q3, ...
    const stateButtons = label.parentNode.querySelectorAll(".state-btn");
    stateButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const state = button.getAttribute("data-label");
            switch (questionIndex) {
                // case 1:
                //     selectedStateQ1 = state;
                //     break;
                // case 2:
                //     selectedStateQ2 = state;
                //     break;
                // case 3:
                //     selectedStateQ3 = state;
                //     break;
            }
            updateSelectedStatesDisplay();
        });
    });
});

// Custom state functionality for Q1, Q2, Q3
customStateButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
        const input = customStateInputs[index];
        const customState = input.value.trim();
        if (!customState) {
            alert("Enter a valid custom state.");
            return;
        }
        switch (index) {
            case 0:
                selectedStateQ1 = customState;
                break;
            case 1:
                selectedStateQ2 = customState;
                break;
            case 2:
                selectedStateQ3 = customState;
                break;
        }
        updateSelectedStatesDisplay();
        input.value = ""; // Clear input
    });
});

function updateSelectedStatesDisplay() {
    // Check if actionToolPairs array contains valid entries
    const actionToolPairsText = actionToolPairs.length > 0 
        ? actionToolPairs
              .map(pair => {
                  const action = pair[0] || "Undefined Action";
                  const tool = pair[1] || "Undefined Tool";
                  return `[${action}, ${tool}]`;
              })
              .join(", ")
        : "None";

    // Update the text area with selected states
    state_text.innerText = `
        Selected States:
        Q1: ${selectedStateQ1 || "None"},
        Q2: ${actionToolPairsText},
        Q3: ${selectedStateQ3 || "None"}
    `;
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
    document.getElementById("startTimeDisplay").innerText = `Start Time: ${formatTimeForDisplay(startTime)}`;
    document.getElementById("endTimeDisplay").innerText = `End Time: ${formatTimeForDisplay(endTime)}`;
}

// Format time for display in mins:secs
function formatTimeForDisplay(seconds) {
    if (!seconds) return "None"; // Handle cases where time is not set
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

// Add log row
button_add_row.onclick = function () {
    if (startTime === null || endTime === null || startTime >= endTime) {
      alert("Set valid start and end times.");
      return;
    }

    // Validation for Q1, Q2, and Q3
    if (!selectedStateQ1 || selectedStateQ1 === "N/A") {
        alert("Please answer all the questions to add a log.");
        return;
    }

    if (actionToolPairs.length === 0) {
        alert("Please answer all the questions to add a log.");
        return;
    }

    if (!selectedStateQ3 || selectedStateQ3 === "N/A") {
        alert("Please answer all the questions to add a log.");
        return;
    }
  
    const newLog = {
      ID: logs_data.logs.length + 1,
      Timestamps: { start: startTime, end: endTime },
      TimeInState: (endTime - startTime).toFixed(3),
      Label1: selectedStateQ1 || "N/A",
      Label2: `(${actionToolPairs.map((pair) => `[${pair[0]}, ${pair[1]}]`).join("; ")})`,
      Label3: selectedStateQ3 || "N/A",
    };
  
    logs_data.logs.push(newLog);
    populateLogsTable();
  
    alert("Log added successfully!");
  
    // Reset states and pairs
    startTime = null;
    endTime = null;
    selectedStateQ1 = selectedStateQ2 = selectedStateQ3 = "";
    actionToolPairs = [];
    document.getElementById("action-tool-pairs-list").innerHTML = "";
    q1IntentionDropdown.value = ""; // Reset Q1 dropdown - Reset to default disabled option
    q3ValenceDropdown.value = ""; // Reset Q3 dropdown - Reset to default disabled option
    updateSelectedTimes();
    updateSelectedStatesDisplay();
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

    // Update the log with new selections
    log.Label1 = selectedStateQ1 || log.Label1 || "N/A";

    // Only update Label2 if actionToolPairs is not empty
    if (actionToolPairs.length > 0) {
        log.Label2 = `(${actionToolPairs.map((pair) => `[${pair[0]}, ${pair[1]}]`).join("; ")})`;
    }

    //Q3 Selection
    log.Label3 = selectedStateQ3 || log.Label3 || "N/A";

    populateLogsTable();

    alert("Log edited successfully!");

    // Reset states and pairs
    selectedStateQ1 = selectedStateQ2 = selectedStateQ3 = "";
    actionToolPairs = [];
    document.getElementById("action-tool-pairs-list").innerHTML = "";
    q1IntentionDropdown.value = ""; // Reset to default disabled option
    q3ValenceDropdown.value = ""; // Reset to default disabled option

    updateSelectedStatesDisplay();
};

// Delete log row
function deleteRow(index) {
    logs_data.logs.splice(index, 1);
    populateLogsTable();
    alert("Row deleted successfully!");
}

// Auto-save logs
function autoSaveLogs() {
    console.log("Auto-saving logs...");
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/update_json", true);
    xhr.setRequestHeader("Content-type", "application/json");
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && xhr.status === 200) {
            console.log("Logs auto-saved successfully!");
        }
    };
    xhr.send(JSON.stringify(logs_data));
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

// Event listener for Q3 dropdown changes
q3ValenceDropdown.addEventListener("change", (event) => {
    selectedStateQ3 = event.target.value; // Update the selected value
    updateSelectedStatesDisplay();
  });


// Event listener for action selection
document.getElementById("actions-section").addEventListener("change", (event) => {
    currentAction = event.target.value; // Get selected value from the dropdown
});
  
// Event listener for tool selection
document.getElementById("tools-section").addEventListener("change", (event) => {
    currentTool = event.target.value; // Get selected value from the dropdown
});

// Add custom action
document.getElementById("add-custom-action").addEventListener("click", () => {
  const customActionInput = document.getElementById("custom-action");
  const customAction = customActionInput.value.trim();
  if (customAction) {
    currentAction = customAction;
    customActionInput.value = "";
    alert(`Custom Action "${customAction}" added.`);
  }
});

// Add custom tool
document.getElementById("add-custom-tool").addEventListener("click", () => {
  const customToolInput = document.getElementById("custom-tool");
  const customTool = customToolInput.value.trim();
  if (customTool) {
    currentTool = customTool;
    customToolInput.value = "";
    alert(`Custom Tool "${customTool}" added.`);
  }
});

// Add Action-Tool Pair
document.getElementById("add-action-tool-pair").addEventListener("click", () => {
    if (!currentAction) {
      alert("Please select an action.");
      return;
    }
  
    const tool = currentTool || "null"; // Default to "null" if no tool is selected
    const pair = [currentAction, tool];
    actionToolPairs.push(pair);
  
    // Update pairs in UI
    const pairsList = document.getElementById("action-tool-pairs-list");
    const listItem = document.createElement("li");
    listItem.textContent = `[${pair[0]}, ${pair[1]}]`; 
    pairsList.appendChild(listItem);
  
    updateSelectedStatesDisplay(); 
  
    // Reset current selections
    currentAction = null;
    currentTool = null;
    document.getElementById("actions-section").value = ""; 
    document.getElementById("tools-section").value = ""; 
  });


// Event Listener for Clear Selection Button
document.getElementById("clear-selection").addEventListener("click", () => {
    actionToolPairs = [];
    const pairsList = document.getElementById("action-tool-pairs-list");
    pairsList.innerHTML = "";
  
    // Reset the display of selected states
    updateSelectedStatesDisplay();
  
    alert("Action-Tool Pair selections have been cleared!");
  });


// Event listener for Q1 dropdown changes
q1IntentionDropdown.addEventListener("change", (event) => {
    selectedStateQ1 = event.target.value; // Update the selected value
    updateSelectedStatesDisplay();
  });


// Initialize everything
initialization();