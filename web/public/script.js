const socket = io();

const COMMAND_LABELS = {
  START_SYSTEM: "Khá»Ÿi Ä‘á»™ng há»‡ thá»‘ng",
  STOP_SYSTEM: "Dá»«ng há»‡ thá»‘ng",
  GET_STATUS: "Kiá»ƒm tra tráº¡ng thÃ¡i",
};

const ACK_STATUS_LABELS = {
  SUCCESS: "ThÃ nh cÃ´ng",
  ERROR: "Tháº¥t báº¡i",
  PENDING: "Äang xá»­ lÃ½",
};

const RESULT_LABELS = {
  OK: "Äáº¡t",
  NG: "KhÃ´ng Ä‘áº¡t",
  UNKNOWN: "ChÆ°a xÃ¡c Ä‘á»‹nh",
};

const commandLabel = (command) => COMMAND_LABELS[command] || "Thao tÃ¡c";
const ackStatusLabel = (status) => ACK_STATUS_LABELS[status] || "Äang cáº­p nháº­t";
const resultLabel = (label) => RESULT_LABELS[String(label || "").toUpperCase()] || "-";
let inspectionSessionActive = ["STARTING", "RUNNING"].includes(String(window.__CONVEYOR_STATUS__ || "").toUpperCase());

const userMessage = (message, fallback = "CÃ³ lá»—i xáº£y ra") => {
  const raw = String(message || "").trim();
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (normalized.includes("command is required")) return "Thiáº¿u thao tÃ¡c Ä‘iá»u khiá»ƒn.";
  if (normalized.includes("invalid command")) return "Thao tÃ¡c Ä‘iá»u khiá»ƒn khÃ´ng há»£p lá»‡.";
  if (normalized.includes("conveyor_id is required")) return "Thiáº¿u mÃ£ bÄƒng táº£i.";
  if (normalized.includes("mqtt client is not connected")) return "ChÆ°a káº¿t ná»‘i tá»›i bá»™ Ä‘iá»u khiá»ƒn AI.";
  if (normalized.includes("publish command failed")) return "KhÃ´ng gá»­i Ä‘Æ°á»£c yÃªu cáº§u tá»›i há»‡ thá»‘ng AI.";

  return raw
    .replaceAll("START_SYSTEM", "Khá»Ÿi Ä‘á»™ng há»‡ thá»‘ng")
    .replaceAll("STOP_SYSTEM", "Dá»«ng há»‡ thá»‘ng")
    .replaceAll("GET_STATUS", "Kiá»ƒm tra tráº¡ng thÃ¡i")
    .replaceAll("job_id", "MÃ£ lÆ°á»£t kiá»ƒm tra")
    .replaceAll("Job", "LÆ°á»£t kiá»ƒm tra")
    .replaceAll("command", "Thao tÃ¡c");
};

/* ================= TOAST ================= */
const showToast = (message, type = "success") => {
  if (typeof Toastify !== "function") {
    console.log(`[${type}] ${message}`);
    return;
  }

  let background = "linear-gradient(to right, #00b09b, #96c93d)";
  if (type === "error") background = "linear-gradient(to right, #ff5f6d, #ffc371)";
  if (type === "info") background = "linear-gradient(to right, #2193b0, #6dd5ed)";

  Toastify({
    text: message,
    duration: 3000,
    close: true,
    gravity: "top",
    position: "right",
    backgroundColor: background,
  }).showToast();
};

/* ================= HELPERS ================= */
const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "-";
};

const setImage = (id, src) => {
  const el = document.getElementById(id);
  if (!el) return;
  if (src) el.src = `${src}${String(src).includes("?") ? "&" : "?"}t=${Date.now()}`;
  else el.removeAttribute("src");
};

const formatScore = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return "-";
  return num.toFixed(3);
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return "-";
  const ts = Number(timestamp);
  const date = ts > 1000000000000 ? new Date(ts) : new Date(ts * 1000);
  return date.toLocaleString("vi-VN");
};

