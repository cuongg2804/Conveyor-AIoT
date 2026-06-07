const getOrCreateTabId = () => {
  let tabId = sessionStorage.getItem("tab_id");

  if (!tabId) {
    tabId =
      "TAB_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10);

    sessionStorage.setItem("tab_id", tabId);
  }

  return tabId;
};

const createPageInstanceId = () =>
  "PAGE_" +
  Date.now().toString(36) +
  "_" +
  Math.random().toString(36).slice(2, 10);

window.__TAB_ID__ = getOrCreateTabId();
window.__PAGE_INSTANCE_ID__ = createPageInstanceId();

const lastInternalNavigationAt = Number(
  sessionStorage.getItem("last_internal_navigation_at") || 0
);

const isInternalNavigation =
  lastInternalNavigationAt > 0 && Date.now() - lastInternalNavigationAt < 5000;

window.appSocket =
  window.appSocket ||
  io({
    auth: {
      tab_id: window.__TAB_ID__,
      page_instance_id: window.__PAGE_INSTANCE_ID__,
      pathname: window.location.pathname,
      internal_navigation: isInternalNavigation,
    },
  });

const socket = window.appSocket;

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;

  const url = new URL(link.href, window.location.origin);
  if (url.origin !== window.location.origin) return;

  sessionStorage.setItem("last_internal_navigation_at", String(Date.now()));
});

const COMMAND_LABELS = {
  START_SYSTEM: "Khởi động hệ thống",
  STOP_SYSTEM: "Dừng hệ thống",
  GET_STATUS: "Kiểm tra trạng thái",
  GET_SERIAL_PORT: "Quét cổng Serial",
  GET_SERIAL_PORTS: "Quét cổng Serial",
  RESET_ARDUINO_CONFIG_DEFAULT: "Khôi phục cấu hình Arduino",
  LIGHT_CHECK: "Kiểm tra ánh sáng",
  GET_ARDUINO_CONFIG: "Đọc cấu hình Arduino",
  APPLY_ARDUINO_CONFIG: "Áp dụng cấu hình Arduino",
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

const RUNNING_STATUSES = ["STARTING", "RUNNING"];

let inspectionSessionActive = RUNNING_STATUSES.includes(
  String(window.__CONVEYOR_STATUS__ || "").toUpperCase()
);

const commandLabel = (command) => COMMAND_LABELS[command] || "Thao tác";
const ackStatusLabel = (status) => ACK_STATUS_LABELS[status] || "Đang cập nhật";
const resultLabel = (label) =>
  RESULT_LABELS[String(label || "").toUpperCase()] || "-";

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

const showToast = (message, type = "success") => {
  if (typeof Toastify !== "function") {
    console.log(`[${type}] ${message}`);
    return;
  }

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
};

const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "-";
};

const setImage = (id, src) => {
  const el = document.getElementById(id);
  if (!el) return;

  if (!src) {
    el.removeAttribute("src");
    return;
  }

  el.src = `${src}${String(src).includes("?") ? "&" : "?"}t=${Date.now()}`;
};

const formatScore = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(3) : "-";
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return "-";

  const ts = Number(timestamp);
  const date = ts > 1000000000000 ? new Date(ts) : new Date(ts * 1000);

  return date.toLocaleString("vi-VN");
};

const normalizeCode = (value) => String(value || "").trim().toUpperCase();

function hasMonitorContext() {
  return Boolean(document.querySelector("[data-conveyor-code]"));
}

function getCurrentConveyorCode() {
  const el = document.querySelector("[data-conveyor-code]");

  if (!el || !el.dataset.conveyorCode) {
    throw new Error("Không xác định được băng tải trên trang giám sát.");
  }

  return normalizeCode(el.dataset.conveyorCode);
}

