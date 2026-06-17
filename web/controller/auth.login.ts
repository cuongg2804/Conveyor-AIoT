import { Request, Response } from "express";
import User from "../model/user.model";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { error } from "node:console";

export const login = async (req: Request, res: Response) => {
    return res.render("auth/login", {
        title: "Đăng nhập hệ thống",
        error: null
    })
}

const parseDeviceIdFromToken = (token?: string) => {
  const raw = String(token || "").trim();

  if (!raw.includes(".")) return "";

  return raw.split(".")[0];
};

const createDeviceToken = (deviceId: string) => {
  return `${deviceId}.${crypto.randomBytes(32).toString("hex")}`;
};
export const loginPost = async (req: Request, res: Response) => {
    try {
        const { username, password, device_id } = req.body;
        const deviceId = String(device_id || "").trim();
        if(!username || !password) {
        return res.render("auth/login", {
                title: "Đăng nhập hệ thống",
                error: "Vui lòng nhập đầy đủ thông tin đăng nhập."
            })
        }
        const user = await User.findOne({
            username: String(username).trim(),
        }).lean<any>();
        if (!user) {
            return res.render("auth/login", {
                title: "Đăng nhập hệ thống",
                error: "Tài khoản không tồn tại.",
            });
        }
        const pwd_ok = await bcrypt.compare(password, user.password);
        if (!pwd_ok) {
            return res.render("auth/login", {
                title: "Đăng nhập hệ thống",
                error: "Mật khẩu không chính xác.",
            });
        }
        if (!deviceId) {
            return res.render("auth/login", {
                title: "Đăng nhập hệ thống",
                error: "Không xác định được thiết bị đăng nhập.",
            });
        }
        const oldToken = String(user.token || "").trim();
        const activeDeviceId = parseDeviceIdFromToken(oldToken);
        const isOnline = String(user.status || "").toUpperCase() === "ONLINE";

        if (isOnline && oldToken && activeDeviceId && activeDeviceId !== deviceId) {
            return res.render("auth/login", {
                title: "Đăng nhập hệ thống",
                error: "Tài khoản này đang được đăng nhập trên một thiết bị khác.",
            });
        }
        const token = createDeviceToken(deviceId);
        await User.updateOne(
            { user_id: user.user_id },
            {
                $set: {
                token,
                status: "ONLINE",
                },
            }
        );
        res.cookie("token", token, {
           httpOnly: true, // chỉ cho phép cookie được truy cập qua HTTP(S)
            sameSite: "lax", // lax để cho phép gửi cookie trong các yêu cầu cùng nguồn và một số yêu cầu khác nguồn (như khi người dùng nhấp vào liên kết từ trang khác)
            maxAge: 24 * 60 * 60 * 1000 // 1 ngày = 24 giờ * 60 phút * 60 giây * 1000 ms
        })
        return res.redirect("/dashboard");
    }
    catch(error: any) {
        console.log("Đăng nhập không thành công: ", error);
        return res.render("auth/login",{
            title: "Đăng nhập hệ thống",
            error: "Đăng nhập không thành công. Vui lòng thử lại!"
        })
    }
}