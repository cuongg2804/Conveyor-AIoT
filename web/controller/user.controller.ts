import { Request, Response } from "express";
import User, { normalizeUserRole } from "../model/user.model";
import bcrypt from "bcryptjs";

const gen_user_id = () => {
    return "U_" + Math.random().toString(36).substr(2, 9);
}

export const index = async (req: Request, res: Response) => {
    const user = await User.find({}, {password: 0, token: 0})
        .sort({created_at: -1})
        .lean();
    const users = user.map((item: any) => ({
        ...item,
        role: normalizeUserRole(item.role) || item.role,
    }));
    return res.render("users/index", {
        title: "Quản lý người dùng",
        users
    })
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
        const hashedPassword = await bcrypt.hash(String(password), 10);
        const normalizedRole = normalizeUserRole(role) || "USER";
        await User.create({
            user_id: gen_user_id(),
            username: String(username).trim(),
            password: hashedPassword,
            fullname: String(fullname).trim(),
            role: normalizedRole,
            token: ""
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
    const viewUser = {
        ...user,
        role: normalizeUserRole((user as any).role) || (user as any).role,
    };
    return res.render("users/edit", {
        title: "Cập nhật người dùng",
        user: viewUser,
        error: null
    })
}
export const editPost = async (req: Request, res: Response) => {
    try {
        const { username, password, fullname, role } = req.body;
        const normalizedRole = normalizeUserRole(role) || "USER";
        const updateData: any = {
            fullname: String(fullname || "").trim(),
            role : normalizedRole
        }
        if(String(password || "").trim()) {
            updateData.password = await bcrypt.hash(String(password), 10)
            updateData.token = ""
        }
        await User.updateOne (
            { user_id: req.params.user_id },
            { $set: updateData }
        )
        return res.redirect("/users");
    }
    catch (error) {
        console.log("Lỗi cập nhật người dùng: ", error);
        return res.status(500).send("Không thể cập nhật người dùng, đã có lỗi xảy ra.");
    }
}
export const deleteUser = async (req: Request, res: Response) => {
    try{
        await User.deleteOne({user_id: req.params.user_id});
        return res.redirect("/users")
    } catch(error) {
        console.log("Lỗi xóa người dùng: ", error);
        return res.status(500).send("Không thể xóa người dùng, đã có lỗi xảy ra.");
    }

}
