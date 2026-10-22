// Unit tests for app_study/static/storage.js (run with: node --test tests/js/*.test.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const storage = require("../../app_study/static/storage.js");

// Minimal stand-in for window.localStorage
function fakeStorageArea(initial) {
    const items = new Map(Object.entries(initial || {}));
    return {
        getItem: (key) => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        items: items,
    };
}

// Minimal stand-in for fetch: routes maps "METHOD url" to a response or an Error
function fakeFetch(routes) {
    const calls = [];
    const fn = async (url, options) => {
        const method = (options && options.method) || "GET";
        calls.push({ method: method, url: url, options: options });
        let route = routes[`${method} ${url}`];
        if (typeof route === "function") route = route(options);
        if (route instanceof Error) throw route;
        if (!route) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: route.status === undefined || route.status < 400, status: route.status || 200, json: async () => route.body };
    };
    fn.calls = calls;
    return fn;
}

// Backend whose write() answers come from a queue, recording what it was asked to save
function scriptedBackend(answers) {
    const writes = [];
    return {
        writes: writes,
        async write(data, baseRevision) {
            writes.push({ data: data, baseRevision: baseRevision });
            return answers.shift();
        },
    };
}

// Timers that only fire when the test says so
function manualTimers() {
    const pending = [];
    return {
        pending: pending,
        setTimeout: (fn, ms) => {
            const timer = { fn: fn, ms: ms };
            pending.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            const i = pending.indexOf(timer);
            if (i >= 0) pending.splice(i, 1);
        },
    };
}

// --- choosing a backend -------------------------------------------------------

test("detect picks server mode when server.py answers", async () => {
    const fetchFn = fakeFetch({
        "POST /initialize_html": { body: { json_path: "/files/json", video_path: null, labeled_so_far: 0 } },
    });
    const store = await storage.detect(fetchFn, fakeStorageArea(), () => {});
    assert.equal(store.mode, "server");
});

test("detect falls back to browser mode on a static host", async () => {
    const fetchFn = fakeFetch({ "POST /initialize_html": { status: 501, body: {} } });
    const store = await storage.detect(fetchFn, fakeStorageArea(), () => {});
    assert.equal(store.mode, "browser");
});

test("detect falls back to browser mode when there is no server at all", async () => {
    const fetchFn = fakeFetch({ "POST /initialize_html": new TypeError("Failed to fetch") });
    const store = await storage.detect(fetchFn, fakeStorageArea(), () => {});
    assert.equal(store.mode, "browser");
});

test("detect warns and does not use a logs file the server cannot read", async () => {
    const messages = [];
    const fetchFn = fakeFetch({ "POST /initialize_html": { body: { status: "error", message: "bad JSON" } } });
    const store = await storage.detect(fetchFn, fakeStorageArea(), (m) => messages.push(m));
    assert.equal(store.mode, "browser");
    assert.equal(messages.length, 1);
    assert.match(messages[0], /bad JSON/);
});

// --- server backend -----------------------------------------------------------

test("server storage loads the logs file, its revision and the optional video path", async () => {
    const data = { logs: [{ ID: 1 }], revision: 4 };
    const fetchFn = fakeFetch({ "GET /files/json": { body: data } });
    const store = storage.createServerStorage(fetchFn, { json_path: "/files/json", video_path: "/files/video" });
    assert.deepEqual(await store.load(), { data: data, revision: 4, videoPath: "/files/video", labelset: null });
});

test("server storage passes on the label set given to server.py --labels", async () => {
    const labelset = { name: "CUPS", dimensions: [] };
    const fetchFn = fakeFetch({ "GET /files/json": { body: { logs: [] } } });
    const store = storage.createServerStorage(fetchFn, { json_path: "/files/json", labelset: labelset });
    assert.equal((await store.load()).labelset, labelset);
});

test("server storage treats a file without a revision as revision 0", async () => {
    const fetchFn = fakeFetch({ "GET /files/json": { body: { logs: [] } } });
    const store = storage.createServerStorage(fetchFn, { json_path: "/files/json" });
    assert.equal((await store.load()).revision, 0);
});

test("server storage sends the base revision and returns the new one", async () => {
    const fetchFn = fakeFetch({ "POST /save": { body: { status: "success", revision: 3 } } });
    const store = storage.createServerStorage(fetchFn, { json_path: "/files/json" });
    const data = { logs: [{ ID: 1 }] };
    assert.deepEqual(await store.write(data, 2), { ok: true, revision: 3 });
    assert.deepEqual(JSON.parse(fetchFn.calls.at(-1).options.body), { revision: 2, data: data });
});

