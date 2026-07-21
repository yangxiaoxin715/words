const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function makeElement(id = "") {
  const classes = new Set(["hidden"]);
  return {
    id,
    textContent: "",
    value: "",
    disabled: false,
    dataset: {},
    style: {},
    listeners: {},
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      toggle(name, force) {
        const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(type, callback) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(callback);
    },
    appendChild() {},
    remove() {},
    click() {
      (this.listeners.click || []).forEach((callback) => callback({ preventDefault() {} }));
    },
  };
}

function createHarness() {
  const ids = [
    "todaySeen",
    "todayTime",
    "seenTotal",
    "loginView",
    "learningView",
    "loginForm",
    "loginCode",
    "loginPassword",
    "loginError",
    "logoutBtn",
    "homePanel",
    "sessionPanel",
    "startSessionBtn",
    "sessionBackBtn",
    "sessionTitle",
    "sessionCounter",
    "newFriendTotal",
    "knownTotal",
    "familiarTotal",
    "coreTodaySeen",
    "coreTodayTime",
    "customTodaySeen",
    "customTodayTime",
    "streakDays",
    "stageLabel",
    "stageCaptured",
    "stageTarget",
    "stageRemaining",
    "stageProgressFill",
    "sprintStageBtn",
    "reviewStageBtn",
    "advanceStageBtn",
    "customPackProgress",
    "customPackFile",
    "importCustomPackBtn",
    "loadCustomPackBtn",
    "customPackStatus",
    "sessionProgress",
    "progressFill",
    "countdownTrack",
    "countdownFill",
    "wordPosition",
    "wordText",
    "meaningText",
    "responseButtons",
    "nextRoundBtn",
    "cardFace",
    "speakBtn",
    "huntModeBtn",
    "manualModeBtn",
    "huntStatus",
    "learningCode",
    "exportDataBtn",
    "exportStatus",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
  const responseButtons = ["known", "vague", "new"].map((response) => {
    const button = makeElement();
    button.dataset.response = response;
    return button;
  });
  const timers = new Map();
  const audioInstances = [];
  const speechCalls = [];
  const fetchCalls = [];
  let nextTimerId = 1;
  let audioPlayIndex = 0;
  function TestFormData() {
    this.fields = [];
  }
  TestFormData.prototype.append = function append(name, value) {
    this.fields.push([name, value]);
  };
  TestFormData.prototype.get = function get(name) {
    const found = this.fields.find(([fieldName]) => fieldName === name);
    return found ? found[1] : null;
  };

  const context = vm.createContext({
    console,
    Date,
    JSON,
    Math,
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    Blob: function Blob() {},
    FormData: TestFormData,
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    document: {
      body: makeElement("body"),
      getElementById(id) {
        if (!elements[id]) elements[id] = makeElement(id);
        return elements[id];
      },
      querySelectorAll(selector) {
        if (selector === "[data-response]") return responseButtons;
        return [];
      },
      createElement() {
        return makeElement();
      },
    },
    fetch(url, options = {}) {
      fetchCalls.push({ url, options });
      const urlText = String(url);
      if (urlText.includes("/custom-pack/deck")) {
        return Promise.resolve({
          ok: true,
          headers: { get() { return ""; } },
          json: () => Promise.resolve({
            cards: [
              { pack_word_id: 1, word: "again", meaning: "再一次" },
              { pack_word_id: 2, word: "round", meaning: "一轮" },
            ],
            pack_summary: {
              name: "导入词包",
              total: 2,
              captured: 2,
              remaining: 0,
              complete: true,
            },
          }),
          blob: () => Promise.resolve(new Blob()),
        });
      }
      if (urlText.includes("/custom-pack/upload") && options.method === "POST") {
        const queryName = (urlText.match(/[?&]name=([^&]+)/) || [])[1] || "";
        const name = queryName ? decodeURIComponent(queryName.replace(/\+/g, " ")) : "导入词包";
        const uploadedFile = typeof options.body?.get === "function" ? options.body.get("file") : options.body;
        const lines = String(uploadedFile?.readerText || "").trim().split(/\r?\n/).filter(Boolean);
        return Promise.resolve({
          ok: true,
          headers: { get() { return ""; } },
          json: () => Promise.resolve({
            pack_summary: {
              name,
              total: Math.max(lines.length - 1, 0),
              captured: 0,
              remaining: Math.max(lines.length - 1, 0),
              complete: false,
            },
          }),
          blob: () => Promise.resolve(new Blob()),
        });
      }
      if (urlText.includes("/custom-pack") && options.method === "POST") {
        const body = JSON.parse(options.body || "{}");
        const lines = String(body.csv_text || "").trim().split(/\r?\n/).filter(Boolean);
        return Promise.resolve({
          ok: true,
          headers: { get() { return ""; } },
          json: () => Promise.resolve({
            pack_summary: {
              name: body.name || "导入词包",
              total: Math.max(lines.length - 1, 0),
              captured: 0,
              remaining: Math.max(lines.length - 1, 0),
              complete: false,
            },
          }),
          blob: () => Promise.resolve(new Blob()),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: { get() { return ""; } },
        json: () => Promise.resolve({
          dashboard: {
            today_seen: fetchCalls.length,
            seen_total: fetchCalls.length,
            core_today_seen: fetchCalls.length,
            custom_today_seen: 0,
            today_elapsed_ms: fetchCalls.length * 900,
            core_today_elapsed_ms: fetchCalls.length * 900,
            custom_today_elapsed_ms: 0,
            new_friend_total: fetchCalls.length,
            known_total: 0,
            familiar_total: 0,
            streak_days: 1,
            stage_capture: {
              label: "第一组",
              target: 200,
              captured: 0,
              remaining: 200,
              complete: false,
              next_stage_number: 2,
              next_stage_label: "第二组",
            },
          },
        }),
        blob: () => Promise.resolve(new Blob()),
      });
    },
    Audio: function Audio(src) {
      const audio = {
        src,
        currentTime: 0,
        playCalls: 0,
        pauseCalls: 0,
        play() {
          this.playCalls += 1;
          audioPlayIndex += 1;
          if (audioPlayIndex === 3) return new Promise(() => {});
          return Promise.resolve();
        },
        pause() {
          this.pauseCalls += 1;
        },
      };
      audioInstances.push(audio);
      return audio;
    },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) {
      this.text = text;
      this.lang = "";
      this.rate = 1;
    },
    FileReader: function FileReader() {
      this.result = "";
      this.error = null;
      this.onload = null;
      this.onerror = null;
      this.readAsText = (file) => {
        if (file.readerError) {
          this.error = file.readerError;
          if (this.onerror) this.onerror();
          return;
        }
        this.result = file.readerText || "";
        if (this.onload) this.onload();
      };
    },
    speechSynthesis: {
      cancel() {},
      speak(utterance) {
        speechCalls.push(utterance.text);
      },
    },
    setTimeout(callback, delay = 0) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay, order: id });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(callback) {
      callback();
      return 0;
    },
  });
  context.window = context;
  context.globalThis = context;

  const script = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  vm.runInContext(script, context);

  return {
    context,
    elements,
    audioInstances,
    speechCalls,
    fetchCalls,
    run(code) {
      return vm.runInContext(code, context);
    },
    async flush() {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
    runNextTimer() {
      const next = [...timers.entries()]
        .sort((a, b) => a[1].delay - b[1].delay || a[1].order - b[1].order)[0];
      if (!next) throw new Error("No timer to run");
      timers.delete(next[0]);
      next[1].callback();
    },
    timerCount() {
      return timers.size;
    },
  };
}

