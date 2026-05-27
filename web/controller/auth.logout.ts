import { Request, Response } from "express";
import User from "../model/user.model";

export const logout = async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.token;

    if (token) {
      await User.updateOne(
        { token },
        {
          $set: {
            token: "",
            status: "OFFLINE",
          },
        }
      );
    }

    res.clearCookie("token");
    return res.redirect("/login");
  } catch (error) {
    console.log("Lỗi logout: ", error);

    res.clearCookie("token");
    return res.redirect("/login");
  }
};