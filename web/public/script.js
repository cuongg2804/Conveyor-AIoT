const socket = io();

const COMMAND_LABELS = {
  START_SYSTEM: "Khoi dong",
  STOP_SYSTEM: "Dung",
  GET_STATUS: "Kiem tra trang thai",
};

const RESULT_LABELS = {
  OK: "Dat",
  NG: "Khong dat",
  UNKNOWN: "Chua xac dinh",
};

let inspectionSessionActive = ["STARTING", "RUNNING"].includes(
  String(window.__CONVEYOR_STATUS__ || "").toUpperCase()
);

const commandLabel = (command) => COMMAND_LABELS[command] || command || "Lenh";
const resultLabel = (label) => RESULT_LABELS[String(label || "").toUpperCase()] || "-";

function showToast(message, type = "success") {
  if (typeof Toastify !== "function") return;

  const colors = {
    success: "linear-gradient(to right, #00b09b, #96c93d)",
    error: "linear-gradient(to right, #ff5f6d, #ffc371)",
    info: "linear-gradient(to right, #2193b0, #6dd5ed)",
  };

  Toastify({
    text: message,
    duration: 3000,
    close: true,
    gravity: "top",
    position: "right",
    backgroundColor: colors[type] || colors.success,
  }).showToast();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "-";
}

function setImage(id, src) {
  const el = document.getElementById(id);
  if (!el) return;

  if (!src) {
    el.removeAttribute("src");
    return;
  }

  el.src = `${src}${String(src).includes("?") ? "&" : "?"}t=${Date.now()}`;
}

function formatScore(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(3) : "-";
}

function formatTime(timestamp) {
  if (!timestamp) return "-";
  const value = Number(timestamp);
  const date = value > 1000000000000 ? new Date(value) : new Date(value * 1000);
  return date.toLocaleString("vi-VN");
}

function getConveyorCode() {
  return document.querySelector("[data-conveyor-code]")?.dataset.conveyorCode || "";
}

function isMonitorPage() {
  return Boolean(getConveyorCode());
}

function setStatus(mode, text) {
  const targets = [
    document.getElementById("aiStatus"),
    document.getElementById("systemStatusText")?.closest(".dashboard__status-pill"),
  ].filter(Boolean);

  targets.forEach((el) => {
    el.classList.remove("connected", "disconnected", "warning", "READY", "STARTING", "RUNNING", "STOPPING", "STOPPED", "ERROR");
    if (mode) el.classList.add(mode);
  });

  const aiStatus = document.getElementById("aiStatus");
  if (aiStatus) aiStatus.innerHTML = `<span class="status-dot"></span>${text}`;
  setText("systemStatusText", text);
}

function setMqttStatus(status) {
  const el = document.getElementById("systemStatus");
  if (!el) return;

  const text = status === "connected"
    ? "Da ket noi"
    : status === "reconnecting"
      ? "Dang ket noi lai"
      : "Mat ket noi";

  el.classList.remove("connected", "disconnected", "warning");
  el.classList.add(status === "connected" ? "connected" : status === "reconnecting" ? "warning" : "disconnected");
  el.innerHTML = `<span class="status-dot"></span>${text}`;
}

function setResultBadge(label) {
  const el = document.getElementById("resultLabel");
  if (!el) return;

  const value = String(label || "").toUpperCase();
  el.textContent = resultLabel(value);
  el.classList.remove("ok", "ng");
  if (value === "OK") el.classList.add("ok");
  if (value === "NG") el.classList.add("ng");
}

function clearInspectionResult() {
  setText("jobId", "-");
  setResultBadge("-");
  setText("averageScore", "-");
  setText("resultTimestamp", "-");
  setText("framePreviewLabel", "-");
  setText("framePreviewScore", "-");
  setImage("roiPreviewImage", "");
  setImage("overlayPreviewImage", "");
}

function renderInspectionResult(data) {
  if (!data || !isMonitorPage() || !inspectionSessionActive) return;

  const currentCode = getConveyorCode().toUpperCase();
  const resultCode = String(data.conveyor_code || "").toUpperCase();
  if (resultCode && resultCode !== currentCode) return;

  setText("jobId", data.job_id ? `Luot ${data.job_id}` : "-");
  setResultBadge(data.label);
  setText("averageScore", formatScore(data.average_score));
  setText("resultTimestamp", formatTime(data.timestamp));

  const frames = Array.isArray(data.frames) ? data.frames : [];
  const frame = frames.find((item) => Number(item.frame_index) === 2) || frames[1] || frames[0];

  if (!frame) {
    setText("framePreviewLabel", "-");
    setText("framePreviewScore", "-");
    setImage("roiPreviewImage", "");
    setImage("overlayPreviewImage", "");
    return;
  }

  setText("framePreviewLabel", resultLabel(frame.predicted_label));
  setText("framePreviewScore", formatScore(frame.predicted_score));
  setImage("roiPreviewImage", frame.roi_path);
  setImage("overlayPreviewImage", frame.overlay_path);
}