const setAiStatus = (mode, text) => {
  const aiStatus = document.getElementById("aiStatus");
  const topText = document.getElementById("systemStatusText");
  const topPill = topText ? topText.closest(".dashboard__status-pill") : null;

  if (aiStatus) {
    aiStatus.classList.remove("connected", "disconnected", "warning", "READY", "STARTING", "RUNNING", "STOPPING", "STOPPED", "ERROR");
    if (mode) aiStatus.classList.add(mode);
    aiStatus.innerHTML = `<span class="status-dot"></span>${text}`;
  }

  if (topText) topText.textContent = text;

  if (topPill) {
    topPill.classList.remove("connected", "disconnected", "warning", "READY", "STARTING", "RUNNING", "STOPPING", "STOPPED", "ERROR");
    if (mode) topPill.classList.add(mode);
  }
};

const updateResultBadge = (label) => {
  const el = document.getElementById("resultLabel");
  if (!el) return;

  const normalized = String(label || "-").toUpperCase();
  el.textContent = resultLabel(normalized);
  el.classList.remove("ok", "ng");
  if (normalized === "OK") el.classList.add("ok");
  if (normalized === "NG") el.classList.add("ng");
};

const updateMqttStatus = (status) => {
  const el = document.getElementById("systemStatus");
  if (!el) return;

  el.classList.remove("connected", "disconnected", "warning");

  if (status === "connected") {
    el.classList.add("connected");
    el.innerHTML = `<span class="status-dot"></span>ÄÃ£ káº¿t ná»‘i`;
    return;
  }

  if (status === "reconnecting") {
    el.classList.add("warning");
    el.innerHTML = `<span class="status-dot"></span>Äang káº¿t ná»‘i láº¡i`;
    return;
  }

  el.classList.add("disconnected");
  el.innerHTML = `<span class="status-dot"></span>Máº¥t káº¿t ná»‘i`;
};

function getCurrentConveyorCode() {
  const el = document.querySelector("[data-conveyor-code]");
  if (!el || !el.dataset.conveyorCode) {
    throw new Error("KhÃ´ng xÃ¡c Ä‘á»‹nh Ä‘Æ°á»£c bÄƒng táº£i trÃªn trang giÃ¡m sÃ¡t.");
  }
  return el.dataset.conveyorCode;
}

function hasMonitorContext() {
  return Boolean(document.querySelector("[data-conveyor-code]"));
}

function renderInspectionResult(data) {
  if (!data) return;
  if (!hasMonitorContext()) return;

  const resultConveyorCode = String(data.conveyor_id || "").trim().toUpperCase();
  if (resultConveyorCode && resultConveyorCode !== getCurrentConveyorCode()) return;
  if (!inspectionSessionActive) return;

  setText("jobId", data.job_id ? `LÆ°á»£t ${data.job_id}` : "-");
  updateResultBadge(data.label);
  setText("averageScore", formatScore(data.average_score));
  setText("resultTimestamp", formatTimestamp(data.timestamp));

  const frames = Array.isArray(data.frames) ? data.frames : [];
  const previewFrame = frames.find((f) => Number(f.frame_index) === 2) || frames[1] || frames[0];

  if (!previewFrame) {
    setText("framePreviewLabel", "-");
    setText("framePreviewScore", "-");
    setImage("roiPreviewImage", "");
    setImage("overlayPreviewImage", "");
    return;
  }

  setText("framePreviewLabel", resultLabel(previewFrame.predicted_label));
  setText("framePreviewScore", formatScore(previewFrame.predicted_score));
  setImage("roiPreviewImage", previewFrame.roi_path);
  setImage("overlayPreviewImage", previewFrame.overlay_path);
}

function clearInspectionResult() {
  setText("jobId", "-");
  updateResultBadge("-");
  setText("averageScore", "-");
  setText("resultTimestamp", "-");
  setText("framePreviewLabel", "-");
  setText("framePreviewScore", "-");
  setImage("roiPreviewImage", "");
  setImage("overlayPreviewImage", "");
}

