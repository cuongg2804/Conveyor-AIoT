//localStorage dùng chung giữa nhiều tab cùng trình duyệt, còn sessionStorage chỉ riêng từng tab.
// device_id dùng để định danh 1 thiết bị/trình duyệt

const getDeviceId = () => {
  let deviceId = localStorage.getItem("device_id");

  if (!deviceId) {
    deviceId =
      "DEVICE_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10);

    localStorage.setItem("device_id", deviceId);
  }

  return deviceId;
};

const createPageInstanceId = () =>
  "PAGE_" +
  Date.now().toString(36) +
  "_" +
  Math.random().toString(36).slice(2, 10);

window.__DEVICE_ID__ = getDeviceId();
window.__PAGE_INSTANCE_ID__ = createPageInstanceId();

document.addEventListener("DOMContentLoaded", () => {
  const deviceInput = document.getElementById("device_id");

  if (deviceInput) {
    deviceInput.value = window.__DEVICE_ID__;
  }
});

const lastInternalNavigationAt = Number(
  sessionStorage.getItem("last_internal_navigation_at") || 0
);

const isInternalNavigation =
  lastInternalNavigationAt > 0 && Date.now() - lastInternalNavigationAt < 5000;

const hasSocketIo = typeof io === "function";

window.appSocket =
  window.appSocket ||
  (hasSocketIo
    ? io({
        auth: {
          device_id: window.__DEVICE_ID__,
          page_instance_id: window.__PAGE_INSTANCE_ID__,
          pathname: window.location.pathname,
          internal_navigation: isInternalNavigation,
        },
      })
    : null);

const socket = window.appSocket;
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;

  const url = new URL(link.href, window.location.origin);
  if (url.origin !== window.location.origin) return;

  sessionStorage.setItem("last_internal_navigation_at", String(Date.now()));
});