function updateControlAckBox(ack) {
  const box = document.querySelector(".control-ack-box");
  const text = document.getElementById("lastControlAck");
  if (!box || !text) return;

  box.classList.remove("success", "error");
  if (ack.status === "SUCCESS") box.classList.add("success");
  if (ack.status === "ERROR") box.classList.add("error");

  text.textContent = `${ack.status || "PENDING"} - ${commandLabel(ack.command)}: ${ack.message || "Dang xu ly"}`;
}

async function sendControlCommand(command, payload = {}) {
  try {
    const conveyorCode = getConveyorCode();
    if (!conveyorCode) throw new Error("Khong xac dinh duoc bang tai.");

    if (command === "START_SYSTEM") setStatus("warning", "Dang khoi dong...");
    if (command === "STOP_SYSTEM") setStatus("warning", "Dang dung...");
    if (command === "GET_STATUS") setStatus("warning", "Dang kiem tra...");

    const res = await fetch("/control/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command,
        payload: {
          conveyor_code: conveyorCode,
          ...payload,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || "Khong gui duoc lenh.");

    showToast(`Da gui lenh: ${commandLabel(command)}`, "success");
    updateControlAckBox({
      status: "PENDING",
      command,
      message: "Da gui lenh, dang cho AI phan hoi.",
    });

    if (command === "START_SYSTEM") inspectionSessionActive = true;
    if (command === "STOP_SYSTEM") {
      inspectionSessionActive = false;
      clearInspectionResult();
    }
  } catch (error) {
    const message = error.message || "Khong gui duoc lenh.";
    showToast(message, "error");
    updateControlAckBox({ status: "ERROR", command, message });
    setStatus("disconnected", "Khong gui duoc lenh");
  }
}

socket.on("mqtt_status", (data) => {
  setMqttStatus(data.status);
});

socket.on("inspection_result", (data) => {
  if (!isMonitorPage()) return;
  inspectionSessionActive = true;
  renderInspectionResult(data);
  setStatus("connected", "He thong dang chay");
  showToast(`Ket qua moi: ${resultLabel(data.label)}`, "info");
});

socket.on("control_ack", (ack) => {
  updateControlAckBox(ack);

  if (ack.status === "SUCCESS") {
    showToast(`${commandLabel(ack.command)} thanh cong`, "success");
    if (ack.command === "START_SYSTEM") inspectionSessionActive = true;
    if (ack.command === "STOP_SYSTEM") {
      inspectionSessionActive = false;
      clearInspectionResult();
    }
  }

  if (ack.status === "ERROR") {
    showToast(ack.message || `${commandLabel(ack.command)} that bai`, "error");
    setStatus("disconnected", "He thong loi");
  }
});

socket.on("system_status", (status) => {
  const value = String(status.db_status || status.status || "").toUpperCase();
  const running = status.running === true || value === "RUNNING";

  if (running) {
    inspectionSessionActive = true;
    setStatus("connected", "He thong dang chay");
    return;
  }

  if (value === "STARTING") {
    inspectionSessionActive = true;
    setStatus("warning", "Dang khoi dong...");
    return;
  }

  if (value === "STOPPING") {
    inspectionSessionActive = false;
    clearInspectionResult();
    setStatus("warning", "Dang dung...");
    return;
  }

  if (value === "ERROR") {
    inspectionSessionActive = false;
    clearInspectionResult();
    setStatus("disconnected", "He thong loi");
    return;
  }

  inspectionSessionActive = false;
  clearInspectionResult();
  setStatus("disconnected", value === "READY" ? "San sang" : "He thong da dung");
});

socket.on("system_error", (payload) => {
  const message = payload.message || "He thong AI gap loi.";
  showToast(message, "error");
  setStatus("disconnected", "He thong loi");
});

function initHistoryImageModal() {
  const modal = document.getElementById("historyImageModal");
  if (!modal || typeof $ !== "function") return;

  $("#historyImageModal").on("show.bs.modal", (event) => {
    const trigger = event.relatedTarget;
    const src = trigger?.getAttribute("data-image-src") || "";
    const title = trigger?.getAttribute("data-image-title") || "Anh kiem tra";
    const image = document.getElementById("historyImageModalImg");
    const titleEl = document.getElementById("historyImageModalTitle");
    const empty = modal.querySelector(".history-image-modal__empty");

    if (titleEl) titleEl.textContent = title;
    if (empty) empty.style.display = "none";
    if (!image) return;

    image.style.display = "block";
    image.alt = title;
    image.onerror = () => {
      image.style.display = "none";
      if (empty) empty.style.display = "flex";
    };
    setImage("historyImageModalImg", src);
  });

  $("#historyImageModal").on("hidden.bs.modal", () => {
    const image = document.getElementById("historyImageModalImg");
    if (!image) return;
    image.onerror = null;
    image.removeAttribute("src");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initHistoryImageModal();

  if (window.__LATEST_INSPECTION__) {
    renderInspectionResult(window.__LATEST_INSPECTION__);
  }

  if (isMonitorPage()) {
    setTimeout(() => sendControlCommand("GET_STATUS"), 600);
  }
});
