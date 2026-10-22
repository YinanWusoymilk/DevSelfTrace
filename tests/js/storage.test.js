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
        const route = routes[`${method} ${url}`];
        if (route instanceof Error) throw route;
        if (!route) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: route.status === undefined || route.status < 400, status: route.status || 200, json: async () => route.body };
    };
    fn.calls = calls;
    return fn;
}

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

test("server storage loads the logs file and the optional video path", async () => {
    const data = { logs: [{ ID: 1 }] };
    const fetchFn = fakeFetch({ "GET /files/json": { body: data } });
    const store = storage.createServerStorage(fetchFn, { json_path: "/files/json", video_path: "/files/video" });
    assert.deepEqual(await store.load(), { data: data, videoPath: "/files/video" });
});

test("server storage posts the whole session to /update_json", async () => {
    const fetchFn = fakeFetch({ "POST /update_json": { body: { status: "success" } } });
    const store = storage.createServerStorage(fetchFn, { json_path: "/files/json" });
    const data = { logs: [{ ID: 1 }] };
    assert.equal(await store.save(data), true);
    const call = fetchFn.calls.at(-1);
    assert.deepEqual(JSON.parse(call.options.body), data);
});

test("browser storage starts empty and round-trips a session", async () => {
    const area = fakeStorageArea();
    const store = storage.createBrowserStorage(area);
    assert.deepEqual(await store.load(), { data: { logs: [] }, videoPath: null });

    const data = { logs: [{ ID: 1, Label1: "To Implement Code" }] };
    assert.equal(await store.save(data), true);
    assert.deepEqual((await store.load()).data, data);
});

test("browser storage survives corrupted saved data", async () => {
    const area = fakeStorageArea({ [storage.BROWSER_KEY]: "{not json" });
    const store = storage.createBrowserStorage(area);
    assert.deepEqual((await store.load()).data, { logs: [] });
});

test("browser storage reports a failed save (e.g. storage full)", async () => {
    const area = fakeStorageArea();
    area.setItem = () => {
        throw new Error("QuotaExceededError");
    };
    const store = storage.createBrowserStorage(area);
    assert.equal(await store.save({ logs: [] }), false);
});
