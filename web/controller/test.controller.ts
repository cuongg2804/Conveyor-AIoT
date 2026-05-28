import { Request, Response } from "express";
import mongoose from "mongoose";
import Camera from "../model/camera.model";
import Conveyor from "../model/conveyor.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import ModelRegistry from "../model/modelRegister.model";
import InspectionResult from "../model/inspection-result.model";
import TestSession from "../model/test.model";
import { publishControlCommand } from "../service/mqtt.service";

const PAGE_SIZE = 10;

const normalizeCode = (value: any) => {
  return String(value || "").trim().toUpperCase();
};

const toNumberInRange = (
  value: any,
  defaultValue: number,
  min: number,
  max: number
) => {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return defaultValue;
  }

  return Math.min(Math.max(num, min), max);
};

const formatTestSessionId = () => {
  const now = new Date();

  const pad = (value: number) => {
    return String(value).padStart(2, "0");
  };

  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();

  return `TEST_${yyyy}${mm}${dd}_${hh}${mi}${ss}_${random}`;
};

export const scanPorts = async (req: Request, res: Response) => {
  try {
    const command = publishControlCommand("GET_SERIAL_PORTS", {
      run_mode: "TEST",
    });

    return res.json({
      success: true,
      command_id: command.command_id,
      message: "Đã gửi yêu cầu scan cổng Serial.",
    });
  } catch (error) {
    console.log("Lỗi scan serial ports trong test mode:", error);

    return res.status(500).json({
      success: false,
      message: "Không thể gửi yêu cầu scan cổng Serial.",
    });
  }
};

const getTestSettingsData = async (form: any = {}, error: string | null = null) => {
  const runningSessions = await TestSession.find(
    { status: "RUNNING" },
    { _id: 0, conveyor_id: 1 }
  ).lean();

  const runningConveyorIds = runningSessions
    .map((item: any) => item.conveyor_id)
    .filter(Boolean);

  const conveyors = await Conveyor.find(
    {
      is_active: true,
      conveyor_id: { $nin: runningConveyorIds },
    },
    {
      _id: 0,
      conveyor_id: 1,
      name: 1,
      status: 1,
    }
  )
    .sort({ created_at: -1 })
    .lean();

  const usedCameraIds = await ConveyorConfig.find({
    camera_id: { $nin: [null, ""] },
  }).distinct("camera_id");

  const cameras = await Camera.find(
    {
      $or: [
        { status: "AVAILABLE" },
        { camera_id: { $nin: usedCameraIds } },
      ],
    },
    {
      _id: 0,
      camera_id: 1,
      camera_name: 1,
      ip_address: 1,
      status: 1,
    }
  )
    .sort({ created_at: -1 })
    .lean();

  const models = await ModelRegistry.find({ status: "testing" })
    .sort({ created_at: -1 })
    .lean();

  return {
    title: "Cài đặt kiểm thử",
    conveyors,
    cameras,
    models,
    error,
    success: null,
    form: {
      conveyor_id: "",
      model_id: "",
      duration_minutes: 10,
      camera_id: "",
      camera_trigger_delay: 0,
      serial_port: "",
      baud_rate: 9600,
      ai_threshold: "",
      speed: 150,
      goc_home: 0,
      goc_gat: 120,
      ...form,
    },
  };
};