async function testConsecutiveNewFriendsKeepAutomaticAudioMoving() {
  const h = createHarness();
  h.run(`
    state.learnerId = 1;
    state.sessionToken = "session";
    state.stageCapture = { label: "第一组", target: 200, captured: 0, remaining: 200 };
    state.cards = [
      { word_id: 1, word: "alpha", meaning: "A" },
      { word_id: 2, word: "beta", meaning: "B" },
      { word_id: 3, word: "gamma", meaning: "C" }
    ];
    state.index = 0;
    state.mode = "hunt";
    startHuntMode();
  `);
  await h.flush();

  assert.equal(h.audioInstances.length, 1);
  assert.equal(h.audioInstances[0].playCalls, 1);

  h.runNextTimer();
  h.runNextTimer();
  await h.flush();

  assert.equal(h.audioInstances.length, 2);
  assert.equal(h.audioInstances[1].playCalls, 1);

  h.runNextTimer();
  h.runNextTimer();
  await h.flush();

  assert.equal(h.audioInstances.length, 3);
  assert.equal(h.audioInstances[2].playCalls, 1);
  assert.ok(h.timerCount() > 0, "third card should not be waiting forever on audio.play()");

  h.runNextTimer();
  await h.flush();
  assert.deepEqual(h.speechCalls, ["gamma"]);
  assert.ok(h.timerCount() > 0, "hunt countdown should continue after audio fallback");
}