const setAiStatus = (mode, text) => {
  const aiStatus = document.getElementById("aiStatus");
  const topText = document.getElementById("systemStatusText");
  const topPill = topText ? topText.closest(".dashboard__status-pill") : null;

  [aiStatus, topPill].forEach((el) => {
    if (!el) return;

    el.classList.remove(
      "connected",
      "disconnected",
      "warning",
      "READY",
      "STARTING",
      "RUNNING",
      "STOPPING",
      "STOPPED",
      "ERROR"
    );

    if (mode) el.classList.add(mode);
  });

  if (aiStatus) aiStatus.innerHTML = `<span class="status-dot"></span>${text}`;
  if (topText) topText.textContent = text;
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

const updateResultBadge = (label) => {
  const el = document.getElementById("resultLabel");
  if (!el) return;

  const normalized = normalizeCode(label || "-");

  el.textContent = resultLabel(normalized);
  el.classList.remove("ok", "ng");

  if (normalized === "OK") el.classList.add("ok");
  if (normalized === "NG") el.classList.add("ng");
};

function clearInspectionResult() {
  setText("stt", "-");
  setText("jobId", "-");
  updateResultBadge("-");
  setText("resultTimestamp", "-");
  setText("framePreviewLabel", "-");
  setText("framePreviewScore", "-");
  setImage("roiPreviewImage", "");
  setImage("overlayPreviewImage", "");
}

function renderInspectionResult(data) {
  if (!data || !hasMonitorContext()) return;

  const resultConveyorCode = normalizeCode(data.conveyor_id);
  if (resultConveyorCode && resultConveyorCode !== getCurrentConveyorCode()) return;

  if (!inspectionSessionActive) return;

  const currentMode = normalizeCode(window.__RUNTIME_MODE__ || "PRODUCTION");
  const resultMode = normalizeCode(data.mode || "PRODUCTION");

  if (currentMode === "TEST" && resultMode !== "TEST") return;
  if (currentMode === "PRODUCTION" && resultMode === "TEST") return;

  const displayId = data.stt || data.job_id || data.inspection_id;

  setText("stt", displayId ? `Lượt ${displayId}` : "-");
  setText("jobId", displayId ? `Lượt ${displayId}` : "-");
  updateResultBadge(data.label);
  setText("resultTimestamp", formatTimestamp(data.timestamp));

  const frames = Array.isArray(data.frames) ? data.frames : [];
  const previewFrame =
    frames.find((frame) => Number(frame.frame_index) === 2) ||
    frames[1] ||
    frames[0];

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
  setImage("overlayPreviewImage", previewFrame.overlay_path || previewFrame.roi_path);
}

function updateControlAckBox(ack) {
  const box = document.querySelector(".control-ack-box");
  const text = document.getElementById("lastControlAck");

  if (!box || !text) return;

  box.classList.remove("success", "error");

  if (ack.status === "SUCCESS") box.classList.add("success");
  if (ack.status === "ERROR") box.classList.add("error");

  text.textContent = `${ackStatusLabel(ack.status)} - ${commandLabel(
    ack.command
  )}: ${userMessage(ack.message, "Đang chờ phản hồi.")}`;
}

async function sendControlCommand(command, payload = {}) {
  try {
    const conveyorCode = getCurrentConveyorCode();
    const label = commandLabel(command);

    if (command === "START_SYSTEM") setAiStatus("warning", "Đang khởi động hệ thống...");
    if (command === "STOP_SYSTEM") setAiStatus("warning", "Đang dừng hệ thống...");
    if (command === "GET_STATUS") setAiStatus("warning", "Đang kiểm tra trạng thái...");

    const res = await fetch("/control/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command,
        payload: {
          conveyor_id: conveyorCode,
          mode: window.__RUNTIME_MODE__ || "PRODUCTION",
          ...payload,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = userMessage(data.message || data.error, "Không gửi được yêu cầu.");

      showToast(message, "error");
      updateControlAckBox({ status: "ERROR", command, message });
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
    console.error("sendControlCommand error:", error);

    const message = userMessage(error.message, "Không gửi được yêu cầu điều khiển.");

    showToast(message, "error");
    updateControlAckBox({ status: "ERROR", command, message });
    setAiStatus("disconnected", "Không kiểm tra được trạng thái");
  }
}

window.sendControlCommand = sendControlCommand;

function initSerialPortSelect() {
  const serialSelect = document.getElementById("serial_port");
  if (!serialSelect || !socket) return;

  const currentPort = serialSelect.dataset.current || serialSelect.value || "";

  fetch("/settings/serial-ports").catch(() => {
    showToast("Không gửi được yêu cầu quét cổng Serial.", "error");
  });

  socket.on("control_ack", (payload) => {
    if (!["GET_SERIAL_PORT", "GET_SERIAL_PORTS"].includes(payload.command)) return;

    const ports = payload?.data?.ports || payload?.ports || [];

    serialSelect.innerHTML = "";

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "-- Chọn cổng kết nối --";
    serialSelect.appendChild(emptyOption);

    ports.forEach((port) => {
      const option = document.createElement("option");
      const value = port.device || port.path || port.value || "";

      option.value = value;
      option.textContent = `Cổng kết nối ${value}${port.description ? ` - ${port.description}` : ""}`;

      if (value === currentPort) option.selected = true;

      serialSelect.appendChild(option);
    });
  });
}

function initFullnameValidation() {
  document.querySelectorAll(".js-fullname-only").forEach((input) => {
    input.addEventListener("input", function () {
      this.value = this.value.replace(/[^\p{L}\s]/gu, "");
    });

    input.addEventListener("paste", function (event) {
      event.preventDefault();

      const pastedText = (event.clipboardData || window.clipboardData).getData("text");
      const cleanedText = pastedText.replace(/[^\p{L}\s]/gu, "");
      const start = this.selectionStart;
      const end = this.selectionEnd;

      this.value =
        this.value.substring(0, start) + cleanedText + this.value.substring(end);

      this.setSelectionRange(start + cleanedText.length, start + cleanedText.length);
    });
  });
}

function initHistoryImageModal() {
  const historyModal = document.getElementById("historyImageModal");
  if (!historyModal || typeof $ !== "function") return;

  $("#historyImageModal").on("show.bs.modal", (event) => {
    const trigger = event.relatedTarget;
    const src = trigger ? trigger.getAttribute("data-image-src") : "";
    const title = trigger ? trigger.getAttribute("data-image-title") : "Ảnh kiểm tra";
    const modalTitle = document.getElementById("historyImageModalTitle");
    const modalImage = document.getElementById("historyImageModalImg");
    const emptyState = historyModal.querySelector(".history-image-modal__empty");

    if (modalTitle) modalTitle.textContent = title || "Ảnh kiểm tra";
    if (emptyState) emptyState.style.display = "none";

    if (!modalImage) return;

    modalImage.style.display = "block";
    modalImage.alt = title || "Ảnh kiểm tra";
    modalImage.onerror = () => {
      modalImage.style.display = "none";
      if (emptyState) emptyState.style.display = "flex";
    };
    modalImage.src = src ? `${src}${String(src).includes("?") ? "&" : "?"}t=${Date.now()}` : "";
  });

  $("#historyImageModal").on("hidden.bs.modal", () => {
    const modalImage = document.getElementById("historyImageModalImg");

    if (!modalImage) return;

    modalImage.onerror = null;
    modalImage.removeAttribute("src");
  });
}

socket.on("connect", () => {
  sessionStorage.removeItem("last_internal_navigation_at");

  if (hasMonitorContext()) {
    socket.emit("join_monitor", {
      conveyor_id: getCurrentConveyorCode(),
    });
  }
});

socket.on("session_rejected", (payload) => {
  alert(payload.message || "Phiên đăng nhập không hợp lệ.");
  window.location.href = "/login";
});

socket.on("mqtt_status", (data) => {
  updateMqttStatus(data.status);
});

socket.on("inspection_result", (data) => {
  if (!hasMonitorContext()) return;

  const resultConveyorCode = normalizeCode(data.conveyor_id);
  if (resultConveyorCode && resultConveyorCode !== getCurrentConveyorCode()) return;

  inspectionSessionActive = true;
  renderInspectionResult(data);
  setAiStatus("connected", "Hệ thống đang chạy");
  //showToast(`Đã nhận kết quả kiểm tra: ${resultLabel(data.label)}`, "info");
});

socket.on("control_ack", (ack) => {
  updateControlAckBox(ack);

  if (ack.status === "SUCCESS" && ack.command === "START_SYSTEM") {
    inspectionSessionActive = true;
    setAiStatus("warning", "AI da nhan lenh khoi dong, dang cho he thong san sang...");
    showToast("AI da nhan lenh khoi dong, dang cho he thong san sang", "info");
  }

  if (ack.status === "SUCCESS" && ack.command === "STOP_SYSTEM") {
    inspectionSessionActive = false;
    clearInspectionResult();
    setAiStatus("warning", "AI da nhan lenh dung he thong...");
    showToast("AI da nhan lenh dung he thong", "info");
  }

  if (ack.status === "SUCCESS" && !["START_SYSTEM", "STOP_SYSTEM"].includes(ack.command)) {
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

    if (ack.command === "GET_STATUS") {
      setAiStatus("connected", "Đã nhận trạng thái hệ thống");
    }
  }

  if (ack.status === "ERROR") {
    const message = userMessage(ack.message, "Thao tác không thực hiện được.");

    showToast(`${commandLabel(ack.command)} thất bại: ${message}`, "error");
    setAiStatus("disconnected", `Lỗi: ${message}`);
  }
});

socket.on("system_status", (status) => {
  const dbStatus = normalizeCode(status.db_status || status.status);
  const running = status.running === true || dbStatus === "RUNNING";

  if (running || dbStatus === "STARTING") {
    inspectionSessionActive = true;
    setAiStatus(
      running ? "connected" : "warning",
      running ? "Hệ thống đang chạy" : "Đang khởi động hệ thống..."
    );
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
  const message = userMessage(payload.message, "Hệ thống AI gặp lỗi.");

  setAiStatus("disconnected", `Lỗi: ${message}`);
  showToast(message, "error");
});

[
  ["user_disconnected", "error"],
  ["user_session_expired", "error"],
  ["auto_stop_triggered", "error"],
  ["user_reconnected", "success"],
  ["auto_stop_cancelled", "success"],
].forEach(([eventName, type]) => {
  socket.on(eventName, (payload) => {
    showToast(payload.message, payload.auto_stopped ? "info" : type);
  });
});

document.addEventListener("DOMContentLoaded", () => {
  if (window.__LATEST_INSPECTION__) {
    renderInspectionResult(window.__LATEST_INSPECTION__);
  }

  initSerialPortSelect();
  initFullnameValidation();
  initHistoryImageModal();

  if (hasMonitorContext()) {
    setTimeout(() => sendControlCommand("GET_STATUS"), 600);
  }
});