async function sendControlCommand(command, payload = {}) {
  // if (pendingControlCommands.get(command)) {
  //   showToast("Lá»‡nh Ä‘ang Ä‘Æ°á»£c xá»­ lÃ½, vui lÃ²ng chá» pháº£n há»“i tá»« AI", "info");
  //   return;
  // }

  // pendingControlCommands.set(command, true);

  try {
    const conveyorCode = getCurrentConveyorCode();
    const label = commandLabel(command);

    if (command === "START_SYSTEM") setAiStatus("warning", "Äang khá»Ÿi Ä‘á»™ng há»‡ thá»‘ng...");
    if (command === "STOP_SYSTEM") setAiStatus("warning", "Äang dá»«ng há»‡ thá»‘ng...");
    if (command === "GET_STATUS") setAiStatus("warning", "Äang kiá»ƒm tra tráº¡ng thÃ¡i...");

    const res = await fetch("/control/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command,
        payload: {
          conveyor_id: conveyorCode,
          ...payload,
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const message = userMessage(data.message || data.error, "KhÃ´ng gá»­i Ä‘Æ°á»£c yÃªu cáº§u.");
      showToast(message, "error");
      updateControlAckBox({
        status: "ERROR",
        command,
        message,
      });
      setAiStatus("disconnected", "KhÃ´ng gá»­i Ä‘Æ°á»£c yÃªu cáº§u");
      return;
    }

    showToast(`ÄÃ£ gá»­i yÃªu cáº§u: ${label}`, "success");
    if (command === "START_SYSTEM") inspectionSessionActive = true;
    if (command === "STOP_SYSTEM") {
      inspectionSessionActive = false;
      clearInspectionResult();
    }
    updateControlAckBox({
      status: "PENDING",
      command,
      message: "YÃªu cáº§u Ä‘Ã£ Ä‘Æ°á»£c gá»­i, Ä‘ang chá» pháº£n há»“i tá»« há»‡ thá»‘ng AI.",
    });
  } catch (error) {
    pendingControlCommands.delete(command);
    console.error("sendControlCommand error:", error);
    const message = userMessage(error.message, "KhÃ´ng gá»­i Ä‘Æ°á»£c yÃªu cáº§u Ä‘iá»u khiá»ƒn.");
    showToast(message, "error");
    updateControlAckBox({ status: "ERROR", command, message });
    setAiStatus("disconnected", "KhÃ´ng kiá»ƒm tra Ä‘Æ°á»£c tráº¡ng thÃ¡i");
  }
}

function updateControlAckBox(ack) {
  const box = document.querySelector(".control-ack-box");
  const text = document.getElementById("lastControlAck");
  if (!box || !text) return;

  box.classList.remove("success", "error");
  if (ack.status === "SUCCESS") box.classList.add("success");
  if (ack.status === "ERROR") box.classList.add("error");

  const status = ackStatusLabel(ack.status);
  const action = commandLabel(ack.command);
  const message = userMessage(ack.message, "Äang chá» pháº£n há»“i.");
  text.textContent = `${status} - ${action}: ${message}`;
}

/* ================= SOCKET EVENTS ================= */
socket.on("mqtt_status", (data) => {
  console.log("mqtt_status:", data);
  updateMqttStatus(data.status);
});

socket.on("inspection_result", (data) => {
  console.log("inspection_result:", data);
  if (!hasMonitorContext()) return;
  const resultConveyorCode = String(data.conveyor_id || "").trim().toUpperCase();
  if (resultConveyorCode && resultConveyorCode !== getCurrentConveyorCode()) return;
  inspectionSessionActive = true;
  renderInspectionResult(data);
  setAiStatus("connected", "Há»‡ thá»‘ng Ä‘ang cháº¡y");
  showToast(`ÄÃ£ nháº­n káº¿t quáº£ kiá»ƒm tra: ${resultLabel(data.label)}`, "info");
});

socket.on("control_ack", (ack) => {
  console.log("control_ack:", ack);
  updateControlAckBox(ack);

  if (ack.status === "SUCCESS") {
    showToast(`${commandLabel(ack.command)} thÃ nh cÃ´ng`, "success");
    if (ack.command === "START_SYSTEM") {
      inspectionSessionActive = true;
      setAiStatus("warning", "Äang khá»Ÿi Ä‘á»™ng há»‡ thá»‘ng...");
    }
    if (ack.command === "STOP_SYSTEM") {
      inspectionSessionActive = false;
      clearInspectionResult();
      setAiStatus("warning", "Äang dá»«ng há»‡ thá»‘ng...");
    }
    if (ack.command === "GET_STATUS") setAiStatus("connected", "ÄÃ£ nháº­n tráº¡ng thÃ¡i há»‡ thá»‘ng");
  }

  if (ack.status === "ERROR") {
    const message = userMessage(ack.message, "Thao tÃ¡c khÃ´ng thá»±c hiá»‡n Ä‘Æ°á»£c.");
    showToast(`${commandLabel(ack.command)} tháº¥t báº¡i: ${message}`, "error");
    setAiStatus("disconnected", `Lá»—i: ${message}`);
  }
});

socket.on("system_status", (status) => {
  console.log("system_status:", status);

  const dbStatus = String(status.db_status || status.status || "").toUpperCase();
  const running = status.running === true || dbStatus === "RUNNING";

  if (running) {
    inspectionSessionActive = true;
    setAiStatus("connected", "Há»‡ thá»‘ng Ä‘ang cháº¡y");
    return;
  }

  if (dbStatus === "STARTING") {
    inspectionSessionActive = true;
    setAiStatus("warning", "Äang khá»Ÿi Ä‘á»™ng há»‡ thá»‘ng...");
    return;
  }

  if (dbStatus === "STOPPING") {
    inspectionSessionActive = false;
    clearInspectionResult();
    setAiStatus("warning", "Äang dá»«ng há»‡ thá»‘ng...");
    return;
  }

  if (dbStatus === "READY") {
    inspectionSessionActive = false;
    clearInspectionResult();
    setAiStatus("warning", "Sáºµn sÃ ng váº­n hÃ nh");
    return;
  }

  if (dbStatus === "ERROR") {
    inspectionSessionActive = false;
    clearInspectionResult();
    setAiStatus("disconnected", "Há»‡ thá»‘ng Ä‘ang lá»—i");
    return;
  }

  inspectionSessionActive = false;
  clearInspectionResult();
  setAiStatus("disconnected", "Há»‡ thá»‘ng Ä‘ang dá»«ng");
});

socket.on("system_error", (payload) => {
  console.error("system_error:", payload);
  const message = userMessage(payload.message, "Há»‡ thá»‘ng AI gáº·p lá»—i.");
  setAiStatus("disconnected", `Lá»—i: ${message}`);
  showToast(message, "error");
});

/* ================= INITIALIZATION ================= */
document.addEventListener("DOMContentLoaded", () => {
  if (window.__LATEST_INSPECTION__) {
    renderInspectionResult(window.__LATEST_INSPECTION__);
  }

  const historyModal = document.getElementById("historyImageModal");
  if (historyModal && typeof $ === "function") {
    $("#historyImageModal").on("show.bs.modal", (event) => {
      const trigger = event.relatedTarget;
      const src = trigger ? trigger.getAttribute("data-image-src") : "";
      const title = trigger ? trigger.getAttribute("data-image-title") : "áº¢nh kiá»ƒm tra";
      const modalTitle = document.getElementById("historyImageModalTitle");
      const modalImage = document.getElementById("historyImageModalImg");
      const emptyState = historyModal.querySelector(".history-image-modal__empty");

      if (modalTitle) modalTitle.textContent = title || "áº¢nh kiá»ƒm tra";
      if (emptyState) emptyState.style.display = "none";

      if (modalImage) {
        modalImage.style.display = "block";
        modalImage.alt = title || "áº¢nh kiá»ƒm tra";
        modalImage.onerror = () => {
          modalImage.style.display = "none";
          if (emptyState) emptyState.style.display = "flex";
        };
        modalImage.src = src ? `${src}${String(src).includes("?") ? "&" : "?"}t=${Date.now()}` : "";
      }
    });

    $("#historyImageModal").on("hidden.bs.modal", () => {
      const modalImage = document.getElementById("historyImageModalImg");
      if (modalImage) {
        modalImage.onerror = null;
        modalImage.removeAttribute("src");
      }
    });
  }

  if (document.querySelector("[data-conveyor-code]")) {
    setTimeout(() => sendControlCommand("GET_STATUS"), 600);
  }
});
