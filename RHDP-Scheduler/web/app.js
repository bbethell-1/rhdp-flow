/* RHDP-Flow Web UI — Vanilla JS */
"use strict";

const API = "/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api(path, opts = {}) {
  const url = API + path;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res;
}

function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => (el.className = "toast"), 3000);
}

function statusClass(status) {
  if (!status) return "";
  const s = status.toLowerCase().replace(/[^a-z_]/g, "");
  if (s.includes("verified") && !s.includes("unverified")) return "status-verified";
  if (s.includes("unverified") || s.includes("no_url")) return "status-deployed_unverified";
  if (s.includes("failed") || s.includes("error")) return "status-failed";
  return "";
}

function truncate(s, n = 40) {
  return s && s.length > n ? s.slice(0, n) + "..." : s || "";
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

async function checkHealth() {
  const badge = document.getElementById("healthBadge");
  try {
    const res = await api("/health");
    const data = await res.json();
    if (data.oc_connected) {
      badge.textContent = "oc: " + data.user + " @ " + data.cluster_url;
      badge.style.color = "#3e8635";
    } else if (data.oc_installed) {
      badge.textContent = "oc: disconnected";
      badge.title = data.message || "";
      badge.style.color = "#ee0000";
    } else {
      badge.textContent = "oc: not installed";
      badge.style.color = "#ee0000";
    }
  } catch {
    badge.textContent = "API: offline";
    badge.style.color = "#ee0000";
  }
}

// ---------------------------------------------------------------------------
// TAB 1: Upload & Deploy
// ---------------------------------------------------------------------------

document.getElementById("btnUpload").addEventListener("click", async () => {
  const fileInput = document.getElementById("csvFile");
  if (!fileInput.files.length) return toast("Select a CSV file first", "error");

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  try {
    const res = await fetch(API + "/schedules/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Upload failed");
    }
    const data = await res.json();
    renderSchedules(data.schedules);
    toast("Loaded " + data.count + " schedule(s)", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

function renderSchedules(schedules) {
  const tbody = document.querySelector("#scheduleTable tbody");
  tbody.innerHTML = "";
  schedules.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.ci_name)}</td>
      <td title="${escapeHtml(s.ci)}">${escapeHtml(truncate(s.ci, 50))}</td>
      <td>${escapeHtml(s.namespace)}</td>
      <td>${s.users}</td>
      <td>${s.enable_workshop_interface ? "Yes" : "No"}</td>
      <td>${escapeHtml(s.provisioning_date)}</td>
      <td>${escapeHtml(s.auto_stop)}</td>
      <td>${escapeHtml(s.auto_destroy)}</td>
      <td>${s.count}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("scheduleCount").textContent = schedules.length;
  document.getElementById("schedulePreview").style.display = "block";
}

// Dry-run
document.getElementById("btnDryRun").addEventListener("click", async () => {
  try {
    const res = await api("/deploy/dry-run", { method: "POST", body: JSON.stringify({}) });
    const data = await res.json();
    renderResults(data);
    // Switch to deployments tab
    document.querySelector('[data-tab="deployments"]').click();
    toast("Dry-run complete: " + data.length + " result(s)", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

// Deploy (real)
document.getElementById("btnDeploy").addEventListener("click", async () => {
  const dryRun = document.getElementById("globalDryRun").checked;
  try {
    const res = await api("/deploy", {
      method: "POST",
      body: JSON.stringify({ dry_run: dryRun }),
    });
    const data = await res.json();
    toast("Deployment started: job " + data.job_id, "success");
    showProgress(data.job_id);
  } catch (e) {
    toast(e.message, "error");
  }
});

function showProgress(jobId) {
  const wrap = document.getElementById("deployProgress");
  const fill = document.getElementById("progressFill");
  const msg = document.getElementById("progressMsg");
  const log = document.getElementById("deployLog");
  wrap.style.display = "block";
  log.textContent = "";
  fill.style.width = "0%";

  const es = new EventSource(API + "/deploy/stream/" + jobId);
  es.addEventListener("status", (e) => {
    const d = JSON.parse(e.data);
    fill.style.width = d.progress + "%";
    msg.textContent = d.message || d.status;
    log.textContent += d.message + "\n";
    log.scrollTop = log.scrollHeight;
    if (d.status === "completed" || d.status === "failed") {
      es.close();
      if (d.status === "completed") {
        toast("Deployment completed!", "success");
        refreshResults();
      } else {
        toast("Deployment failed: " + (d.error || ""), "error");
      }
    }
  });
  es.addEventListener("error", () => {
    es.close();
    // Poll final status
    refreshResults();
  });
}

// ---------------------------------------------------------------------------
// TAB 2: Deployments
// ---------------------------------------------------------------------------

document.getElementById("btnRefreshResults").addEventListener("click", refreshResults);

async function refreshResults() {
  try {
    const res = await api("/deploy/results");
    const data = await res.json();
    renderResults(data);
  } catch (e) {
    toast(e.message, "error");
  }
}

function renderResults(results) {
  const tbody = document.querySelector("#resultsTable tbody");
  const empty = document.getElementById("resultsEmpty");
  tbody.innerHTML = "";
  if (!results.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  results.forEach((r) => {
    const tr = document.createElement("tr");
    const urlHtml = r.url
      ? `<a href="${escapeHtml(r.url)}" target="_blank">${escapeHtml(truncate(r.url, 50))}</a>`
      : "-";
    tr.innerHTML = `
      <td>${escapeHtml(r.ci_name)}</td>
      <td title="${escapeHtml(r.ci)}">${escapeHtml(truncate(r.ci, 40))}</td>
      <td>${escapeHtml(r.guid)}</td>
      <td class="${statusClass(r.status)}">${escapeHtml(r.status)}</td>
      <td>${urlHtml}</td>
      <td>${escapeHtml(r.provisioning_date)}</td>
      <td>${escapeHtml(r.timestamp)}</td>
      <td>${escapeHtml(truncate(r.error_message, 30))}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("btnDownloadResults").addEventListener("click", () => {
  window.location.href = API + "/export/results";
});

// ---------------------------------------------------------------------------
// TAB 3: Operations
// ---------------------------------------------------------------------------

function opsLog(msg) {
  const log = document.getElementById("opsLog");
  log.textContent += "\n" + new Date().toLocaleTimeString() + " " + msg;
  log.scrollTop = log.scrollHeight;
}

document.getElementById("btnLock").addEventListener("click", async () => {
  try {
    const res = await api("/operations/lock", { method: "POST", body: JSON.stringify({}) });
    const data = await res.json();
    opsLog(data.message);
    toast(data.message, "success");
  } catch (e) {
    opsLog("ERROR: " + e.message);
    toast(e.message, "error");
  }
});

document.getElementById("btnExtendStop").addEventListener("click", async () => {
  const days = parseInt(document.getElementById("extStopDays").value) || 0;
  const hours = parseInt(document.getElementById("extStopHours").value) || 0;
  try {
    const res = await api("/operations/extend-stop", {
      method: "POST",
      body: JSON.stringify({ days, hours }),
    });
    const data = await res.json();
    opsLog(data.message);
    toast(data.message, "success");
  } catch (e) {
    opsLog("ERROR: " + e.message);
    toast(e.message, "error");
  }
});

document.getElementById("btnExtendDestroy").addEventListener("click", async () => {
  const days = parseInt(document.getElementById("extDestroyDays").value) || 0;
  const hours = parseInt(document.getElementById("extDestroyHours").value) || 0;
  try {
    const res = await api("/operations/extend-destroy", {
      method: "POST",
      body: JSON.stringify({ days, hours }),
    });
    const data = await res.json();
    opsLog(data.message);
    toast(data.message, "success");
  } catch (e) {
    opsLog("ERROR: " + e.message);
    toast(e.message, "error");
  }
});

document.getElementById("btnScale").addEventListener("click", async () => {
  const target_count = parseInt(document.getElementById("scaleCount").value) || 0;
  try {
    const res = await api("/operations/scale", {
      method: "POST",
      body: JSON.stringify({ target_count }),
    });
    const data = await res.json();
    opsLog(data.message);
    toast(data.message, "success");
  } catch (e) {
    opsLog("ERROR: " + e.message);
    toast(e.message, "error");
  }
});

// ---------------------------------------------------------------------------
// TAB 4: QA
// ---------------------------------------------------------------------------

document.getElementById("btnRunQA").addEventListener("click", async () => {
  const type = document.getElementById("qaType").value;
  try {
    toast("Running QA...", "");
    const res = await api("/qa/run", {
      method: "POST",
      body: JSON.stringify({ type }),
    });
    const data = await res.json();
    renderQA(data.results);
    toast("QA complete: " + data.count + " result(s)", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

document.getElementById("btnRefreshQA").addEventListener("click", async () => {
  try {
    const res = await api("/qa/results");
    const data = await res.json();
    renderQA(data.results);
  } catch (e) {
    toast(e.message, "error");
  }
});

function renderQA(results) {
  const tbody = document.querySelector("#qaTable tbody");
  const empty = document.getElementById("qaEmpty");
  document.getElementById("qaCount").textContent = results.length;
  tbody.innerHTML = "";
  if (!results.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  results.forEach((r) => {
    const tr = document.createElement("tr");
    const landing = r.landing_page_url
      ? `<a href="${escapeHtml(r.landing_page_url)}" target="_blank">${escapeHtml(truncate(r.landing_page_url, 45))}</a>`
      : "-";
    tr.innerHTML = `
      <td>${escapeHtml(r.ci_name || "")}</td>
      <td title="${escapeHtml(r.ci || "")}">${escapeHtml(truncate(r.ci || "", 40))}</td>
      <td>${escapeHtml(r.status || "")}</td>
      <td>${escapeHtml(r.deployed || "")}</td>
      <td>${r.healthy === true || r.healthy === "Yes" ? "Yes" : r.healthy === false ? "No" : (r.healthy || "-")}</td>
      <td>${r.expected_seats || "-"} / ${r.actual_seats || "-"}</td>
      <td>${landing}</td>`;
    tbody.appendChild(tr);
  });

  // Also populate Students tab from QA results
  renderStudents(results);
}

// ---------------------------------------------------------------------------
// TAB 5: Students
// ---------------------------------------------------------------------------

function renderStudents(results) {
  const tbody = document.querySelector("#studentsTable tbody");
  const empty = document.getElementById("studentsEmpty");
  tbody.innerHTML = "";
  const filtered = results.filter((r) => r.landing_page_url);
  if (!filtered.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  filtered.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.ci_name || "")}</td>
      <td><a href="${escapeHtml(r.landing_page_url)}" target="_blank">${escapeHtml(r.landing_page_url)}</a></td>
      <td>${escapeHtml(r.status || "")}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("btnDownloadStudents").addEventListener("click", () => {
  window.location.href = API + "/export/students";
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

checkHealth();