export const getAvailableOptions = async (req: Request, res: Response) => {
  try {
    const conveyorId = normalizeCode(req.params.conveyor_id);

    if (!conveyorId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu mã băng tải.",
      });
    }

    const conveyor = await Conveyor.findOne({
      conveyor_id: conveyorId,
      is_active: true,
    }).lean();

    if (!conveyor) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy băng tải.",
      });
    }

    const runningSession = await TestSession.findOne({
      conveyor_id: conveyorId,
      status: "RUNNING",
    }).lean();

    if (runningSession) {
      return res.status(409).json({
        success: false,
        message: "Băng tải này đang có lượt kiểm thử đang chạy.",
      });
    }

    const usedConfigs = await ConveyorConfig.find(
      {
        conveyor_id: { $ne: conveyorId },
        camera_id: { $nin: [null, ""] },
      },
      {
        _id: 0,
        camera_id: 1,
      }
    ).lean();

    const usedCameraIds = usedConfigs
      .map((item: any) => item.camera_id)
      .filter(Boolean);

    const cameras = await Camera.find(
      {
        is_active: true,
        camera_id: { $nin: usedCameraIds },
      },
      {
        _id: 0,
        camera_id: 1,
        camera_name: 1,
        ip_address: 1,
        status: 1,
      }
    )
      .sort({ created_at: -1 })
      .lean();

    const config: any = await ConveyorConfig.findOne({
      conveyor_id: conveyorId,
    }).lean();

    return res.json({
      success: true,
      conveyor,
      config,
      cameras,
    });
  } catch (error) {
    console.log("Lỗi lấy options kiểm thử:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể lấy dữ liệu cấu hình kiểm thử.",
    });
  }
};

const summarizeResults = (items: any[]) => {
  const totalProducts = items.length;

  const okCount = items.filter((item) => {
    return String(item.label || "").toUpperCase() === "OK";
  }).length;

  const ngCount = items.filter((item) => {
    return String(item.label || "").toUpperCase() === "NG";
  }).length;

  const scores = items
    .map((item) => Number(item.average_score))
    .filter(Number.isFinite);

  const avgScore = scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : null;

  return {
    total_products: totalProducts,
    ok_count: okCount,
    ng_count: ngCount,
    avg_score: avgScore,
  };
};

export const settings = async (req: Request, res: Response) => {
  try {
    const viewData = await getTestSettingsData();

    return res.render("test-mode/settings", {
      ...viewData,
      success:
        req.query.started === "1"
          ? "Đã bắt đầu quá trình kiểm thử."
          : null,
    });
  } catch (error) {
    console.log("Lỗi tải trang cài đặt kiểm thử:", error);
    return res.status(500).send("Không thể tải trang cài đặt kiểm thử.");
  }
};

