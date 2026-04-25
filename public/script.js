const socket = io();

/* ================= TOAST ================= */
const showToast = (message, type = "success") => {
  let background = "linear-gradient(to right, #00b09b, #96c93d)";

  if (type === "error") {
    background = "linear-gradient(to right, #ff5f6d, #ffc371)";
  }

  if (type === "info") {
    background = "linear-gradient(to right, #2193b0, #6dd5ed)";
  }

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

  if (src) {
    el.src = src;
  } else {
    el.removeAttribute("src");
  }
};

const formatScore = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return "-";
  return num.toFixed(3);
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return "-";

  const ts = Number(timestamp);
  const date = ts > 1000000000000
    ? new Date(ts)
    : new Date(ts * 1000);

  return date.toLocaleString("vi-VN");
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
  const topEl = document.getElementById("systemStatusText");

  if (!el) return;

  el.classList.remove("connected", "disconnected");

  if (status === "connected") {
    el.classList.add("connected");
    el.innerHTML = `<span class="status-dot"></span>Kết nối thành công`;
    if (topEl) topEl.textContent = "MQTT đã kết nối";
    showToast("MQTT đã kết nối", "success");
  }

  if (status === "disconnected") {
    el.classList.add("disconnected");
    el.innerHTML = `<span class="status-dot"></span>Mất kết nối`;
    if (topEl) topEl.textContent = "MQTT mất kết nối";
    showToast("MQTT bị mất kết nối", "error");
  }
};

/* ================= MQTT STATUS ================= */
socket.on("mqtt_status", (data) => {
  console.log("mqtt_status:", data);
  updateMqttStatus(data.status);
});

/* ================= INSPECTION RESULT ================= */
socket.on("inspection_result", (data) => {
  console.log("inspection_result:", data);

  setText("jobId", data.job_id);
  updateResultBadge(data.label);
  setText("averageScore", formatScore(data.average_score));
  setText("resultTimestamp", formatTimestamp(data.timestamp));

  const frames = Array.isArray(data.frames) ? data.frames : [];

  // Ưu tiên Frame 2, nếu không có thì fallback Frame 1
  const previewFrame = frames[1] || frames[0];

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

  showToast(`Nhận kết quả Job ${data.job_id}: ${data.label}`, "info");
});