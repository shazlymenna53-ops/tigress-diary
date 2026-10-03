(() => {
  "use strict";

  const STORAGE_KEY = "tigressDiary.v1";        // plain entries (no password)
  const VAULT_KEY = "tigressDiary.vault.v1";    // encrypted entries (with password)
  const PBKDF2_ITERATIONS = 250000;
  const MIN_PASSWORD = 6;

  const MOODS = [
    { key: "happy",    emoji: "🐯", label: "Happy" },
    { key: "fierce",   emoji: "🐅", label: "Fierce" },
    { key: "chill",    emoji: "🐆", label: "Chill" },
    { key: "loved",    emoji: "😻", label: "Loved" },
    { key: "excited",  emoji: "🤩", label: "Excited" },
    { key: "sleepy",   emoji: "😴", label: "Sleepy" },
    { key: "sad",      emoji: "🥺", label: "Sad" },
    { key: "stressed", emoji: "😵‍💫", label: "Stressed" }
  ];

  const STICKERS = [
    "🐯", "🐅", "🐆", "🎀", "💖", "🌸", "🌷", "✨", "⭐", "🍒",
    "🍓", "🦋", "💌", "🧸", "☕", "🎧", "💄", "💅", "👑", "🔥",
    "🌙", "📌", "🍰", "🖤", "🤍", "💋", "🕯️", "📷"
  ];

  /* ---------- Elements ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    sidebar: $("sidebar"), backdrop: $("backdrop"), menuBtn: $("menuBtn"),
    newBtn: $("newBtn"), search: $("search"), list: $("entryList"),
    prettyDate: $("prettyDate"), dateInput: $("dateInput"), moods: $("moods"),
    title: $("title"), text: $("text"), layer: $("stickerLayer"),
    wordCount: $("wordCount"), status: $("status"), deleteBtn: $("deleteBtn"),
    tray: $("trayGrid"), tools: $("stickerTools"),
    // password UI
    lockScreen: $("lockScreen"), lockForm: $("lockForm"), lockInput: $("lockInput"),
    lockError: $("lockError"), lockBtn: $("lockBtn"), forgotBtn: $("forgotBtn"),
    pwBtn: $("pwBtn"), lockNowBtn: $("lockNowBtn"),
    pwDialog: $("pwDialog"), pwForm: $("pwForm"), pwTitle: $("pwTitle"),
    pwNew: $("pwNew"), pwConfirm: $("pwConfirm"), pwError: $("pwError"),
    pwSave: $("pwSave"), pwCancel: $("pwCancel"), pwRemove: $("pwRemove")
  };

  /* ---------- State ---------- */
  let entries = [];
  let activeId = null;
  let selectedSticker = null;
  let saveTimer = null;
  let saveChain = Promise.resolve();

  let cryptoKey = null;   // set only while unlocked with a password
  let vaultSalt = null;

  const hasCrypto = !!(window.crypto && window.crypto.subtle);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /* ---------- Crypto helpers ---------- */
  function toB64(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      str += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(str);
  }

  function fromB64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey(
      "raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptEntries() {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, cryptoKey, encoder.encode(JSON.stringify(entries)));
    return { v: 1, salt: toB64(vaultSalt), iv: toB64(iv), data: toB64(cipher) };
  }

  /* ---------- Storage ---------- */
  function loadPlainEntries() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async function writeStorage() {
    try {
      if (cryptoKey) {
        localStorage.setItem(VAULT_KEY, JSON.stringify(await encryptEntries()));
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      }
      setStatus("Saved");
      return true;
    } catch {
      setStatus("Could not save");
      return false;
    }
  }

  // Saves run one after another so an older save can never overwrite a newer one
  function persist() {
    saveChain = saveChain.then(writeStorage);
    return saveChain;
  }

  function queueSave() {
    setStatus("Saving…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 350);
  }

  function setStatus(msg) { el.status.textContent = msg; }

  /* ---------- Helpers ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function prettyDate(iso, short = false) {
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return "Pick a date";
    return d.toLocaleDateString("en-US", short
      ? { month: "short", day: "numeric", year: "numeric" }
      : { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  const moodOf = (key) => MOODS.find((m) => m.key === key) || MOODS[0];
  const getActive = () => entries.find((e) => e.id === activeId);

  function touch() {
    const entry = getActive();
    if (!entry) return;
    entry.updated = Date.now();
    queueSave();
    renderList();
  }

  /* ---------- Entries ---------- */
  function createEntry(first = false) {
    const entry = {
      id: uid(),
      date: todayISO(),
      mood: "happy",
      title: first ? "My first page" : "",
      text: first ? "Hi diary 🐯\nThis is my little corner of the world. Write anything you want here, then decorate it with stickers!" : "",
      stickers: [],
      updated: Date.now()
    };
    entries.push(entry);
    return entry;
  }

  function openEntry(id) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    activeId = id;
    selectedSticker = null;

    el.dateInput.value = entry.date;
    el.prettyDate.textContent = prettyDate(entry.date);
    el.title.value = entry.title;
    el.text.value = entry.text;

    renderMoods();
    renderStickers();
    updateTools();
    autoGrow();
    updateWordCount();
    renderList();
    closeSidebar();
  }

  function deleteActive() {
    const entry = getActive();
    if (!entry) return;
    if (!confirm("Delete this page? This can't be undone.")) return;

    entries = entries.filter((e) => e.id !== entry.id);
    if (!entries.length) createEntry();
    persist();
    openEntry(sortedEntries()[0].id);
  }

  function sortedEntries() {
    return [...entries].sort((a, b) =>
      b.date.localeCompare(a.date) || b.updated - a.updated);
  }

  /* ---------- Rendering ---------- */
  function renderList() {
    const q = el.search.value.trim().toLowerCase();
    const items = sortedEntries().filter((e) =>
      !q || e.title.toLowerCase().includes(q) || e.text.toLowerCase().includes(q));

    el.list.innerHTML = "";

    if (!items.length) {
      const li = document.createElement("li");
      li.className = "empty-list";
      li.textContent = q ? "No pages match your search." : "No pages yet. Start a new one!";
      el.list.appendChild(li);
      return;
    }

    items.forEach((e) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "entry-item" + (e.id === activeId ? " active" : "");
      btn.innerHTML =
        '<span class="entry-emoji"></span>' +
        '<span><span class="entry-title"></span><span class="entry-meta"></span></span>';
      btn.querySelector(".entry-emoji").textContent = moodOf(e.mood).emoji;
      btn.querySelector(".entry-title").textContent = e.title || "Untitled page";
      btn.querySelector(".entry-meta").textContent = prettyDate(e.date, true);
      btn.addEventListener("click", () => openEntry(e.id));
      li.appendChild(btn);
      el.list.appendChild(li);
    });
  }

  function renderMoods() {
    const entry = getActive();
    el.moods.innerHTML = "";
    MOODS.forEach((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mood";
      b.setAttribute("aria-pressed", String(entry && entry.mood === m.key));
      b.innerHTML = '<span class="mood-emoji"></span><span></span>';
      b.children[0].textContent = m.emoji;
      b.children[1].textContent = m.label;
      b.addEventListener("click", () => {
        entry.mood = m.key;
        renderMoods();
        touch();
      });
      el.moods.appendChild(b);
    });
  }

  function renderTray() {
    STICKERS.forEach((emoji) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = emoji;
      b.setAttribute("aria-label", "Add sticker " + emoji);
      b.addEventListener("click", () => addSticker(emoji));
      el.tray.appendChild(b);
    });
  }

  /* ---------- Stickers ---------- */
  function renderStickers() {
    const entry = getActive();
    el.layer.innerHTML = "";
    entry.stickers.forEach(buildSticker);
  }

  function applyStickerStyle(node, s) {
    node.style.left = s.x + "%";
    node.style.top = s.y + "%";
    node.style.fontSize = s.size + "px";
    node.style.transform = `translate(-50%, -50%) rotate(${s.rot}deg)`;
  }

  function buildSticker(s) {
    const node = document.createElement("div");
    node.className = "sticker";
    node.dataset.id = s.id;
    node.textContent = s.emoji;
    applyStickerStyle(node, s);

    node.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      selectSticker(s.id);
      node.setPointerCapture(ev.pointerId);

      const move = (e) => {
        const rect = el.layer.getBoundingClientRect();
        s.x = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
        s.y = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
        applyStickerStyle(node, s);
      };
      const up = () => {
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        node.removeEventListener("pointercancel", up);
        touch();
      };
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", up);
      node.addEventListener("pointercancel", up);
    });

    el.layer.appendChild(node);
    return node;
  }

  function addSticker(emoji) {
    const entry = getActive();
    const s = {
      id: uid(),
      emoji,
      x: 30 + Math.random() * 40,
      y: 12 + Math.random() * 30,
      size: 56,
      rot: Math.round(Math.random() * 30 - 15)
    };
    entry.stickers.push(s);
    buildSticker(s);
    selectSticker(s.id);
    touch();
  }

  function selectSticker(id) {
    selectedSticker = id;
    el.layer.querySelectorAll(".sticker").forEach((n) =>
      n.classList.toggle("selected", n.dataset.id === id));
    updateTools();
  }

  function deselectSticker() {
    if (!selectedSticker) return;
    selectedSticker = null;
    el.layer.querySelectorAll(".sticker.selected").forEach((n) => n.classList.remove("selected"));
    updateTools();
  }

  function updateTools() { el.tools.hidden = !selectedSticker; }

  function getSelected() {
    const entry = getActive();
    return entry && entry.stickers.find((s) => s.id === selectedSticker);
  }

  function toolAction(act) {
    const s = getSelected();
    if (!s) return;

    if (act === "bigger") s.size = clamp(s.size + 8, 24, 200);
    if (act === "smaller") s.size = clamp(s.size - 8, 24, 200);
    if (act === "rotL") s.rot -= 15;
    if (act === "rotR") s.rot += 15;

    if (act === "remove") {
      const entry = getActive();
      entry.stickers = entry.stickers.filter((x) => x.id !== s.id);
      selectedSticker = null;
      renderStickers();
      updateTools();
    } else {
      const node = el.layer.querySelector(`[data-id="${s.id}"]`);
      if (node) applyStickerStyle(node, s);
    }
    touch();
  }

  /* ---------- Text area ---------- */
  function autoGrow() {
    el.text.style.height = "auto";
    el.text.style.height = Math.max(el.text.scrollHeight, 420) + "px";
  }

  function updateWordCount() {
    const words = el.text.value.trim().split(/\s+/).filter(Boolean).length;
    el.wordCount.textContent = words + (words === 1 ? " word" : " words");
  }

  /* ---------- Sidebar (mobile) ---------- */
  function openSidebar() {
    el.sidebar.classList.add("open");
    el.backdrop.classList.add("show");
  }
  function closeSidebar() {
    el.sidebar.classList.remove("open");
    el.backdrop.classList.remove("show");
  }

  /* ---------- Password: lock screen ---------- */
  function showLock() {
    el.lockScreen.hidden = false;
    el.lockInput.value = "";
    el.lockError.textContent = "";
    el.lockInput.focus();
  }

  async function tryUnlock() {
    const password = el.lockInput.value;
    if (!password) return;

    el.lockBtn.disabled = true;
    el.lockError.textContent = "";

    try {
      const vault = JSON.parse(localStorage.getItem(VAULT_KEY));
      const salt = fromB64(vault.salt);
      const key = await deriveKey(password, salt);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(vault.iv) }, key, fromB64(vault.data));

      entries = JSON.parse(decoder.decode(plain));
      cryptoKey = key;
      vaultSalt = salt;

      el.lockScreen.hidden = true;
      startApp();
    } catch {
      el.lockError.textContent = "That's not the right password. Try again.";
      el.lockInput.select();
      el.lockForm.classList.remove("shake");
      void el.lockForm.offsetWidth; // restart the animation
      el.lockForm.classList.add("shake");
    } finally {
      el.lockBtn.disabled = false;
    }
  }

  function forgotPassword() {
    const ok = confirm(
      "A forgotten password can't be recovered.\n\n" +
      "You can erase everything on this device and start fresh. " +
      "ALL diary pages will be deleted for good.\n\nErase everything?");
    if (!ok) return;
    localStorage.removeItem(VAULT_KEY);
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  async function lockNow() {
    clearTimeout(saveTimer);
    await persist();
    location.reload(); // reloading wipes the decrypted pages from memory
  }

  /* ---------- Password: set / change / remove ---------- */
  function updateSecurityUI() {
    const locked = !!cryptoKey;
    el.pwBtn.textContent = locked ? "🔒 Change password" : "🔒 Set password";
    el.lockNowBtn.hidden = !locked;
  }

  function openPasswordDialog() {
    if (!hasCrypto) {
      alert("Passwords need a secure page. Open the diary from https:// or from localhost, or use a recent version of Chrome, Edge, Firefox, or Safari.");
      return;
    }
    const has = !!cryptoKey;
    el.pwTitle.textContent = has ? "Change password" : "Set a password";
    el.pwSave.textContent = has ? "Update password" : "Save password";
    el.pwRemove.hidden = !has;
    el.pwNew.value = "";
    el.pwConfirm.value = "";
    el.pwError.textContent = "";
    el.pwDialog.showModal();
    el.pwNew.focus();
  }

  async function savePassword() {
    const a = el.pwNew.value;
    const b = el.pwConfirm.value;

    if (a.length < MIN_PASSWORD) {
      el.pwError.textContent = `Use at least ${MIN_PASSWORD} characters.`;
      return;
    }
    if (a !== b) {
      el.pwError.textContent = "The two passwords don't match.";
      return;
    }

    el.pwSave.disabled = true;
    try {
      clearTimeout(saveTimer);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      cryptoKey = await deriveKey(a, salt);
      vaultSalt = salt;

      const ok = await persist();
      if (!ok) throw new Error("save failed");

      // Only remove the unprotected copy once the encrypted one is safely stored
      localStorage.removeItem(STORAGE_KEY);
      el.pwDialog.close();
      updateSecurityUI();
    } catch {
      el.pwError.textContent = "Something went wrong. Your password was not changed.";
    } finally {
      el.pwSave.disabled = false;
    }
  }

  async function removePassword() {
    if (!confirm("Remove the password? Your pages will be stored without protection on this device.")) return;

    clearTimeout(saveTimer);
    cryptoKey = null;
    vaultSalt = null;

    const ok = await persist(); // writes the plain copy
    if (ok) {
      localStorage.removeItem(VAULT_KEY);
      el.pwDialog.close();
      updateSecurityUI();
    }
  }

  /* ---------- Events ---------- */
  el.newBtn.addEventListener("click", () => {
    const entry = createEntry();
    persist();
    openEntry(entry.id);
    el.title.focus();
  });

  el.search.addEventListener("input", renderList);

  el.title.addEventListener("input", () => {
    getActive().title = el.title.value;
    touch();
  });

  el.text.addEventListener("input", () => {
    getActive().text = el.text.value;
    autoGrow();
    updateWordCount();
    touch();
  });

  el.dateInput.addEventListener("change", () => {
    if (!el.dateInput.value) return;
    getActive().date = el.dateInput.value;
    el.prettyDate.textContent = prettyDate(el.dateInput.value);
    touch();
  });

  el.deleteBtn.addEventListener("click", deleteActive);

  el.tools.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (btn) toolAction(btn.dataset.act);
  });

  document.addEventListener("pointerdown", (ev) => {
    if (!ev.target.closest(".sticker, .sticker-tools")) deselectSticker();
  });

  document.addEventListener("keydown", (ev) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (selectedSticker && !typing && (ev.key === "Delete" || ev.key === "Backspace")) {
      ev.preventDefault();
      toolAction("remove");
    }
  });

  el.menuBtn.addEventListener("click", openSidebar);
  el.backdrop.addEventListener("click", closeSidebar);
  window.addEventListener("resize", autoGrow);

  // password events
  el.lockForm.addEventListener("submit", (ev) => { ev.preventDefault(); tryUnlock(); });
  el.forgotBtn.addEventListener("click", forgotPassword);
  el.pwBtn.addEventListener("click", openPasswordDialog);
  el.lockNowBtn.addEventListener("click", lockNow);
  el.pwForm.addEventListener("submit", (ev) => { ev.preventDefault(); savePassword(); });
  el.pwCancel.addEventListener("click", () => el.pwDialog.close());
  el.pwRemove.addEventListener("click", removePassword);

  // Make sure the text area is sized correctly once the handwriting font loads
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(autoGrow);

  /* ---------- Start ---------- */
  function startApp() {
    if (!entries.length) {
      createEntry(true);
      persist();
    }
    openEntry(sortedEntries()[0].id);
    updateSecurityUI();
  }

  renderTray();

  if (localStorage.getItem(VAULT_KEY)) {
    if (hasCrypto) {
      showLock();           // pages stay encrypted until the right password is entered
    } else {
      el.lockScreen.hidden = false;
      el.lockForm.innerHTML =
        '<div class="lock-emoji">🐯</div><h2>Tigress Diary</h2>' +
        "<p>This page can't unlock your diary here. Open it from https:// or localhost, or use a recent browser.</p>";
    }
  } else {
    entries = loadPlainEntries();
    startApp();
  }

  // Lets the diary install as an app and open offline (needs http/https, not file://)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
