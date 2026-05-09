import { Request, Response, NextFunction } from "express";
import User from "../model/user.model";

export const requireAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const token = req.cookies?.token;

        if(!token) {
            return res.redirect("/login");
        }
        const user = await User.findOne({token});
        if(!user) {
            res.clearCookie("token");
            return res.redirect("/login");
        }
        (res.locals as any).user = user;
        (req as any).user = user;
        return next();
    }
    catch(error){
        console.log("Lỗi xác thực: ", error);
        return res.redirect("/login");
    }
}
export const requireRole = (...role: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user

        if(!user || !role.includes(user.role)) {
            return res.status(403).send("Access denied");
        }
        return next();
    }
}
   