export const startTest = async (req: Request, res: Response) => {
  try {
    const {
      conveyor_id,
      model_id,
      duration_minutes,
      camera_id,
      camera_trigger_delay,
      serial_port,
      baud_rate,
      ai_threshold,
      speed,
      goc_home,
      goc_gat,
    } = req.body;

    

    const normalizedConveyorId = normalizeCode(conveyor_id);
    const selectedModelId = String(model_id || "").trim();

    const renderError = async (message: string) => {
      return res.status(400).render(
        "test-mode/settings",
        await getTestSettingsData(req.body, message)
      );
    };
    const selectedCameraId = normalizeCode(camera_id);

    if (!selectedCameraId) {
        return renderError("Vui lòng chọn camera cho lượt kiểm thử.");
    }

    const usedCamera = await ConveyorConfig.findOne({
    conveyor_id: { $ne: normalizedConveyorId },
    camera_id: selectedCameraId,
    }).lean();

    if (usedCamera) {
        return renderError("Camera này đang được sử dụng bởi băng tải khác.");
    }

    if (!String(serial_port || "").trim()) {
        return renderError("Vui lòng chọn cổng Serial cho lượt kiểm thử.");
    }

    if (!normalizedConveyorId) {
      return renderError("Vui lòng chọn băng tải cần kiểm thử.");
    }

    if (!selectedModelId || !mongoose.Types.ObjectId.isValid(selectedModelId)) {
      return renderError("Vui lòng chọn model AI hợp lệ để kiểm thử.");
    }

    const conveyor = await Conveyor.findOne({
      conveyor_id: normalizedConveyorId,
      is_active: true,
    }).lean();

    if (!conveyor) {
      return renderError("Không tìm thấy băng tải cần kiểm thử.");
    }

    const model = await ModelRegistry.findOne({
      _id: selectedModelId,
      status: "testing",
    }).lean();

    if (!model) {
      return renderError(
        "Model AI không tồn tại hoặc không ở trạng thái chờ kiểm thử."
      );
    }

    const baseConfig: any = await ConveyorConfig.findOne({
      conveyor_id: normalizedConveyorId,
    }).lean();

    if (!baseConfig) {
      return renderError("Không tìm thấy cấu hình hiện tại của băng tải.");
    }

    const runningSession = await TestSession.findOne({
      conveyor_id: normalizedConveyorId,
      status: "RUNNING",
    }).lean();

    if (runningSession) {
      return renderError(
        `Băng tải ${normalizedConveyorId} đang có một lượt kiểm thử đang chạy. Vui lòng dừng hoặc chờ kết thúc trước khi tạo lượt mới.`
      );
    }

    const durationMinutes = toNumberInRange(duration_minutes, 10, 1, 240);

    const configSnapshot = {
      conveyor_id: normalizedConveyorId,
      camera_id: normalizeCode(camera_id || baseConfig.camera_id),
      camera_trigger_delay: toNumberInRange(
        camera_trigger_delay,
        Number(baseConfig.camera_trigger_delay || 0),
        0,
        10000
      ),
      serial_port: String(serial_port || baseConfig.serial_port || "").trim(),
      baud_rate: toNumberInRange(
        baud_rate,
        Number(baseConfig.baud_rate || 9600),
        1200,
        115200
      ),
      ai_threshold: Number.isFinite(Number(ai_threshold))
        ? Number(ai_threshold)
        : Number(model.threshold || baseConfig.ai_threshold || 0),
      speed: toNumberInRange(speed, Number(baseConfig.speed || 150), 0, 255),
      goc_home: toNumberInRange(
        goc_home,
        Number(baseConfig.goc_home || 0),
        0,
        180
      ),
      goc_gat: toNumberInRange(
        goc_gat,
        Number(baseConfig.goc_gat || 120),
        0,
        180
      ),
    };

    if (!configSnapshot.serial_port) {
      return renderError("Vui lòng cấu hình cổng Serial cho lượt kiểm thử.");
    }

    const modelSnapshot = {
      model_id: String(model._id),
      model_name: model.model_name,
      version: model.version,
      product_code: model.product_code,
      storage_type: model.storage_type,
      bucket: model.bucket,
      object_key: model.object_key,
      threshold: model.threshold,
      accuracy: model.accuracy,
      precision: model.precision,
      recall: model.recall,
      f1_score: model.f1_score,
    };

    const testSessionId = formatTestSessionId();
    const now = new Date();

    await TestSession.create({
      test_session_id: testSessionId,
      conveyor_id: normalizedConveyorId,
      model_id: model._id,
      model_name: model.model_name,
      model_version: model.version,
      status: "RUNNING",
      started_at: now,
      ended_at: null,
      duration_minutes: durationMinutes,
      config_snapshot: configSnapshot,
      model_snapshot: modelSnapshot,
      total_products: 0,
      ok_count: 0,
      ng_count: 0,
      avg_score: null,
    });

    await Conveyor.updateOne(
      { conveyor_id: normalizedConveyorId },
      { $set: { status: "RUNNING" } }
    );

    publishControlCommand("START_TEST", {
      run_mode: "TEST",
      test_session_id: testSessionId,
      conveyor_id: normalizedConveyorId,
      duration_minutes: durationMinutes,
      config: configSnapshot,
      model: modelSnapshot,
    });

    return res.redirect("/test-mode/history?started=1");
  } catch (error) {
    console.log("Lỗi bắt đầu kiểm thử:", error);
    return res.status(500).send("Không thể bắt đầu quá trình kiểm thử.");
  }
};