async function testImportPackUsesFileReaderWhenDirectTextReadFails() {
  const h = createHarness();
  h.run(`
    state.learnerId = 1;
    state.sessionToken = "session";
  `);
  h.elements.customPackFile.files = [{
    name: "测试词包.csv",
    readerText: "word,meaning\ncompass,指南针\nbattle,战斗\n",
    text() {
      return Promise.reject(new Error("The I/O read operation failed."));
    },
  }];

  const csvText = await h.run("readCustomPackFile(el.customPackFile.files[0])");
  assert.match(csvText, /compass/);

  await h.run("importCustomPack()");
  await h.flush();

  assert.equal(h.elements.customPackStatus.textContent, "已导入词包，可以点击刷导入词包");
  assert.match(h.elements.customPackProgress.textContent, /已导入：测试词包/);
  assert.match(h.elements.customPackProgress.textContent, /2/);
  assert.equal(h.elements.customPackFile.value, "");
}

async function testImportPackUploadsRawFileWhenBrowserCannotReadFile() {
  const h = createHarness();
  h.run(`
    state.learnerId = 1;
    state.sessionToken = "session";
  `);
  h.elements.customPackFile.files = [{
    name: "坏文件.csv",
    readerText: "word,meaning\ncompass,指南针\nbattle,战斗\n",
    readerError: new Error("The I/O read operation failed."),
    text() {
      return Promise.reject(new Error("The I/O read operation failed."));
    },
  }];

  await h.run("importCustomPack()");
  await h.flush();

  assert.equal(h.elements.customPackStatus.textContent, "已导入词包，可以点击刷导入词包");
  assert.match(h.elements.customPackProgress.textContent, /已导入：坏文件/);
  assert.equal(
    h.fetchCalls.some((call) => String(call.url).includes("/custom-pack/upload")),
    true,
  );
  const uploadCall = h.fetchCalls.find((call) => String(call.url).includes("/custom-pack/upload"));
  assert.equal(uploadCall.options.body instanceof h.context.FormData, true);
  assert.equal(uploadCall.options.headers["Content-Type"], undefined);
}

async function testCustomPackCompletionStillAllowsAnotherRound() {
  const h = createHarness();
  h.run(`
    state.learnerId = 1;
    state.sessionToken = "session";
    state.deckSource = "custom";
    state.customPack = {
      name: "本周词包",
      total: 2,
      captured: 2,
      remaining: 0,
      complete: true
    };
    state.cards = [];
    state.index = 2;
    renderCard();
  `);
  await h.flush();

  assert.equal(h.elements.wordPosition.textContent, "本轮完成 · 本轮用时 0秒");
  assert.equal(h.elements.wordText.textContent, "再来一轮");
  assert.equal(h.elements.nextRoundBtn.classList.contains("hidden"), false);
}

async function testCustomPackCompletionCardStartsAnotherRound() {
  const h = createHarness();
  h.run(`
    state.learnerId = 1;
    state.sessionToken = "session";
    state.deckSource = "custom";
    state.customPack = {
      name: "本周词包",
      total: 2,
      captured: 2,
      remaining: 0,
      complete: true
    };
    state.cards = [];
    state.index = 2;
    renderCard();
  `);

  h.elements.cardFace.click();
  await h.flush();

  assert.equal(
    h.fetchCalls.some((call) => String(call.url).includes("/custom-pack/deck")),
    true,
  );
  assert.equal(h.run("state.cards.length"), 2);
  assert.equal(h.elements.wordText.textContent, "again");
}

async function testDashboardRendersCombinedActionCountsAndSourceSplit() {
  const h = createHarness();
  h.run(`
    updateDashboard({
      today_seen: 120,
      seen_total: 580,
      core_today_seen: 100,
      custom_today_seen: 20,
      today_elapsed_ms: 65000,
      core_today_elapsed_ms: 50000,
      custom_today_elapsed_ms: 15000,
      known_total: 66,
      familiar_total: 8,
      new_friend_total: 26,
      streak_days: 3,
      stage_capture: {
        label: "第一组",
        target: 200,
        captured: 66,
        remaining: 134,
        complete: false,
        next_stage_number: 2,
        next_stage_label: "第二组"
      }
    });
  `);

  assert.equal(h.elements.todaySeen.textContent, 120);
  assert.equal(h.elements.todayTime.textContent, "1分05秒");
  assert.equal(h.elements.seenTotal.textContent, 580);
  assert.equal(h.elements.coreTodaySeen.textContent, 100);
  assert.equal(h.elements.coreTodayTime.textContent, "50秒");
  assert.equal(h.elements.customTodaySeen.textContent, 20);
  assert.equal(h.elements.customTodayTime.textContent, "15秒");
  assert.equal(h.elements.knownTotal.textContent, 66);
}

async function main() {
  await testConsecutiveNewFriendsKeepAutomaticAudioMoving();
  await testImportPackUsesFileReaderWhenDirectTextReadFails();
  await testImportPackUploadsRawFileWhenBrowserCannotReadFile();
  await testCustomPackCompletionStillAllowsAnotherRound();
  await testCustomPackCompletionCardStartsAnotherRound();
  await testDashboardRendersCombinedActionCountsAndSourceSplit();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
