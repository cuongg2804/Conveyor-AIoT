import { Request, Response } from "express";
import Conveyor from "../model/conveyor.model";
import User from "../model/user.model";
import Camera from "../model/camera.model";

/*
edit # editPost:

- edit: chạy khi thằng user bấm nút -> lấy dữ liệu DB -> render

- editPost: chạy khi thằng user bấn "Cập nhật" -> validate dữ liệu -> render error -> nếu ok thì update DB -> redirect về index
*/

const gen_camera_id = () => {
    return "CAM_" + Math.random().toString(36).substr(2, 9);
}
type CameraView = {
  camera_id: string;
  camera_name: string;
  camera_ip?: string;
  type?: string;
  status?: string;
  conveyor_id?: string;
  description?: string;
};
const normalizeCode = (value: any) =>
    String(value || "").trim().toUpperCase()

const ipValid = (value: any) => {
  const ip = String(value || "").trim();

  const parts = ip.split("."); //chia chuỗi theo dấu chấm
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false; 
    /* 
    /.../: dạng biểu thức 
    ^: ký hiệu bắt đầu 1 chuỗi 
    \d: một ký tự số 0-9 
    +:lặp lại 1 hoặc nhiều lần 
    $: kết thúc chuỗi
    */
    const number = Number(part);

    return number >= 0 && number <= 255;
  });
};

export const index = async (req: Request, res: Response) => {
    try {
        const camera = await Camera.find({})
        .sort({ created_at: -1 })
        .lean();

        const conveyorIds = camera
        .map((item: any) => item.conveyor_id)
        .filter(Boolean)

        const conveyors = await Conveyor.find({
          conveyor_id: {$in: conveyorIds}
        },{
          _id: 0,
          conveyor_id: 1,
          name: 1
        }).lean()

        const conveyorMap = new Map(
          conveyors.map((c: any) => [c.conveyor_id, c.name])
        )

        const cameraList = camera.map((item: any) => ({
          ...item,
          conveyor_name: item.conveyor_id
          ? conveyorMap.get(item.conveyor_id || "")
          :  "=",
        }))

        return res.render("cameras/index", {
        title: "Quản lý camera",
        camera: cameraList,
        success: req.query.created === "1" ? "Tạo camera thành công" : null
        });
    } catch(error) {
        console.log("Lỗi load camera: ", error);
        return res.status(500).send("Không thể tải danh sách camera")
    }
}
export const create = async (req: Request, res: Response) => {
  return res.render("cameras/create", {
    title: "Thêm camera",
    error: null,
    form: {
      camera_id: "",
      camera_name: "",
      camera_ip: "",
      //type: "GIGE",
      status: "AVAILABLE",
      description: "",
    },
  });
};
export const createPost = async (req: Request, res: Response) => {
  try {
    const {
      camera_id,
      camera_name,
      camera_ip,
      /*type, */
      description,
    } = req.body;

    const finalCameraId = camera_id
      ? normalizeCode(camera_id)
      : gen_camera_id();

    if (!camera_name) {
      return res.render("cameras/create", {
        title: "Thêm camera",
        error: "Tên camera không được để trống.",
        form: req.body,
      });
    }
    if(!ipValid(camera_ip)) {
      return res.render("cameras/create", {
        tittle: "Thêm camera",
        error: "Địa chỉ IP không hợp lệ. Vui lòng kiểm tra lại!",
        form: req.body,
      })
    }

    const existed = await Camera.findOne({
      camera_id: finalCameraId,
    }).lean();

    if (existed) {
      return res.render("cameras/create", {
        title: "Thêm camera",
        error: "Mã camera đã tồn tại.",
        form: req.body,
      });
    }

    await Camera.create({
      camera_id: finalCameraId,
      camera_name: String(camera_name).trim(),
      camera_ip: String(camera_ip || "").trim(),
      /*type: ["GIGE", "USB", "IP_CAMERA"].includes(String(type).toUpperCase())
        ? String(type).toUpperCase()
        : "GIGE", */
      status: "AVAILABLE",
      conveyor_id: "",
      description: String(description || "").trim(),
    });

    return res.redirect("/cameras");
  } catch (error) {
    console.error("Create camera error:", error);

    return res.render("cameras/create", {
      title: "Thêm camera",
      error: "Không thể thêm camera.",
      form: req.body,
    });
  }
};

export const edit = async (req: Request, res: Response) => {
  try {
    const cameraId = normalizeCode(req.params.camera_id);

    const camera = await Camera.findOne({
      camera_id: cameraId,
    }).lean();

    if (!camera) {
      return res.status(404).send("Không tìm thấy camera.");
    }

    return res.render("cameras/edit", {
      title: "Cập nhật camera",
      camera,
      error: null,
    });
  } catch (error) {
    console.error("Load edit camera error:", error);
    return res.status(500).send("Không thể tải trang cập nhật camera.");
  }
};

export const editPost = async (req: Request, res: Response) => {
  try {
    const cameraId = normalizeCode(req.params.camera_id);

    const {
      camera_name,
      camera_ip,
      /*type, */
      description,
    } = req.body;

    if (!camera_name) {
      const camera = await Camera.findOne({ camera_id: cameraId }).lean();

      return res.render("cameras/edit", {
        title: "Cập nhật camera",
        camera: {
          ...camera,
          ...req.body,
          camera_id: cameraId,
        },
        error: "Tên camera không được để trống.",
      });
    }

    if(!ipValid(camera_ip)){
      const camera = await Camera.findOne({ camera_id: cameraId }).lean();

      return res.render("cameras/edit", {
        title: "Cập nhật camera",
        camera: {
          ...camera,
          ...req.body,
          camera_id: cameraId,
        },
        error: "Địa chỉ IP không hợp lệ. Vui lòng kiểm tra lại!",
      });
    }

    await Camera.updateOne(
      { camera_id: cameraId },
      {
        $set: {
          camera_name: String(camera_name).trim(),
          camera_ip: String(camera_ip || "").trim(),
          /*type: ["GIGE", "USB", "IP_CAMERA"].includes(String(type).toUpperCase())
            ? String(type).toUpperCase()
            : "GIGE", */
          description: String(description || "").trim(),
        },
      }
    );

    return res.redirect("/cameras");
  } catch (error) {
    console.error("Update camera error:", error);
    return res.status(500).send("Không thể cập nhật camera.");
  }
};

export const deleteCamera = async (req: Request, res: Response) => {
  try {
    const cameraId = normalizeCode(req.params.camera_id);

    const camera = await Camera.findOne({ camera_id: cameraId }).lean<CameraView | null>();

    if (!camera) {
      return res.status(404).send("Không tìm thấy camera.");
    }

    if (camera.status === "IN_USE") {
      return res.status(400).send("Không thể xóa camera đang được gán cho băng tải.");
    }

    await Camera.deleteOne({ camera_id: cameraId });

    return res.redirect("/cameras");
  } catch (error) {
    console.error("Delete camera error:", error);
    return res.status(500).send("Không thể xóa camera.");
  }
};