test("server storage reports a conflict with the other version", async () => {
    const theirs = { logs: [{ ID: 9 }], revision: 5 };
    const fetchFn = fakeFetch({ "POST /save": { status: 409, body: { status: "conflict", revision: 5, data: theirs } } });
    const store = storage.createServerStorage(fetchFn, { json_path: "/files/json" });
    assert.deepEqual(await store.write({ logs: [] }, 4), { ok: false, conflict: true, revision: 5, data: theirs });
});

test("server storage reports an unreachable server as an error", async () => {
    const fetchFn = fakeFetch({ "POST /save": new TypeError("Failed to fetch") });
    const store = storage.createServerStorage(fetchFn, { json_path: "/files/json" });
    const result = await store.write({ logs: [] }, 0);
    assert.equal(result.ok, false);
    assert.equal(result.conflict, undefined);
    assert.match(result.error, /not reachable/);
});

// --- browser backend ----------------------------------------------------------

test("browser storage starts empty and round-trips a session with revisions", async () => {
    const store = storage.createBrowserStorage(fakeStorageArea());
    assert.deepEqual(await store.load(), { data: { logs: [] }, revision: 0, videoPath: null, labelset: null });

    const data = { logs: [{ ID: 1, Label1: "To Implement Code" }] };
    assert.deepEqual(await store.write(data, 0), { ok: true, revision: 1 });
    const loaded = await store.load();
    assert.equal(loaded.revision, 1);
    assert.deepEqual(loaded.data.logs, data.logs);
});

test("browser storage refuses a save based on an old revision (another tab saved)", async () => {
    const area = fakeStorageArea({ [storage.BROWSER_KEY]: JSON.stringify({ logs: [{ ID: 7 }], revision: 3 }) });
    const store = storage.createBrowserStorage(area);
    const result = await store.write({ logs: [] }, 2);
    assert.equal(result.conflict, true);
    assert.equal(result.revision, 3);
    assert.deepEqual(result.data.logs, [{ ID: 7 }]);
    assert.equal(JSON.parse(area.getItem(storage.BROWSER_KEY)).revision, 3); // untouched
});

test("browser storage survives corrupted saved data", async () => {
    const area = fakeStorageArea({ [storage.BROWSER_KEY]: "{not json" });
    const store = storage.createBrowserStorage(area);
    assert.deepEqual((await store.load()).data, { logs: [] });
    assert.equal((await store.write({ logs: [] }, 0)).ok, true);
});

test("browser storage reports a failed save (e.g. storage full)", async () => {
    const area = fakeStorageArea();
    area.setItem = () => {
        throw new Error("QuotaExceededError");
    };
    const result = await storage.createBrowserStorage(area).write({ logs: [] }, 0);
    assert.equal(result.ok, false);
    assert.match(result.error, /full or blocked/);
});

// --- autosave -----------------------------------------------------------------

