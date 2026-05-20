import {Request, Response} from "express";
import Conveyor from "../model/conveyor.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import Camera from "../model/camera.model";
import User from "../model/user.model";
import Config_log from "../model/config_logs.model";

const gen_conveyor_id = () => {
    return "BT_" + Math.random().toString(36).substring(2, 9).toUpperCase();
}

const getCreateViewData = async (form: any = {}, error: string | null = null) => {
  const cameras = await Camera.find({ status: "AVAILABLE" }).lean();

  const usedOperatorIds = await Conveyor.find({
    operator_id: { $ne: "" },
  }).distinct("operator_id");

  const operators = await User.find(
    {
      user_id: { $nin: usedOperatorIds },
    },
    {
      _id: 0,
      user_id: 1,
      fullname: 1,
    }
  ).lean();

  return {
    title: "Táº¡o bÄƒng táº£i má»›i",
    error,
    cameras,
    operators,
    form: {
      conveyor_id: "",
      name: "",
      /*line_id: "",*/
      status: "ONLINE",
      operator_id: "",
      description: "",
      camera_id: "",
      camera_trigger_delay: 0,
      serial_port: "",
      baud_rate: 9600,
      ai_threshold: 30.436506,
      ...form,
    },
  };
};

export const index = async (req: Request, res: Response) => {
  try {
    const conveyors = await Conveyor.find({ is_active: true })
      .sort({ created_at: -1 })
      .lean();

    const operatorIds = conveyors
      .map((item: any) => item.operator_id)
      .filter(Boolean);

    const users = await User.find(
      {
        user_id: { $in: operatorIds },
      },
      {
        _id: 0,
        user_id: 1,
        fullname: 1,
      }
    ).lean();

    const userMap = new Map(
      users.map((u: any) => [u.user_id, u.fullname])
    );

    const conveyorList = conveyors.map((item: any) => ({
      ...item,
      operator_name: item.operator_id
        ? userMap.get(item.operator_id) || "-"
        : "-",
    }));

    return res.render("conveyors/index", {
      title: "Quáº£n lÃ½ bÄƒng táº£i",
      conveyors: conveyorList,
      success: req.query.created === "1" ? "Táº¡o bÄƒng táº£i thÃ nh cÃ´ng." : null,

    });
  } catch (error) {
    console.error("Load conveyors error:", error);

    return res.status(500).send("KhÃ´ng thá»ƒ táº£i danh sÃ¡ch bÄƒng táº£i.");
  }
};
export const create = async (req: Request, res: Response) => {
  try {
    return res.render("conveyors/create", await getCreateViewData());
  } catch (error) {
    console.error("Lá»—i: ", error);
    return res.status(500).send("KhÃ´ng thá»ƒ táº£i form táº¡o bÄƒng táº£i.");
  }
};
export const createPost = async (req: Request, res: Response) => {
  try {
    const {
      name,
      /*line_id,*/
      status,
      operator_id,
      description,

      camera_id,
      camera_trigger_delay,
      serial_port,
      baud_rate,
      ai_threshold,
    } = req.body;

    const conveyor_id = gen_conveyor_id()

    const existingConveyor = await Conveyor.findOne({
      conveyor_id,
    }).lean();

    if (!name) {
      return res.render(
        "conveyors/create",
        await getCreateViewData(req.body, "Vui lÃ²ng nháº­p Ä‘áº§y Ä‘á»§ thÃ´ng tin bÄƒng táº£i")
      );
    }
    if (existingConveyor) {
      return res.render(
        "conveyors/create",
        await getCreateViewData(req.body, "MÃ£ bÄƒng táº£i Ä‘Ã£ tá»“n táº¡i.")
      );
    }



    await Conveyor.create({
      conveyor_id,
      name: String(name).trim(),
      /*line_id: String(line_id).trim(),*/
      status: String(status || "ONLINE").toUpperCase(),
      operator_id: String(operator_id || "").trim(),
      description: String(description || "").trim(),
      is_active: true,
    });

    await ConveyorConfig.create({
      conveyor_id,
      camera_id: String(camera_id || "").trim().toUpperCase(),
      camera_trigger_delay: Number(camera_trigger_delay || 0),
      serial_port: String(serial_port || "").trim(),
      baud_rate: Number(baud_rate || 9600),
      ai_threshold: Number(ai_threshold || 30.436506),
    });

    await Config_log.create({
      config_log_id: `CFG_${Date.now()}`,
      conveyor_id,
      user_id: res.locals.user?.user_id || "UNKNOW",
      action: "CREATE_NEW",
      changes: {
        operator_id: {
          old: "",
          new: String(operator_id || "").trim(),
        }
      },
      message: String(description || "").trim() || "PhÃ¢n cÃ´ng ngÆ°á»i váº­n hÃ nh bÄƒng táº£i"
    })

    if (camera_id) {
      await Camera.updateOne(
        {
          camera_id,
        },
        {
          $set: {
            status: "IN_USE",
            conveyor_id,
          },
        }
      );
    }

    return res.redirect("/conveyors?created=1");
  } catch (error) {
    console.error("Lá»—i khá»Ÿi táº¡o:", error);

    return res.render(
      "conveyors/create",
      await getCreateViewData(req.body, "KhÃ´ng thá»ƒ táº¡o bÄƒng táº£i.")
    );
  }
};

export const deleteConveyor = async (
  req: Request,
  res: Response
) => {
  try {
    const conveyorId = String(req.params.conveyor_id || "")
      .trim()
      .toUpperCase();

    const config: any = await ConveyorConfig.findOne({
      conveyor_id: conveyorId,
    }).lean();

    if (config?.camera_id) {
      await Camera.updateOne(
        {
          camera_id: config.camera_id,
        },
        {
          $set: {
            status: "AVAILABLE",
            conveyor_id: "",
          },
        }
      );
    }

    await ConveyorConfig.deleteOne({
      conveyor_id: conveyorId,
    });

    await Conveyor.deleteOne({
      conveyor_id: conveyorId,
    });

    return res.redirect("/conveyors");
  } catch (error) {
    console.error("Lá»—i xÃ³a bÄƒng táº£i:", error);

    return res.status(500).send("KhÃ´ng thá»ƒ xÃ³a bÄƒng táº£i.");
  }
};