const COMMAND_LABELS = {
  START_SYSTEM: "Bắt đầu phiên kiểm tra",
  STOP_SYSTEM: "Kết thúc phiên kiểm tra",
  GET_STATUS: "Kiểm tra trạng thái",
  GET_SERIAL_PORTS: "Quét cổng Serial",
  SCAN_CAMERAS: "Quét camera",
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
let pendingModelApprovalAfterStop = false;

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
  if (normalized.includes("camera ip is required")) return "Camera đã chọn chưa có địa chỉ mạng hợp lệ.";
  if (normalized.includes("cannot find camera with ip")) return "Không tìm thấy đúng camera đã chọn. Hãy kiểm tra nguồn điện, dây mạng và cấu hình mạng camera.";
  if (normalized.includes("no camera found")) return "Không tìm thấy camera nào đang kết nối.";

  return raw
    .replaceAll("START_SYSTEM", "Bắt đầu phiên kiểm tra")
    .replaceAll("STOP_SYSTEM", "Kết thúc phiên kiểm tra")
    .replaceAll("GET_STATUS", "Kiểm tra trạng thái")
    .replaceAll("stt", "Số thứ tự")
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

const isTestRuntimeMode = () => normalizeCode(window.__RUNTIME_MODE__) === "TEST";

function showModelApprovalModal() {
  const modal = document.getElementById("modelApprovalModal");
  if (!modal || !isTestRuntimeMode()) return;

  if (typeof $ === "function" && typeof $(modal).modal === "function") {
    $(modal).modal("show");
    return;
  }

  modal.classList.add("show");
  modal.style.display = "block";
  modal.removeAttribute("aria-hidden");
}

function showModelApprovalAfterStopIfReady(dbStatus, sessionStatus, sessionRunning) {
  if (!pendingModelApprovalAfterStop || !isTestRuntimeMode()) return;

  const stoppedStatuses = ["STOPPED", "STOP", "READY", "OFFLINE"];
  const stoppedByDb = stoppedStatuses.includes(normalizeCode(dbStatus));
  const stoppedBySession =
    sessionRunning === false &&
    ["", "STOPPED", "STOP", "READY"].includes(normalizeCode(sessionStatus));

  if (!stoppedByDb && !stoppedBySession) return;

  pendingModelApprovalAfterStop = false;
  showModelApprovalModal();
}

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

const setInspectionSessionStatus = (running, status) => {
  const el = document.getElementById("inspectionSessionStatus");
  if (!el) return;

  el.classList.remove("connected", "disconnected", "warning");
  if (running) {
    el.classList.add("connected");
    el.innerHTML = '<span class="status-dot"></span>Đang kiểm tra';
    return;
  }

  el.classList.add(status === "ERROR" ? "disconnected" : "warning");
  el.innerHTML = `<span class="status-dot"></span>${status === "ERROR" ? "Lỗi" : "Chưa bắt đầu"}`;
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

  const displayId = data.stt || data.inspection_id;

  setText("stt", displayId ? `Lượt ${displayId}` : "-");
  //setText("jobId", displayId ? `Lượt ${displayId}` : "-");
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

    if (command === "START_SYSTEM") setInspectionSessionStatus(false, "STARTING");
    if (command === "STOP_SYSTEM") setInspectionSessionStatus(false, "STOPPING");
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

    if (command === "START_SYSTEM") {
      inspectionSessionActive = true;
      pendingModelApprovalAfterStop = false;
    }

    if (command === "STOP_SYSTEM") {
      inspectionSessionActive = false;
      if (isTestRuntimeMode()) pendingModelApprovalAfterStop = true;
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

let pendingCameraScanCommandId = "";
let lastHandledCameraScanCommandId = "";
let cameraScanTimeout = null;
let lastDiscoveredCameras = [];

const getCameraPicker = () => document.querySelector("[data-camera-picker]");

const setCameraScanStatus = (message, isError = false) => {
  const status = document.querySelector("[data-camera-scan-status]");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-error", isError);
};

const setCameraScanButtonLoading = (loading) => {
  const button = document.querySelector("[data-camera-scan-button]");
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading ? "Đang quét..." : "Quét camera";
};

const cameraScanErrorMessage = (message) => {
  const normalized = String(message || "").trim().toLowerCase();

  if (normalized.includes("no camera found")) {
    return "Không tìm thấy camera. Vui lòng kiểm tra nguồn và kết nối mạng.";
  }

  if (
    normalized.includes("busy") ||
    normalized.includes("noaccess") ||
    normalized.includes("access denied")
  ) {
    return "Camera đang được chương trình khác sử dụng.";
  }

  return "Không thể quét camera. Vui lòng kiểm tra kết nối và thử lại.";
};

const cameraAccessInfo = (camera) => {
  const raw = String(camera?.access_status || "").toLowerCase();
  const busy = ["busy", "noaccess", "read-only", "readonly", "unavailable"].some(
    (value) => raw.includes(value)
  );

  return busy
    ? { label: "Đang được sử dụng", busy: true }
    : { label: "Có thể sử dụng", busy: false };
};

const appendCameraDetail = (card, label, value) => {
  const line = document.createElement("p");
  line.className = "camera-device-card__detail";

  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;

  line.appendChild(strong);
  line.appendChild(document.createTextNode(value || "-"));
  card.appendChild(line);
};

const renderCameraCards = (cameras) => {
  const grid = document.querySelector("[data-camera-scan-results]");
  const input = document.getElementById("camera_ip");
  if (!grid || !input) return;

  grid.innerHTML = "";
  lastDiscoveredCameras = Array.isArray(cameras) ? cameras : [];

  if (lastDiscoveredCameras.length === 0) {
    setCameraScanStatus(
      "Không tìm thấy camera. Vui lòng kiểm tra nguồn và kết nối mạng.",
      true
    );
    return;
  }

  const selectedIp = String(input.value || "").trim();

  lastDiscoveredCameras.forEach((camera, index) => {
    const ip = String(camera.ip || camera.camera_ip || camera.ip_address || "").trim();
    const access = cameraAccessInfo(camera);
    const selectable = !!ip && !access.busy;
    const selected = !!ip && ip === selectedIp;

    const card = document.createElement("article");
    card.className = `camera-device-card${selected ? " is-selected" : ""}`;

    const head = document.createElement("div");
    head.className = "camera-device-card__head";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h4");
    title.className = "camera-device-card__title";
    title.textContent = `Camera ${index + 1}`;

    const status = document.createElement("span");
    status.className = `camera-device-card__status${access.busy ? " is-busy" : ""}${
      !ip ? " is-error" : ""
    }`;
    status.textContent = ip ? access.label : "Không xác định được địa chỉ";

    titleWrap.appendChild(title);
    titleWrap.appendChild(status);
    head.appendChild(titleWrap);
    card.appendChild(head);

    appendCameraDetail(card, "Loại camera", camera.model || "Camera công nghiệp");
    appendCameraDetail(card, "Địa chỉ mạng", ip || "Không xác định");

    const details = document.createElement("details");
    details.className = "camera-device-card__technical";
    const summary = document.createElement("summary");
    summary.textContent = "Thông tin kỹ thuật";
    const serial = document.createElement("p");
    serial.textContent = `Mã thiết bị: ${camera.serial_number || camera.id || "-"}`;
    details.appendChild(summary);
    details.appendChild(serial);
    card.appendChild(details);

    const chooseButton = document.createElement("button");
    chooseButton.type = "button";
    chooseButton.className = selected ? "btn btn--success" : "btn btn--primary";
    chooseButton.disabled = !selectable;
    chooseButton.textContent = selected ? "Đã chọn" : "Chọn camera";
    chooseButton.addEventListener("click", () => {
      input.value = ip;
      renderCameraCards(lastDiscoveredCameras);
    });

    card.appendChild(chooseButton);
    grid.appendChild(card);
  });

  const selectedFound = lastDiscoveredCameras.some(
    (camera) =>
      String(camera.ip || camera.camera_ip || camera.ip_address || "").trim() ===
      selectedIp
  );

  setCameraScanStatus(
    selectedFound
      ? `Tìm thấy ${lastDiscoveredCameras.length} camera.`
      : `Tìm thấy ${lastDiscoveredCameras.length} camera. Hãy chọn một camera.`
  );
};

const handleCameraScanAck = (ack) => {
  if (!getCameraPicker() || ack?.command !== "SCAN_CAMERAS") return;
  if (
    pendingCameraScanCommandId &&
    ack.command_id &&
    ack.command_id !== pendingCameraScanCommandId
  ) {
    return;
  }

  clearTimeout(cameraScanTimeout);
  lastHandledCameraScanCommandId = ack.command_id || "";
  pendingCameraScanCommandId = "";
  setCameraScanButtonLoading(false);

  if (ack.status !== "SUCCESS") {
    setCameraScanStatus(cameraScanErrorMessage(ack.message), true);
    return;
  }

  renderCameraCards(ack.data?.cameras || []);
};

const requestCameraScan = async () => {
  if (!getCameraPicker()) return;

  setCameraScanButtonLoading(true);
  setCameraScanStatus("Đang quét camera...");

  try {
    const response = await fetch("/control/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: "SCAN_CAMERAS",
        payload: {},
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "Không thể quét camera.");
    }

    const commandId = data.data?.command_id || "";
    if (commandId && commandId === lastHandledCameraScanCommandId) {
      pendingCameraScanCommandId = "";
      setCameraScanButtonLoading(false);
      return;
    }

    pendingCameraScanCommandId = commandId;
    clearTimeout(cameraScanTimeout);
    cameraScanTimeout = setTimeout(() => {
      pendingCameraScanCommandId = "";
      setCameraScanButtonLoading(false);
      setCameraScanStatus(
        "Không nhận được phản hồi. Vui lòng kiểm tra kết nối và thử lại.",
        true
      );
    }, 12000);
  } catch (error) {
    setCameraScanButtonLoading(false);
    setCameraScanStatus(cameraScanErrorMessage(error.message), true);
  }
};

const initCameraPicker = () => {
  const picker = getCameraPicker();
  if (!picker) return;

  const scanButton = picker.querySelector("[data-camera-scan-button]");
  if (scanButton) {
    scanButton.addEventListener("click", requestCameraScan);
  }
};

function initSerialPortSelect() {
  const serialSelect = document.getElementById("serial_port");
  if (!serialSelect || !socket) return;

  const currentPort = serialSelect.dataset.current || serialSelect.value || "";

  fetch("/settings/serial-ports").catch(() => {
    showToast("Không gửi được yêu cầu quét cổng Serial.", "error");
  });
  if(socket){
    socket.on("control_ack", (payload) => {
      if (!["GET_SERIAL_PORTS"].includes(payload.command)) return;

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
if(socket){
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
    setInspectionSessionStatus(true, "RUNNING");
    //showToast(`Đã nhận kết quả kiểm tra: ${resultLabel(data.label)}`, "info");
  });

  socket.on("control_ack", (ack) => {
    if (ack.command === "SCAN_CAMERAS") {
      if (ack.status === "ERROR") handleCameraScanAck(ack);
      return;
    }

    updateControlAckBox(ack);

    if (ack.status === "SUCCESS" && ack.command === "START_SYSTEM") {
      inspectionSessionActive = true;
      setInspectionSessionStatus(false, "STARTING");
      //showToast("AI đã nhận yêu cầu bắt đầu phiên kiểm tra", "info");
    }

    if (ack.status === "SUCCESS" && ack.command === "STOP_SYSTEM") {
      inspectionSessionActive = false;
      clearInspectionResult();
      setInspectionSessionStatus(false, "STOPPING");
      //showToast("AI đã nhận yêu cầu kết thúc phiên kiểm tra", "info");
    }

    if (ack.status === "SUCCESS" && !["START_SYSTEM", "STOP_SYSTEM"].includes(ack.command)) {
      //showToast(`${commandLabel(ack.command)} thành công`, "success");

      if (ack.command === "GET_STATUS") {
        showToast("Đã đọc trạng thái băng tải từ Arduino", "success");
      }
    }

    if (ack.status === "ERROR") {
      const message = userMessage(ack.message, "Thao tác không thực hiện được.");

      showToast(`${commandLabel(ack.command)} thất bại: ${message}`, "error");
      setAiStatus("disconnected", `Lỗi: ${message}`);
    }
  });

  socket.on("camera_scan_results", handleCameraScanAck);

  socket.on("system_status", (status) => {
    const dbStatus = normalizeCode(status.db_status || status.conveyor_status);
    const sessionRunning = status.session_running === true;
    const sessionStatus = normalizeCode(status.session_status || status.status);

    inspectionSessionActive = sessionRunning;
    setInspectionSessionStatus(sessionRunning, sessionStatus);
    showModelApprovalAfterStopIfReady(dbStatus, sessionStatus, sessionRunning);

    if (dbStatus === "RUNNING") {
      setAiStatus("connected", "Băng tải đang chạy");
      return;
    }

    if (dbStatus === "ERROR") {
      setAiStatus("disconnected", "Băng tải đang dừng khẩn cấp");
      return;
    }
    //
    if (dbStatus === "OFFLINE") {
      setAiStatus("disconnected", "Không đọc được trạng thái Arduino");
      return;
    }

    setAiStatus("warning", "Băng tải đang dừng");
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

}
const initArduinoSpeedSelects = () => {
  const lowSelect = document.getElementById("arduino_speed_low_level");
  const highSelect = document.getElementById("arduino_speed_high_level");

  if (!lowSelect || !highSelect) return;

  const presets = Array.isArray(window.SPEED_PRESETS)
    ? window.SPEED_PRESETS
    : [];

  const updateHighOptions = () => {
    const lowLevel = Number(lowSelect.value);
    const previousHighLevel = Number(highSelect.value);

    const validHighPresets = presets.filter(
      (preset) => Number(preset.level) > lowLevel
    );

    highSelect.innerHTML = "";

    validHighPresets.forEach((preset) => {
      const option = document.createElement("option");

      option.value = preset.level;
      option.textContent =
        `${preset.level} - ${preset.label} | ` +
        `PWM ${preset.pwm} | RPM ${preset.rpm}`;

      highSelect.appendChild(option);
    });

    const previousValueStillValid = validHighPresets.some(
      (preset) => Number(preset.level) === previousHighLevel
    );

    if (previousValueStillValid) {
      highSelect.value = String(previousHighLevel);
    } else if (validHighPresets.length > 0) {
      highSelect.value = String(validHighPresets[0].level);
    }
  };

  lowSelect.addEventListener("change", updateHighOptions);
  updateHighOptions();
};

document.addEventListener("DOMContentLoaded", () => {
  if (window.__LATEST_INSPECTION__) {
    renderInspectionResult(window.__LATEST_INSPECTION__);
  }

  initSerialPortSelect();
  initCameraPicker();
  initFullnameValidation();
  initHistoryImageModal();
  initArduinoSpeedSelects();

  // if (hasMonitorContext()) {
  //   setTimeout(() => sendControlCommand("GET_STATUS"), 600);
  // }
});
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".js-password-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.target;
      const input = document.getElementById(targetId);

      if (!input) return;

      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      button.textContent = isPassword ? "🙈" : "👁";
      button.setAttribute(
        "aria-label",
        isPassword ? "Ẩn mật khẩu" : "Hiển thị mật khẩu"
      );
    });
  });
});