test("backoffDelay doubles from 1s and stops at 30s", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map(storage.backoffDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test("autosave waits for a pause, then saves a snapshot on the current revision", async () => {
    const timers = manualTimers();
    const backend = scriptedBackend([{ ok: true, revision: 6 }]);
    const statuses = [];
    const session = { logs: [{ ID: 1 }] };
    const autosave = storage.createAutosave(backend, {
        revision: 5, getData: () => session, onStatus: (s) => statuses.push(s.state), ...timers,
    });

    autosave.schedule();
    autosave.schedule(); // a second change restarts the pause instead of saving twice
    assert.equal(timers.pending.length, 1);
    assert.equal(timers.pending[0].ms, 1000);
    assert.equal(autosave.isDirty(), true);

    await timers.pending[0].fn();
    assert.equal(backend.writes.length, 1);
    assert.equal(backend.writes[0].baseRevision, 5);
    assert.deepEqual(backend.writes[0].data, session);
    assert.notEqual(backend.writes[0].data, session); // a copy, not the live object
    assert.equal(autosave.getRevision(), 6);
    assert.equal(autosave.isDirty(), false);
    assert.deepEqual(statuses, ["pending", "pending", "saving", "saved"]);
});

test("autosave saves again when changes arrive during a save", async () => {
    const timers = manualTimers();
    let finishFirst;
    const backend = {
        writes: [],
        write(data, baseRevision) {
            this.writes.push(baseRevision);
            if (this.writes.length === 1) return new Promise((resolve) => (finishFirst = () => resolve({ ok: true, revision: 1 })));
            return Promise.resolve({ ok: true, revision: 2 });
        },
    };
    const autosave = storage.createAutosave(backend, { getData: () => ({ logs: [] }), ...timers });

    autosave.schedule();
    const first = autosave.flush();
    autosave.schedule(); // change while the first save is in flight
    finishFirst();
    await first;
    assert.equal(autosave.isDirty(), true);
    assert.equal(timers.pending.length, 1); // another save is lined up

    await timers.pending.pop().fn();
    assert.deepEqual(backend.writes, [0, 1]);
    assert.equal(autosave.isDirty(), false);
});

test("autosave retries failed saves with growing delays and keeps the changes", async () => {
    const timers = manualTimers();
    const backend = scriptedBackend([
        { ok: false, error: "down" },
        { ok: false, error: "down" },
        { ok: true, revision: 1 },
    ]);
    const statuses = [];
    const autosave = storage.createAutosave(backend, { getData: () => ({ logs: [] }), onStatus: (s) => statuses.push(s), ...timers });

    autosave.schedule();
    await timers.pending.pop().fn();
    assert.equal(statuses.at(-1).state, "error");
    assert.equal(statuses.at(-1).retryInMs, 1000);
    assert.equal(autosave.isDirty(), true);

    await timers.pending.pop().fn();
    assert.equal(statuses.at(-1).retryInMs, 2000);

    await timers.pending.pop().fn();
    assert.equal(statuses.at(-1).state, "saved");
    assert.equal(autosave.isDirty(), false);
    assert.equal(timers.pending.length, 0);
});

test("autosave stops on a conflict and can keep the other version", async () => {
    const timers = manualTimers();
    const theirs = { logs: [{ ID: 9 }], revision: 8 };
    const backend = scriptedBackend([{ ok: false, conflict: true, revision: 8, data: theirs }]);
    const statuses = [];
    const autosave = storage.createAutosave(backend, { revision: 7, getData: () => ({ logs: [] }), onStatus: (s) => statuses.push(s.state), ...timers });

    autosave.schedule();
    await timers.pending.pop().fn();
    assert.equal(statuses.at(-1), "conflict");
    assert.deepEqual(autosave.getConflict().data, theirs);
    assert.equal(timers.pending.length, 0); // no automatic retry over someone else's work

    autosave.schedule(); // further edits wait for the user's decision
    assert.equal(timers.pending.length, 0);

    autosave.acceptRemote();
    assert.equal(autosave.getRevision(), 8);
    assert.equal(autosave.isDirty(), false);
    assert.equal(statuses.at(-1), "saved");
});

test("autosave can overwrite the other version when the user chooses to", async () => {
    const timers = manualTimers();
    const backend = scriptedBackend([
        { ok: false, conflict: true, revision: 8, data: { logs: [] } },
        { ok: true, revision: 9 },
    ]);
    const autosave = storage.createAutosave(backend, { revision: 7, getData: () => ({ logs: [{ ID: 1 }] }), ...timers });

    autosave.schedule();
    await timers.pending.pop().fn();
    await autosave.overwrite();
    assert.equal(backend.writes[1].baseRevision, 8);
    assert.equal(autosave.getRevision(), 9);
    assert.equal(autosave.isDirty(), false);
});

test("conflict choices do nothing once the conflict is resolved (e.g. a second click)", async () => {
    const backend = scriptedBackend([]);
    const autosave = storage.createAutosave(backend, { revision: 3, getData: () => ({ logs: [] }), ...manualTimers() });
    autosave.acceptRemote();
    await autosave.overwrite();
    assert.equal(autosave.getRevision(), 3);
    assert.equal(backend.writes.length, 0);
});

test("autosave in read-only mode never writes", async () => {
    const timers = manualTimers();
    const backend = scriptedBackend([]);
    const autosave = storage.createAutosave(backend, { getData: () => ({ logs: [] }), ...timers });
    autosave.setReadOnly(true);
    autosave.schedule();
    await autosave.flush();
    assert.equal(timers.pending.length, 0);
    assert.equal(backend.writes.length, 0);
});

// --- one editing tab per session ------------------------------------------------

test("tab lock lets the first tab edit and makes later tabs read-only", async (t) => {
    const name = `devselftrace-test-${Math.random()}`;
    const first = storage.createTabLock(name, { waitMs: 50 });
    const second = storage.createTabLock(name, { waitMs: 50 });
    t.after(() => {
        first.close();
        second.close();
    });

    assert.equal(await first.claim(), true);
    assert.equal(await second.claim(), false);
});

test("tab lock tells read-only tabs when the editing tab goes away", async (t) => {
    const name = `devselftrace-test-${Math.random()}`;
    let released;
    const releasedSeen = new Promise((resolve) => (released = resolve));
    const first = storage.createTabLock(name, { waitMs: 50 });
    const second = storage.createTabLock(name, { waitMs: 50, onReleased: released });
    t.after(() => {
        first.close();
        second.close();
    });

    await first.claim();
    assert.equal(await second.claim(), false);
    first.release();
    await releasedSeen;

    const third = storage.createTabLock(name, { waitMs: 50 });
    t.after(() => third.close());
    assert.equal(await third.claim(), true);
});
