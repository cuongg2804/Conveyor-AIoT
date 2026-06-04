import { Request, Response } from "express";
import User from "../model/user.model";


const conveyorStatuses = ["STARTING", "RUNNING", "STOPPING"];
export const logout = async (req: Request, res: Response) => {
  try {
    const currentUser = res.locals.user;
    const userId = currentUser?.user_id;
    const token = req.cookies?.token;

    if(!userId) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    const runningConveyors = await User.findOne({
       user_id: userId,
       status: {$in: conveyorStatuses},
       is_active: true, 
      }).lean()
    if(runningConveyors) {
      return res.redirect(`/inspection/${runningConveyors.conveyor_id}?error=logout_blocked`);
    }
    await User.updateOne({
      userId: userId
    },
    {
      $set: {
        token: "",
        status: "OFFLINE",
      }
    })
    res.clearCookie("token");
    res.clearCookie("connect.sid")
    return res.redirect("/login");
  } catch (error) {
    console.log("Lỗi logout: ", error);
    return res.redirect("/dashboard");
  }
};