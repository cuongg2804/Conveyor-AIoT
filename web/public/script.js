const socket = io();

const COMMAND_LABELS = {
  START_SYSTEM: "Khởi động hệ thống",
  STOP_SYSTEM: "Dừng hệ thống",
  GET_STATUS: "Kiểm tra trạng thái",
};

const ACK_STATUS_LABELS = {
  SUCCESS: "Thành công",
  ERROR: "Thất bại",
  PENDING: "Đang xử lý",
};

const RESULT_LABELS = {
  OK: "Đạt",
  NG: "Không đạt",
  UNKNOWN: "Chưa xác định",
};

const commandLabel = (command) => COMMAND_LABELS[command] || "Thao tác";
const ackStatusLabel = (status) => ACK_STATUS_LABELS[status] || "Đang cập nhật";
const resultLabel = (label) => RESULT_LABELS[String(label || "").toUpperCase()] || "-";
let inspectionSessionActive = ["STARTING", "RUNNING"].includes(String(window.__CONVEYOR_STATUS__ || "").toUpperCase());

const userMessage = (message, fallback = "Có lỗi xảy ra") => {
  const raw = String(message || "").trim();
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (normalized.includes("command is required")) return "Thiếu thao tác điều khiển.";
  if (normalized.includes("invalid command")) return "Thao tác điều khiển không hợp lệ.";
  if (normalized.includes("conveyor_id is required")) return "Thiếu mã băng tải.";
  if (normalized.includes("mqtt client is not connected")) return "Chưa kết nối tới bộ điều khiển AI.";
  if (normalized.includes("publish command failed")) return "Không gửi được yêu cầu tới hệ thống AI.";

  return raw
    .replaceAll("START_SYSTEM", "Khởi động hệ thống")
    .replaceAll("STOP_SYSTEM", "Dừng hệ thống")
    .replaceAll("GET_STATUS", "Kiểm tra trạng thái")
    .replaceAll("job_id", "Mã lượt kiểm tra")
    .replaceAll("Job", "Lượt kiểm tra")
    .replaceAll("command", "Thao tác");
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
    el.innerHTML = `<span class="status-dot"></span>Đã kết nối`;
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
    throw new Error("Không xác định được băng tải trên trang giám sát.");
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

  setText("jobId", data.job_id ? `Lượt ${data.job_id}` : "-");
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
  //   showToast("Lệnh đang được xử lý, vui lòng chờ phản hồi từ AI", "info");
  //   return;
  // }

  // pendingControlCommands.set(command, true);

  try {
    const conveyorCode = getCurrentConveyorCode();
    const label = commandLabel(command);

    if (command === "START_SYSTEM") setAiStatus("warning", "Đang khởi động hệ thống...");
    if (command === "STOP_SYSTEM") setAiStatus("warning", "Đang dừng hệ thống...");
    if (command === "GET_STATUS") setAiStatus("warning", "Đang kiểm tra trạng thái...");

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
      const message = userMessage(data.message || data.error, "Không gửi được yêu cầu.");
      showToast(message, "error");
      updateControlAckBox({
        status: "ERROR",
        command,
        message,
      });
      setAiStatus("disconnected", "Không gửi được yêu cầu");
      return;
    }

    showToast(`Đã gửi yêu cầu: ${label}`, "success");
    if (command === "START_SYSTEM") inspectionSessionActive = true;
    if (command === "STOP_SYSTEM") {
      inspectionSessionActive = false;
      clearInspectionResult();
    }
    updateControlAckBox({
      status: "PENDING",
      command,
      message: "Yêu cầu đã được gửi, đang chờ phản hồi từ hệ thống AI.",
    });
  } catch (error) {
    pendingControlCommands.delete(command);
    console.error("sendControlCommand error:", error);
    const message = userMessage(error.message, "Không gửi được yêu cầu điều khiển.");
    showToast(message, "error");
    updateControlAckBox({ status: "ERROR", command, message });
    setAiStatus("disconnected", "Không kiểm tra được trạng thái");
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
  const message = userMessage(ack.message, "Đang chờ phản hồi.");
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
  setAiStatus("connected", "Hệ thống đang chạy");
  showToast(`Đã nhận kết quả kiểm tra: ${resultLabel(data.label)}`, "info");
});

socket.on("control_ack", (ack) => {
  console.log("control_ack:", ack);
  updateControlAckBox(ack);

  if (ack.status === "SUCCESS") {
    showToast(`${commandLabel(ack.command)} thành công`, "success");
    if (ack.command === "START_SYSTEM") {
      inspectionSessionActive = true;
      setAiStatus("warning", "Đang khởi động hệ thống...");
    }
    if (ack.command === "STOP_SYSTEM") {
      inspectionSessionActive = false;
      clearInspectionResult();
      setAiStatus("warning", "Đang dừng hệ thống...");
    }
    if (ack.command === "GET_STATUS") setAiStatus("connected", "Đã nhận trạng thái hệ thống");
  }

  if (ack.status === "ERROR") {
    const message = userMessage(ack.message, "Thao tác không thực hiện được.");
    showToast(`${commandLabel(ack.command)} thất bại: ${message}`, "error");
    setAiStatus("disconnected", `Lỗi: ${message}`);
  }
});

socket.on("system_status", (status) => {
  console.log("system_status:", status);

  const dbStatus = String(status.db_status || status.status || "").toUpperCase();
  const running = status.running === true || dbStatus === "RUNNING";

  if (running) {
    inspectionSessionActive = true;
    setAiStatus("connected", "Hệ thống đang chạy");
    return;
  }

  if (dbStatus === "STARTING") {
    inspectionSessionActive = true;
    setAiStatus("warning", "Đang khởi động hệ thống...");
    return;
  }

  if (dbStatus === "STOPPING") {
    inspectionSessionActive = false;
    clearInspectionResult();
    setAiStatus("warning", "Đang dừng hệ thống...");
    return;
  }

  if (dbStatus === "READY") {
    inspectionSessionActive = false;
    clearInspectionResult();
    setAiStatus("warning", "Sẵn sàng vận hành");
    return;
  }

  if (dbStatus === "ERROR") {
    inspectionSessionActive = false;
    clearInspectionResult();
    setAiStatus("disconnected", "Hệ thống đang lỗi");
    return;
  }

  inspectionSessionActive = false;
  clearInspectionResult();
  setAiStatus("disconnected", "Hệ thống đang dừng");
});

socket.on("system_error", (payload) => {
  console.error("system_error:", payload);
  const message = userMessage(payload.message, "Hệ thống AI gặp lỗi.");
  setAiStatus("disconnected", `Lỗi: ${message}`);
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
      const title = trigger ? trigger.getAttribute("data-image-title") : "Ảnh kiểm tra";
      const modalTitle = document.getElementById("historyImageModalTitle");
      const modalImage = document.getElementById("historyImageModalImg");
      const emptyState = historyModal.querySelector(".history-image-modal__empty");

      if (modalTitle) modalTitle.textContent = title || "Ảnh kiểm tra";
      if (emptyState) emptyState.style.display = "none";

      if (modalImage) {
        modalImage.style.display = "block";
        modalImage.alt = title || "Ảnh kiểm tra";
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
