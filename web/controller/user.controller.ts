import { Request, Response } from "express";
import User from "../model/user.model";
import bcrypt from "bcryptjs";
import { error } from "node:console";
import { readSync } from "node:fs";
import { title } from "node:process";

const gen_user_id = () => {
    return "U_" + Math.random().toString(36).substr(2, 9);
}

const USERNAME_REGEX = /^[A-Za-z0-9_]{6,32}$/;

const PASSWORD_REGEX =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>/?])(?!.*\s).{8,32}$/;

const validateUsername = (username: string) => {
    return USERNAME_REGEX.test(username);
};

const validatePassword = (password: string) => {
    return PASSWORD_REGEX.test(password);
};
const validateFullname = (fullname: string) => {
    const FULLNAME_REGEX = /^[A-Za-zÀ-ỹ\s]+$/;
    return FULLNAME_REGEX.test(fullname);
}

export const index = async (req: Request, res: Response) => {
    try {
        const keyword = String(req.query.keyword || "").trim()
        const role = String(req.query.role || "").trim().toUpperCase()

        const filter: any  = {}
        if(["ADMIN", "USER"].includes(role)) {
            filter.role = role
        }

        if(keyword) {
            filter.$or = [
                { username: { $regex: keyword, $options: "i" } },
                { fullname: { $regex: keyword, $options: "i" } }
            ]
        }

        const user = await User.find(filter, {password: 0, token: 0})
            .sort({created_at: -1})
            .lean();
        return res.render("users/index", {
            title: "Quản lý người dùng",
            users: user,
            filters: {
                keyword, role
            }
        })
    } catch (error) {
        console.error("Lỗi: ", error)
        return res.status(500).send("Không thể tải danh sách người dùng.")
    }
}
export const create = async (req: Request, res: Response) => {
    return res.render("users/create", {
        title: "Tạo người dùng mới",
        error: null,
        form: {
            username: "",
            password: "",
            fullname: "",
            role: "USER"
        }
    });
}
export const createPost = async (req: Request, res: Response) => {
    try {
        const { username, password, fullname, role } = req.body;
        if(!username || !password) {
            return res.render("users/create", {
                title: "Tạo người dùng mới",
                error: "Username và password không được để trống",
                form: req.body
            });
        }
        const existed = await User.findOne({username: String(username).trim()}).lean();

        if(existed) {
            return res.render("users/create", {
                title: "Tạo người dùng mới",
                error: "Username đã tồn tại",
                form: req.body
            });
        }

        const normalizedUsername = String(username || "").trim();
        const normalizedPassword = String(password || "");
        const normalizedFullname = String(fullname || "").trim();
        if(!normalizedUsername || !normalizedPassword || !normalizedFullname) {
            return res.render("users/create", {
                title: "Tạo người dùng mới",
                error: "Vui lòng điền đầy đủ thông tin",
                form: req.body,
            });
        }
        if(!validateUsername(normalizedUsername)) {
            return res.render("users/create", {
                title: "Tạo người dùng mới",
                error: "Vui lòng đặt username từ 6-32 ký tự, chỉ bao gồm chữ cái, số và dấu gạch dưới",
                form: req.body,
            });
        }
        if(!validatePassword(normalizedPassword)) {
            return res.render("users/create", {
                title: "Tạo người dùng mới",
                error: "Vui lòng đặt password từ 8-32 ký tự, bao gồm ít nhất 1 chữ hoa, 1 chữ thường, 1 số và 1 ký tự đặc biệt",
                form: req.body,
            });
        }
        if(!validateFullname(normalizedFullname)) {
            return res.render("users/create", {
                title: "Tạo người dùng mới",
                error: "Vui lòng nhập họ tên hợp lệ (chỉ chứa chữ cái và khoảng trắng)",
                form: req.body
            });
        }

        const hashedPassword = await bcrypt.hash(String(password), 10);
        const normalizedRole = ["ADMIN", "USER"].includes(String(role).toUpperCase())
        ? String(role).toUpperCase()
        : "USER";
        await User.create({
            user_id: gen_user_id(),
            username: String(username).trim(),
            password: hashedPassword,
            fullname: String(fullname).trim(),
            role: normalizedRole,
            token: "",
            status: "OFFLINE"
        })
        return res.redirect("/users");
    } catch (error) {
        console.log("Lỗi tạo người dùng: ", error);
        return res.render("users/create", {
            title: "Tạo người dùng mới",
            error: "Đã có lỗi xảy ra, vui lòng thử lại",
            form: req.body
        });
    }
}
export const edit = async (req: Request, res: Response) => {
    const user = await User.findOne({user_id: req.params.user_id}, {password: 0, token: 0}).lean();
    if(!user){
        return res.status(404).send("Không tìm thấy người dùng.");
    }
    return res.render("users/edit", {
        title: "Cập nhật người dùng",
        user,
        error: null
    })
}
export const editPost = async (req: Request, res: Response) => {
    try {
        const { username, password, fullname, role } = req.body;
        const user_id = req.params.user_id;

        const currentUser = await User.findOne({ user_id }).lean();

        if (!currentUser) {
            return res.status(404).send("Không tìm thấy người dùng.");
        }

        const normalizedUsername = String(username || "").trim();
        const normalizedFullname = String(fullname || "").trim();
        const newPassword = String(password || "");
        const normalizedRole = ["ADMIN", "USER"].includes(String(role).toUpperCase())
            ? String(role).toUpperCase()
            : "USER";

        const renderEdit = (error: string) => {
            return res.render("users/edit", {
                title: "Cập nhật người dùng",
                error,
                user: {
                    ...currentUser,
                    username: normalizedUsername,
                    fullname: normalizedFullname,
                    role: normalizedRole,
                },
            });
        };

        if (!normalizedUsername || !normalizedFullname) {
            return renderEdit("Vui lòng nhập đầy đủ username và họ tên.");
        }

        if (!validateUsername(normalizedUsername)) {
            return renderEdit("Username phải từ 6-32 ký tự, chỉ gồm chữ cái không dấu, số hoặc dấu gạch dưới.");
        }

        if (!validateFullname(normalizedFullname)) {
            return renderEdit("Họ tên chỉ được chứa chữ cái và khoảng trắng, không được chứa số hoặc ký tự đặc biệt.");
        }

        const existed = await User.findOne({
            username: normalizedUsername,
            user_id: { $ne: user_id },
        }).lean();

        if (existed) {
            return renderEdit("Username đã tồn tại.");
        }

        const updateData: any = {
            username: normalizedUsername,
            fullname: normalizedFullname,
            role: normalizedRole,
        };

        if (newPassword.trim()) {
            if (!validatePassword(newPassword)) {
                return renderEdit("Password phải từ 8-32 ký tự, gồm chữ hoa, chữ thường, chữ số, ký tự đặc biệt và không chứa khoảng trắng.");
            }

            updateData.password = await bcrypt.hash(newPassword, 10);
        }

        await User.updateOne(
            { user_id },
            { $set: updateData }
        );

        return res.redirect("/users");
    } catch (error) {
        console.log("Lỗi cập nhật người dùng: ", error);
        return res.status(500).send("Không thể cập nhật người dùng, đã có lỗi xảy ra.");
    }
};
export const deleteUser = async (req: Request, res: Response) => {
    try{
        await User.deleteOne({user_id: req.params.user_id});
        return res.redirect("/users")
    } catch(error) {
        console.log("Lỗi xóa người dùng: ", error);
        return res.status(500).send("Không thể xóa người dùng, đã có lỗi xảy ra.");
    }

}