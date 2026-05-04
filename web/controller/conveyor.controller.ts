import { Server } from "socket.io";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
// Hàm chuẩn hóa mã băng tải từ payload
const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();
// Hàm ánh xạ trạng thái runtime từ payload thành trạng thái chuẩn để lưu vào database
const mapRuntimeStatusToDbStatus = (payload: any) => {
  const running = payload.running === true; 
  const rawStatus = String(payload.status || "").toUpperCase(); // Chuẩn hóa trạng thái từ payload để so sánh

  if (rawStatus === "STARTING") return "STARTING";
  if (rawStatus === "STOPPING") return "STOPPING";
  if (running || rawStatus === "RUNNING") return "RUNNING";
  if (rawStatus === "ERROR" || rawStatus.includes("LỖI")) return "ERROR";
  if (rawStatus === "READY") return "READY";
  return "STOPPED";
};
// Controller để xử lý các thông điệp trạng thái hệ thống và lỗi từ MQTT và cập nhật database cũng như phát sự kiện qua Socket.IO
export const handleSystemStatusMessage = async (payload: any, io: Server) => {
  try {
    const conveyorCode = normalizeConveyorCode(payload.conveyor_code);

    if (!conveyorCode) {
<<<<<<< Updated upstream
      console.warn("Trạng thái hệ thống không có mã băng tải:", payload);
      io.emit("system_status", payload); // Phát sự kiện đi kèm payload gốc để client xử lý
=======
      console.warn("Không xác định được conveyor_code:", payload);
      io.emit("system_status", payload);
>>>>>>> Stashed changes
      return;
    }
    // Ánh xạ trạng thái runtime từ payload thành trạng thái chuẩn để lưu vào database
    const dbStatus = mapRuntimeStatusToDbStatus(payload);
    // Cập nhật trạng thái băng tải trong database và lấy thông tin băng tải sau khi cập nhật
    const conveyor = await ConveyorConfig.findOneAndUpdate(
      { conveyor_code: conveyorCode }, // Tìm kiếm băng tải theo mã băng tải
      { status: dbStatus }, // Cập nhật trạng thái mới cho băng tải
      { new: true, runValidators: true } // Trả về document sau khi cập nhật và chạy validators để đảm bảo dữ liệu hợp lệ
    )
      .select("-_id") // Loại bỏ trường _id khỏi kết quả trả về để chỉ lấy thông tin cần thiết
      .lean(); // Chuyển đổi document Mongoose thành plain JavaScript object để xử lý và phát qua Socket.IO

    if (!conveyor) {
      console.warn(`Không tìm thấy conveyor_config: ${conveyorCode}`);
    } else {
      console.log(`Băng tải ${conveyorCode} đã được cập nhật trạng thái: ${dbStatus}`);
    }
    // Phát sự kiện "system_status" qua Socket.IO với dữ liệu kết hợp giữa payload gốc và thông tin băng tải sau khi cập nhật
    io.emit("system_status", {
      ...payload,
      conveyor_code: conveyorCode,
      db_status: dbStatus,
    });
  } catch (error) {
    console.error("handleSystemStatusMessage lỗi:", error);
    io.emit("system_status", payload);
  }
};
// Controller để xử lý các thông điệp lỗi hệ thống từ MQTT và cập nhật trạng thái lỗi trong database cũng như phát sự kiện qua Socket.IO
export const handleSystemErrorMessage = async (payload: any, io: Server) => {
  try {
    const conveyorCode = normalizeConveyorCode(payload.conveyor_code);

    if (conveyorCode) {
      await ConveyorConfig.updateOne({ conveyor_code: conveyorCode }, { status: "ERROR" });
    }

    io.emit("system_error", payload);
  } catch (error) {
    console.error("handleSystemErrorMessage lỗi:", error);
    io.emit("system_error", payload);
  }
};
