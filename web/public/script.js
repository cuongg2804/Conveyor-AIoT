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

window.__TAB_ID__ = getOrCreateTabId();

window.appSocket =
  window.appSocket ||
  io({
    auth: {
      tab_id: window.__TAB_ID__,
    },
  });

var socket = window.appSocket;

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

const serial = document.getElementById("serial_port")
if(serial && typeof socket !=="undefined"){
  fetch(`/control/${window.CONVEYOR_ID}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      command: "GET_SERIAL_PORT",
    }),
  })
  socket.on("control_ack", (payload) => {
    if(payload.command !== "GET_SERIAL_PORT") return;

    const ports = payload?.data?.ports || []
    const curr_port = serial.dataset.current || "" // 

    serial.innerHTML = ""

    const initOption = document.createElement("option")
    initOption.value = ""
    initOption.text = "--Chọn cổng kết nối--"
    serial.appendChild(initOption)

    ports.forEach((ports) => {
      const option = document.createElement("option")
      option.value = ports.device
      option.textContent = `${ports.value} - ${port.description || ""}`

      if(ports.device === curr_port) {
        option.selected = true
      }
      serial.appendChild(option)
    })
  })
}
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

  setText("stt", data.job_id ? `Lượt ${data.job_id}` : "-");
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
  setText("stt", "-");
  updateResultBadge("-");
  setText("averageScore", "-");
  setText("resultTimestamp", "-");
  setText("framePreviewLabel", "-");
  setText("framePreviewScore", "-");
  setImage("roiPreviewImage", "");
  setImage("overlayPreviewImage", "");
}

const pendingControlCommands = new Map();
async function sendControlCommand(command, payload = {}) {
  if (pendingControlCommands.get(command)) {
    showToast("Lệnh đang được xử lý, vui lòng chờ phản hồi từ AI", "info");
    return;
  }

  pendingControlCommands.set(command, true);

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
  const fullnameInputs = document.querySelectorAll(".js-fullname-only");

  fullnameInputs.forEach((input) => {
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
        this.value.substring(0, start) +
        cleanedText +
        this.value.substring(end);

      this.setSelectionRange(start + cleanedText.length, start + cleanedText.length);
    });
  });

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
socket.on("session_rejected", (payload) => {
  alert(payload.message || "Phiên đăng nhập không hợp lệ.");
  window.location.href = "/login";
});

document.addEventListener("DOMContentLoaded", function () {
  const testSession = window.__TEST_SESSION__;
  const testEndAt = window.__TEST_END_AT__;
  const socket = window.appSocket;

  if (!testSession) return;

  const countdownEl = document.getElementById("testCountdown");
  const statusTextEl = document.getElementById("testStatusText");
  const statusBoxEl = document.getElementById("testStatusBox");

  const formatDuration = (ms) => {
    const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0"),
    ].join(":");
  };

  const updateCountdown = () => {
    if (!countdownEl) return;

    if (testSession.status !== "RUNNING") {
      countdownEl.textContent = "00:00:00";
      return;
    }

    const remaining = Number(testEndAt || 0) - Date.now();
    countdownEl.textContent = formatDuration(remaining);

    if (remaining <= 0) {
      countdownEl.textContent = "Đang hoàn tất...";
    }
  };

  updateCountdown();
  setInterval(updateCountdown, 1000);

  const applyInspectionToMonitor = (data) => {
    if (!data) return;

    if (data.run_mode !== "TEST") return;
    if (data.test_session_id !== testSession.test_session_id) return;

    const resultLabel = document.getElementById("resultLabel");
    const stt = document.getElementById("stt");
    const averageScore = document.getElementById("testAvg");
    const framePreviewLabel = document.getElementById("framePreviewLabel");
    const resultTimestamp = document.getElementById("resultTimestamp");
    const framePreviewScore = document.getElementById("framePreviewScore");

    if (resultLabel) {
      resultLabel.textContent = data.label || "-";
      resultLabel.className = `result-badge ${String(data.label || "").toLowerCase()}`;
    }

    if (stt) {
      stt.textContent = data.inspection_id || data.job_id || "-";
    }

    if (averageScore) {
      averageScore.textContent =
        data.average_score !== undefined && data.average_score !== null
          ? Number(data.average_score).toFixed(3)
          : "-";
    }

    if (framePreviewLabel) {
      framePreviewLabel.textContent = data.label || "-";
    }

    if (framePreviewScore) {
      framePreviewScore.textContent =
        data.average_score !== undefined && data.average_score !== null
          ? Number(data.average_score).toFixed(3)
          : "-";
    }

    if (resultTimestamp) {
      const ts = Number(data.timestamp || 0);
      const date = ts > 1000000000000 ? new Date(ts) : new Date(ts * 1000);
      resultTimestamp.textContent = Number.isFinite(ts)
        ? date.toLocaleString("vi-VN")
        : "-";
    }

    const frames = Array.isArray(data.frames) ? data.frames : [];
    const previewFrame = frames[1] || frames[0];

    const roiImg = document.getElementById("roiPreviewImage");
    const overlayImg = document.getElementById("overlayPreviewImage");

    if (previewFrame) {
      if (roiImg && previewFrame.roi_path) {
        roiImg.src = previewFrame.roi_path;
        roiImg.style.display = "block";
        const placeholder = roiImg.parentElement?.querySelector(".image-placeholder");
        if (placeholder) placeholder.style.display = "none";
      }

      if (overlayImg && previewFrame.overlay_path) {
        overlayImg.src = previewFrame.overlay_path;
        overlayImg.style.display = "block";
        const placeholder = overlayImg.parentElement?.querySelector(".image-placeholder");
        if (placeholder) placeholder.style.display = "none";
      }
    }
  };

  applyInspectionToMonitor(window.__LATEST_INSPECTION__);

  if (socket) {
    socket.on("inspection_result", applyInspectionToMonitor);

    socket.on("test_session_completed", function (payload) {
      if (!payload || payload.test_session_id !== testSession.test_session_id) return;

      if (statusTextEl) statusTextEl.textContent = "Hoàn tất";
      if (statusBoxEl) {
        statusBoxEl.className = "system-status__value COMPLETED";
        statusBoxEl.innerHTML = '<span class="status-dot"></span>Hoàn tất';
      }

      if (countdownEl) {
        countdownEl.textContent = "00:00:00";
      }

      alert(`Lượt kiểm thử ${payload.test_session_id} đã hoàn tất.`);
      window.location.reload();
    });
  }
});