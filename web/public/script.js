const socket = io();

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

const normalizeStatusClass = (status) => {
  const value = String(status || "").toUpperCase();
  if (["RUNNING"].includes(value)) return "connected";
  if (["STARTING", "STOPPING", "READY"].includes(value)) return "warning";
  if (["ERROR", "STOPPED"].includes(value)) return "disconnected";
  return "";
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
  el.textContent = normalized;
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
    el.innerHTML = `<span class="status-dot"></span>Kết nối thành công`;
    return;
  }

  if (status === "reconnecting") {
    el.classList.add("warning");
    el.innerHTML = `<span class="status-dot"></span>Đang kết nối lại`;
    return;
  }

  el.classList.add("disconnected");
  el.innerHTML = `<span class="status-dot"></span>Mất kết nối`;
};

function getCurrentConveyorCode() {
  const el = document.querySelector("[data-conveyor-code]");
  if (!el || !el.dataset.conveyorCode) {
    throw new Error("Không tìm thấy conveyor_code trên trang monitor");
  }
  return el.dataset.conveyorCode;
}

function renderInspectionResult(data) {
  if (!data) return;

  setText("jobId", data.inspection_id || data.job_id);
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

  setText("framePreviewLabel", previewFrame.predicted_label);
  setText("framePreviewScore", formatScore(previewFrame.predicted_score));
  setImage("roiPreviewImage", previewFrame.roi_path);
  setImage("overlayPreviewImage", previewFrame.overlay_path);
}

async function sendControlCommand(command, payload = {}) {
  try {
    const conveyorCode = getCurrentConveyorCode();

    if (command === "START_SYSTEM") setAiStatus("warning", "AI đang khởi động...");
    if (command === "STOP_SYSTEM") setAiStatus("warning", "AI đang dừng...");
    if (command === "GET_STATUS") setAiStatus("warning", "Đang kiểm tra trạng thái AI...");

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

    if (!res.ok) {
      showToast(data.message || "Gửi lệnh thất bại", "error");
      updateControlAckBox({
        status: "ERROR",
        command,
        message: data.message || data.error || "Gửi lệnh thất bại",
      });
      setAiStatus("disconnected", "Lỗi gửi lệnh");
      return;
    }

    showToast(`Đã gửi lệnh: ${command}`, "success");
    updateControlAckBox({
      status: "PENDING",
      command,
      message: "Đã gửi lệnh, đang chờ AI phản hồi...",
    });
  } catch (error) {
    console.error("sendControlCommand error:", error);
    showToast(error.message || "Không gửi được lệnh điều khiển", "error");
    updateControlAckBox({ status: "ERROR", command, message: error.message });
    setAiStatus("disconnected", "Không lấy được trạng thái AI");
  }
}

function updateControlAckBox(ack) {
  const box = document.querySelector(".control-ack-box");
  const text = document.getElementById("lastControlAck");
  if (!box || !text) return;

  box.classList.remove("success", "error");
  if (ack.status === "SUCCESS") box.classList.add("success");
  if (ack.status === "ERROR") box.classList.add("error");
  text.textContent = `[${ack.status || "-"}] ${ack.command || "-"}: ${ack.message || "-"}`;
}

/* ================= SOCKET EVENTS ================= */
socket.on("mqtt_status", (data) => {
  console.log("mqtt_status:", data);
  updateMqttStatus(data.status);
});

socket.on("inspection_result", (data) => {
  console.log("inspection_result:", data);
  renderInspectionResult(data);
  setAiStatus("connected", "AI đang chạy");
  showToast(`Nhận kết quả Job ${data.job_id}: ${data.label}`, "info");
});

socket.on("control_ack", (ack) => {
  console.log("control_ack:", ack);
  updateControlAckBox(ack);

  if (ack.status === "SUCCESS") {
    showToast(`${ack.command} thành công`, "success");
    if (ack.command === "START_SYSTEM") setAiStatus("warning", "AI đang khởi động...");
    if (ack.command === "STOP_SYSTEM") setAiStatus("warning", "AI đang dừng...");
  }

  if (ack.status === "ERROR") {
    showToast(`${ack.command} lỗi: ${ack.message}`, "error");
    setAiStatus("disconnected", `AI lỗi: ${ack.message}`);
  }
});

socket.on("system_status", (status) => {
  console.log("system_status:", status);

  const dbStatus = String(status.db_status || status.status || "").toUpperCase();
  const running = status.running === true || dbStatus === "RUNNING";

  if (running) {
    setAiStatus("connected", "AI đang chạy");
    return;
  }

  if (dbStatus === "STARTING") {
    setAiStatus("warning", "AI đang khởi động...");
    return;
  }

  if (dbStatus === "STOPPING") {
    setAiStatus("warning", "AI đang dừng...");
    return;
  }

  if (dbStatus === "ERROR") {
    setAiStatus("disconnected", "AI lỗi");
    return;
  }

  setAiStatus("disconnected", "AI đang dừng");
});

socket.on("system_error", (payload) => {
  console.error("system_error:", payload);
  setAiStatus("disconnected", payload.message || "AI lỗi");
  showToast(payload.message || "AI runtime error", "error");
});

/* ================= INITIALIZATION ================= */
document.addEventListener("DOMContentLoaded", () => {
  if (window.__LATEST_INSPECTION__) {
    renderInspectionResult(window.__LATEST_INSPECTION__);
  }

  if (document.querySelector("[data-conveyor-code]")) {
    setTimeout(() => sendControlCommand("GET_STATUS"), 600);
  }
});
