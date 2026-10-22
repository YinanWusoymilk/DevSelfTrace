// DevSelfTrace storage: where the annotation logs are kept.
//   server mode  - server.py is running; logs are written to the JSON file passed with -p
//   browser mode - no server (static hosting or opened from disk); logs live in localStorage
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
        return { logs: [] };
    }

    function createServerStorage(fetchFn, info) {
        return {
            mode: "server",

            async load() {
                const response = await fetchFn(info.json_path);
                const data = await response.json();
                return { data: data, videoPath: info.video_path || null };
            },

            async save(data) {
                const response = await fetchFn("/update_json", {
                    method: "POST",
                    headers: { "Content-type": "application/json" },
                    body: JSON.stringify(data),
                });
                return response.ok;
            },
        };
    }

    function createBrowserStorage(storageArea) {
        return {
            mode: "browser",

            async load() {
                let data = emptySession();
                try {
                    const saved = storageArea && storageArea.getItem(BROWSER_KEY);
                    if (saved) data = JSON.parse(saved);
                } catch (error) {
                    console.error("Failed to read saved logs from the browser.", error);
                }
                return { data: data, videoPath: null };
            },

            async save(data) {
                try {
                    storageArea.setItem(BROWSER_KEY, JSON.stringify(data));
                    return true;
                } catch (error) {
                    console.error("Failed to save logs in the browser.", error);
                    return false;
                }
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

    return {
        BROWSER_KEY: BROWSER_KEY,
        emptySession: emptySession,
        createServerStorage: createServerStorage,
        createBrowserStorage: createBrowserStorage,
        detect: detect,
    };
});
