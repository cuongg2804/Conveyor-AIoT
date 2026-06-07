import { Request, Response } from "express";
import User from "../model/user.model";
import Conveyor from "../model/conveyor.model";

const RUNNING_STATUSES = ["STARTING", "RUNNING", "STOPPING"];

export const logout = async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.token;
    const currentUser =
      res.locals.user ||
      (token ? await User.findOne({ token }, { password: 0 }).lean<any>() : null);

    const userId = currentUser?.user_id;

    if (userId) {
      const runningConveyor = await Conveyor.findOne({
        user_id: userId,
        status: { $in: RUNNING_STATUSES },
        is_active: true,
      }).lean<any>();

      if (runningConveyor) {
        return res.redirect(
          `/inspection/monitor/${runningConveyor.conveyor_id}?error=logout_blocked`
        );
      }
    }

    if (token || userId) {
      await User.updateOne(
        {
          $or: [
            ...(token ? [{ token }] : []),
            ...(userId ? [{ user_id: userId }] : []),
          ],
        },
        {
          $set: {
            token: "",
            status: "OFFLINE",
          },
        }
      );
    }

    res.clearCookie("token", {
      httpOnly: true,
      sameSite: "lax",
    });

    return res.redirect("/login");
  } catch (error) {
    console.error("Logout error:", error);

    res.clearCookie("token", {
      httpOnly: true,
      sameSite: "lax",
    });

    return res.redirect("/login");
  }
};