export const history = async (req: Request, res: Response) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * PAGE_SIZE;

    const total = await TestSession.countDocuments({});

    const sessions = await TestSession.find({})
      .sort({ started_at: -1 })
      .skip(skip)
      .limit(PAGE_SIZE)
      .lean<any[]>();

    const sessionIds = sessions.map((session) => session.test_session_id);

    const aggregates = await InspectionResult.aggregate([
      {
        $match: {
          run_mode: "TEST",
          test_session_id: { $in: sessionIds },
        },
      },
      {
        $group: {
          _id: "$test_session_id",
          total_products: { $sum: 1 },
          ok_count: {
            $sum: {
              $cond: [{ $eq: ["$label", "OK"] }, 1, 0],
            },
          },
          ng_count: {
            $sum: {
              $cond: [{ $eq: ["$label", "NG"] }, 1, 0],
            },
          },
          avg_score: { $avg: "$average_score" },
        },
      },
    ]);

    const aggregateMap = new Map(
      aggregates.map((item: any) => [item._id, item])
    );

    const testList = sessions.map((session, index) => {
      const stats: any = aggregateMap.get(session.test_session_id) || {};

      return {
        ...session,
        stt: skip + index + 1,
        total_products: stats.total_products ?? session.total_products ?? 0,
        ok_count: stats.ok_count ?? session.ok_count ?? 0,
        ng_count: stats.ng_count ?? session.ng_count ?? 0,
        avg_score: Number.isFinite(Number(stats.avg_score))
          ? Number(stats.avg_score)
          : session.avg_score,
      };
    });

    const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

    return res.render("test-mode/history", {
      title: "Lịch sử kiểm thử",
      testList,
      success:
        req.query.started === "1"
          ? "Đã bắt đầu quá trình kiểm thử."
          : null,
      pagination: {
        page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevUrl: `/test-mode/history?page=${page - 1}`,
        nextUrl: `/test-mode/history?page=${page + 1}`,
      },
    });
  } catch (error) {
    console.log("Lỗi tải lịch sử kiểm thử:", error);
    return res.status(500).send("Không thể tải lịch sử kiểm thử.");
  }
};

export const detail = async (req: Request, res: Response) => {
  try {
    const testSessionId = String(req.params.test_session_id || "").trim();

    const session = await TestSession.findOne({
      test_session_id: testSessionId,
    }).lean();

    if (!session) {
      return res.status(404).send("Không tìm thấy lượt kiểm thử.");
    }

    const items = await InspectionResult.find(
      {
        run_mode: "TEST",
        test_session_id: testSessionId,
      },
      { _id: 0 }
    )
      .sort({ timestamp: -1 })
      .lean<any[]>();

    const summary = summarizeResults(items);

    const inspectionList = items.map((item, index) => {
      const previewFrame = Array.isArray(item.frames)
        ? item.frames[1] || item.frames[0]
        : null;

      return {
        ...item,
        stt: index + 1,
        display_id: item.inspection_id || item.job_id || "-",
        preview_frame: previewFrame,
      };
    });

    return res.render("test-mode/detail", {
      title: `Chi tiết lượt kiểm thử ${testSessionId}`,
      session,
      summary,
      inspectionList,
    });
  } catch (error) {
    console.log("Lỗi tải chi tiết lượt kiểm thử:", error);
    return res.status(500).send("Không thể tải chi tiết lượt kiểm thử.");
  }
};

export const stopTest = async (req: Request, res: Response) => {
  try {
    const testSessionId =
      String(req.params.test_session_id || "").trim() ||
      String(req.body.test_session_id || "").trim();

    if (!testSessionId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu mã lượt kiểm thử.",
      });
    }

    const session = await TestSession.findOne({
      test_session_id: testSessionId,
    }).lean();

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy lượt kiểm thử.",
      });
    }

    publishControlCommand("STOP_TEST", {
      run_mode: "TEST",
      test_session_id: testSessionId,
      conveyor_id: session.conveyor_id,
    });

    const items = await InspectionResult.find(
      {
        run_mode: "TEST",
        test_session_id: testSessionId,
      },
      { _id: 0, label: 1, average_score: 1 }
    ).lean<any[]>();

    const summary = summarizeResults(items);

    await TestSession.updateOne(
      { test_session_id: testSessionId },
      {
        $set: {
          status: "COMPLETED",
          ended_at: new Date(),
          total_products: summary.total_products,
          ok_count: summary.ok_count,
          ng_count: summary.ng_count,
          avg_score: summary.avg_score,
        },
      }
    );

    await Conveyor.updateOne(
      { conveyor_id: session.conveyor_id },
      { $set: { status: "READY" } }
    );

    return res.json({
      success: true,
      message: "Đã gửi yêu cầu dừng kiểm thử.",
    });
  } catch (error) {
    console.log("Lỗi dừng kiểm thử:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể dừng quá trình kiểm thử.",
    });
  }
};