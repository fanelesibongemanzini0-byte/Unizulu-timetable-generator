const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const selectedList = document.getElementById("selectedList");
const generateBtn = document.getElementById("generateBtn");
const statusMsg = document.getElementById("statusMsg");
const timetablePanel = document.getElementById("timetablePanel");
const timetableGrid = document.getElementById("timetableGrid");
const clashWarning = document.getElementById("clashWarning");

const STORAGE_KEY = "unizulu-selected-modules";
let selectedModules = loadSelected();
let searchTimer = null;

renderSelected();

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) {
    searchResults.innerHTML = "";
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 300);
});

async function runSearch(q) {
  searchResults.innerHTML = `<p class="empty-hint">Searching...</p>`;
  try {
    const res = await fetch(`/api/modules?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error("search failed");
    const data = await res.json();
    renderResults(data.modules);
  } catch (err) {
    searchResults.innerHTML = `<p class="empty-hint">Couldn't reach the server. Is it running?</p>`;
  }
}

function renderResults(modules) {
  if (!modules.length) {
    searchResults.innerHTML = `<p class="empty-hint">No modules found.</p>`;
    return;
  }
  searchResults.innerHTML = "";
  modules.forEach((m) => {
    const alreadyAdded = selectedModules.some((s) => s.id === m.id);
    const row = document.createElement("div");
    row.className = "result-item";
    row.innerHTML = `
      <div class="name"><span class="code">${escapeHtml(m.code)}</span> — ${escapeHtml(m.title)}
        <div class="empty-hint">${escapeHtml(m.dept || "")}</div>
      </div>
      <button class="add-btn" ${alreadyAdded ? "disabled" : ""}>${alreadyAdded ? "Added" : "Add"}</button>
    `;
    row.querySelector(".add-btn").addEventListener("click", () => addModule(m));
    searchResults.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Selected modules
// ---------------------------------------------------------------------------
function addModule(m) {
  if (selectedModules.some((s) => s.id === m.id)) return;
  selectedModules.push(m);
  saveSelected();
  renderSelected();
  if (searchInput.value.trim().length >= 2) runSearch(searchInput.value.trim());
}

function removeModule(id) {
  selectedModules = selectedModules.filter((s) => s.id !== id);
  saveSelected();
  renderSelected();
}

function renderSelected() {
  if (!selectedModules.length) {
    selectedList.innerHTML = `<p class="empty-hint">No modules selected yet.</p>`;
    generateBtn.disabled = true;
    return;
  }
  selectedList.innerHTML = "";
  selectedModules.forEach((m) => {
    const row = document.createElement("div");
    row.className = "selected-item";
    row.innerHTML = `
      <div class="name"><span class="code">${escapeHtml(m.code)}</span> — ${escapeHtml(m.title)}</div>
      <button class="remove-btn">Remove</button>
    `;
    row.querySelector(".remove-btn").addEventListener("click", () => removeModule(m.id));
    selectedList.appendChild(row);
  });
  generateBtn.disabled = false;
}

function saveSelected() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedModules));
}
function loadSelected() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Generate timetable
// ---------------------------------------------------------------------------
generateBtn.addEventListener("click", async () => {
  statusMsg.textContent = "Building your timetable...";
  generateBtn.disabled = true;
  try {
    const res = await fetch("/api/timetable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleIds: selectedModules.map((m) => m.id) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to build timetable");

    if (data.failedModuleIds?.length) {
      statusMsg.textContent = `Warning: could not load ${data.failedModuleIds.length} module(s). They may not have a published timetable.`;
    } else {
      statusMsg.textContent = "";
    }

    renderTimetable(data.events, data.clashes);
  } catch (err) {
    statusMsg.textContent = "Something went wrong building the timetable.";
  } finally {
    generateBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Timetable grid (CSS Grid, built as plain <div>s - NOT a <table>)
// ---------------------------------------------------------------------------
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function toMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToLabel(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

// Visible class periods only (10-minute gaps between periods are not shown
// as their own columns) - 07:30 through 17:20, one 50-minute slot per hour.
function generateFixedSlots() {
  const slots = [];
  let cursor = toMinutes("07:30");
  const dayEnd = toMinutes("17:20");
  const CLASS_LEN = 50;
  const CYCLE = 60; // 50 min class + 10 min hidden gap

  while (cursor + CLASS_LEN <= dayEnd) {
    slots.push({ start: minutesToLabel(cursor), end: minutesToLabel(cursor + CLASS_LEN) });
    cursor += CYCLE;
  }
  return slots;
}

function slotOverlapsEvent(slot, ev) {
  const slotStart = toMinutes(slot.start);
  const slotEnd = toMinutes(slot.end);
  const evStart = toMinutes(ev.startTime);
  const evEnd = toMinutes(ev.endTime);
  return slotStart < evEnd && evStart < slotEnd;
}

// Work out which slot index each event starts and ends in (among the
// visible class-period slots only), so multi-hour events span the correct
// number of columns even though the gaps between periods are hidden.
function indexEventsToSlots(events, slots) {
  return events.map((e) => {
    let firstSlotIdx = -1;
    let lastSlotIdx = -1;
    slots.forEach((s, idx) => {
      if (slotOverlapsEvent(s, e)) {
        if (firstSlotIdx === -1) firstSlotIdx = idx;
        lastSlotIdx = idx;
      }
    });
    return { ...e, firstSlotIdx, lastSlotIdx };
  });
}

function renderTimetable(rawEvents, clashes) {
  timetablePanel.hidden = false;

  const clashingEventIds = new Set();
  clashes.forEach((c) => {
    clashingEventIds.add(c.eventIdA);
    clashingEventIds.add(c.eventIdB);
  });

  if (clashes.length) {
    clashWarning.hidden = false;
    clashWarning.textContent = `Heads up: ${clashes.length} clash(es) found between your selected modules. Clashing sessions are highlighted in red below.`;
  } else {
    clashWarning.hidden = true;
  }

  const slots = generateFixedSlots();
  let events = indexEventsToSlots(rawEvents, slots);

  // Safety net: if an event falls entirely outside 07:30-17:20 (rare - an
  // evening class), give it its own extra column instead of dropping it.
  events.filter((e) => e.firstSlotIdx === -1).forEach((e) => {
    slots.push({ start: e.startTime, end: e.endTime });
    e.firstSlotIdx = slots.length - 1;
    e.lastSlotIdx = slots.length - 1;
  });

  // Only show days that actually have events, in Mon-Sun order
  const usedDayIndexes = [...new Set(events.map((e) => e.dayIndex))].sort((a, b) => a - b);
  const daysToShow = usedDayIndexes.length ? usedDayIndexes : [0, 1, 2, 3, 4];

  // Column 1 = day label, columns 2..N+1 = time slots.
  timetableGrid.style.gridTemplateColumns = `110px repeat(${slots.length}, minmax(90px, 1fr))`;
  timetableGrid.style.gridTemplateRows = `44px repeat(${daysToShow.length}, minmax(60px, auto))`;

  let html = `<div class="tt-cell tt-head tt-daycol" style="grid-column:1;grid-row:1;">Day</div>`;
  slots.forEach((s, idx) => {
    html += `<div class="tt-cell tt-head" style="grid-column:${idx + 2};grid-row:1;">${s.start}-${s.end}</div>`;
  });

  daysToShow.forEach((d, rowIdx) => {
    const gridRow = rowIdx + 2;
    html += `<div class="tt-cell tt-daycol" style="grid-column:1;grid-row:${gridRow};">${DAYS[d]}</div>`;

    const dayEvents = events.filter((e) => e.dayIndex === d);
    let pointer = 0;
    while (pointer < slots.length) {
      const startingHere = dayEvents.filter((e) => e.firstSlotIdx === pointer);

      if (!startingHere.length) {
        html += `<div class="tt-cell tt-empty" style="grid-column:${pointer + 2};grid-row:${gridRow};"></div>`;
        pointer += 1;
        continue;
      }

      const colspan = Math.max(...startingHere.map((e) => e.lastSlotIdx)) - pointer + 1;
      html += `<div class="tt-cell" style="grid-column:${pointer + 2} / span ${colspan};grid-row:${gridRow};">`;
      html += `<div class="cell-inner">`;
      startingHere.forEach((ev) => {
        const isClash = clashingEventIds.has(ev.id);
        html += `
          <div class="event-block ${isClash ? "clashing" : ""}">
            <div class="ev-module">${escapeHtml(ev.module)}</div>
            <div class="ev-time">${escapeHtml(ev.prettyTimes || `${ev.startTime}-${ev.endTime}`)}</div>
            <div class="ev-meta">${escapeHtml(ev.room || "")}</div>
          </div>
        `;
      });
      html += `</div></div>`;
      pointer += colspan;
    }
  });

  timetableGrid.innerHTML = html;
  timetablePanel.scrollIntoView({ behavior: "smooth" });
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}