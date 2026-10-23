// DevSelfTrace storage: where the annotation logs are kept and how they are saved.
//   server mode  - server.py is running; logs are written to the JSON file passed with -p
//   browser mode - no server (static hosting or opened from disk); logs live in localStorage
//
// Every saved session carries a "revision" number. A save names the revision it was
// based on; if someone else (another tab, another program) saved in between, the save
// is refused as a conflict instead of silently overwriting their work.
//
// Loaded as a plain <script> in the browser (exposes window.DSTStorage)
// and with require() in the tests.
(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.DSTStorage = api;
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const BROWSER_KEY = "devselftrace:session";

    function emptySession() {
        return { tool: "DevSelfTrace", schemaVersion: 2, intervals: [] };
    }

    function revisionOf(data) {
        return (data && typeof data.revision === "number") ? data.revision : 0;
    }

    // Result of a write: { ok: true, revision } | { ok: false, conflict: true, revision, data } | { ok: false, error }
    function createServerStorage(fetchFn, info) {
        return {
            mode: "server",

            async load() {
                const response = await fetchFn(info.json_path, { cache: "no-store" });
                const data = await response.json();
                return {
                    data: data,
                    revision: revisionOf(data),
                    videoPath: info.video_path || null,
                    videoName: info.video_name || null,
                    labelset: info.labelset || null, // from server.py --labels
                };
            },

            async write(data, baseRevision) {
                let response;
                try {
                    response = await fetchFn("/save", {
                        method: "POST",
                        headers: { "Content-type": "application/json" },
                        body: JSON.stringify({ revision: baseRevision, data: data }),
                    });
                } catch (error) {
                    return { ok: false, error: "The annotation server is not reachable." };
                }
                let body = {};
                try {
                    body = await response.json();
                } catch (error) {
                    // keep the empty body; the status code still tells what happened
                }
                if (response.ok) return { ok: true, revision: body.revision };
                if (response.status === 409) return { ok: false, conflict: true, revision: body.revision, data: body.data };
                return { ok: false, error: body.message || `The server answered ${response.status}.` };
            },
        };
    }

    function createBrowserStorage(storageArea) {
        function readStored() {
            const saved = storageArea && storageArea.getItem(BROWSER_KEY);
            return saved ? JSON.parse(saved) : null;
        }

        return {
            mode: "browser",

            async load() {
                let data = emptySession();
                try {
                    data = readStored() || data;
                } catch (error) {
                    console.error("Failed to read saved logs from the browser.", error);
                }
                return { data: data, revision: revisionOf(data), videoPath: null, videoName: null, labelset: null };
            },

            async write(data, baseRevision) {
                let stored = null;
                try {
                    stored = readStored();
                } catch (error) {
                    stored = null; // unreadable data is replaced
                }
                if (stored && revisionOf(stored) !== baseRevision) {
                    return { ok: false, conflict: true, revision: revisionOf(stored), data: stored };
                }
                const next = Object.assign({}, data, { revision: baseRevision + 1 });
                try {
                    storageArea.setItem(BROWSER_KEY, JSON.stringify(next));
                } catch (error) {
                    return { ok: false, error: "This browser's storage is full or blocked." };
                }
                return { ok: true, revision: next.revision };
            },
        };
    }

    // Use the server when server.py answers /initialize_html, otherwise fall back to the browser.
    // notify(message) shows problems to the user (alert in the page, a stub in tests).
    async function detect(fetchFn, storageArea, notify) {
        try {
            const response = await fetchFn("/initialize_html", {
                method: "POST",
                headers: { "Content-type": "application/json" },
            });
            if (response.ok) {
                const info = await response.json();
                if (info && info.json_path) return createServerStorage(fetchFn, info);
                if (info && info.status === "error") {
                    // Never fall through to saving over a file we could not read
                    notify(`The server could not read the logs file: ${info.message}\nAnnotations will be kept in this browser instead.`);
                }
            }
        } catch (error) {
            // No server (opened from disk or a static host)
        }
        return createBrowserStorage(storageArea);
    }

    // Wait before retrying a failed save: 1s, 2s, 4s, ... up to 30s
    function backoffDelay(attempt) {
        return Math.min(1000 * Math.pow(2, Math.max(attempt, 1) - 1), 30000);
    }

    // Debounced autosave around a storage backend.
    //   getData()          - returns the current session object
    //   onStatus(status)   - called with { state, ... } where state is one of
    //                        "saved" | "pending" | "saving" | "error" | "conflict" | "readonly"
    function createAutosave(backend, options) {
        const opts = Object.assign({ delayMs: 1000, now: () => new Date() }, options);
        const setTimer = opts.setTimeout || setTimeout;
        const clearTimer = opts.clearTimeout || clearTimeout;

        let revision = opts.revision || 0;
        let changeSeq = 0; // bumps on every change
        let savedSeq = 0; // changeSeq covered by the last successful save
        let timer = null;
        let inFlight = null;
        let attempts = 0;
        let conflict = null;
        let readOnly = false;

        function report(status) {
            if (opts.onStatus) opts.onStatus(status);
        }

        function arm(delay) {
            if (timer) clearTimer(timer);
            timer = setTimer(() => {
                timer = null;
                save();
            }, delay);
        }

        // Record a change and save it after a short pause
        function schedule() {
            if (readOnly) return;
            changeSeq += 1;
            if (conflict) return; // wait until the conflict is resolved
            report({ state: "pending" });
            arm(opts.delayMs);
        }

        async function save() {
            if (readOnly || conflict || changeSeq === savedSeq) return;
            if (inFlight) return inFlight; // the change is picked up when this save finishes
            if (timer) {
                clearTimer(timer);
                timer = null;
            }
            const seqAtStart = changeSeq;
            const snapshot = JSON.parse(JSON.stringify(opts.getData()));
            report({ state: "saving" });
            inFlight = backend.write(snapshot, revision);
            const result = await inFlight;
            inFlight = null;

            if (result.ok) {
                revision = result.revision;
                savedSeq = seqAtStart;
                attempts = 0;
                if (changeSeq !== savedSeq) {
                    report({ state: "pending" });
                    arm(opts.delayMs);
                } else {
                    report({ state: "saved", at: opts.now() });
                }
            } else if (result.conflict) {
                conflict = { revision: result.revision, data: result.data };
                report({ state: "conflict", conflict: conflict });
            } else {
                attempts += 1;
                const retryInMs = backoffDelay(attempts);
                report({ state: "error", message: result.error, retryInMs: retryInMs });
                arm(retryInMs);
            }
            return result;
        }

        return {
            schedule: schedule,
            // Save right away (e.g. "Retry now")
            flush: () => {
                attempts = 0;
                return save();
            },
            isDirty: () => changeSeq !== savedSeq,
            getRevision: () => revision,
            getConflict: () => conflict,
            // Conflict: drop local changes and continue from the other version
            acceptRemote: () => {
                if (!conflict) return; // already resolved (e.g. a second click)
                revision = conflict.revision;
                conflict = null;
                savedSeq = changeSeq;
                report({ state: "saved", at: opts.now() });
            },
            // Conflict: keep local changes and save them over the other version
            overwrite: () => {
                if (!conflict) return Promise.resolve(); // already resolved
                revision = conflict.revision;
                conflict = null;
                attempts = 0;
                return save();
            },
            setReadOnly: (value) => {
                readOnly = value;
                if (value) {
                    if (timer) clearTimer(timer);
                    timer = null;
                    report({ state: "readonly" });
                }
            },
        };
    }

    // Lets only one tab edit a session at a time. Other tabs that open the same
    // session are told it is taken and become read-only.
    function createTabLock(channelName, options) {
        const opts = Object.assign({ waitMs: 250 }, options);
        const Channel = opts.BroadcastChannel || (typeof BroadcastChannel !== "undefined" ? BroadcastChannel : null);
        const id = Math.random().toString(36).slice(2);
        let channel = null;
        let owner = false;

        function open() {
            if (!channel && Channel) {
                channel = new Channel(channelName);
                channel.onmessage = (event) => {
                    const message = event.data || {};
                    if (message.type === "ping" && owner && message.id !== id) {
                        channel.postMessage({ type: "owner", id: id });
                    }
                    if (message.type === "released" && opts.onReleased) opts.onReleased();
                };
            }
            return channel;
        }

        return {
            // Resolves true if this tab may edit, false if another tab already does
            claim() {
                if (!open()) {
                    owner = true; // no BroadcastChannel support: nothing to coordinate with
                    return Promise.resolve(true);
                }
                return new Promise((resolve) => {
                    let taken = false;
                    const listener = (event) => {
                        if (event.data && event.data.type === "owner" && event.data.id !== id) taken = true;
                    };
                    channel.addEventListener("message", listener);
                    channel.postMessage({ type: "ping", id: id });
                    setTimeout(() => {
                        channel.removeEventListener("message", listener);
                        owner = !taken;
                        resolve(owner);
                    }, opts.waitMs);
                });
            },
            release() {
                if (channel && owner) channel.postMessage({ type: "released", id: id });
                owner = false;
            },
            close() {
                if (channel) channel.close();
                channel = null;
                owner = false;
            },
        };
    }

    return {
        BROWSER_KEY: BROWSER_KEY,
        emptySession: emptySession,
        createServerStorage: createServerStorage,
        createBrowserStorage: createBrowserStorage,
        detect: detect,
        backoffDelay: backoffDelay,
        createAutosave: createAutosave,
        createTabLock: createTabLock,
    };
});
