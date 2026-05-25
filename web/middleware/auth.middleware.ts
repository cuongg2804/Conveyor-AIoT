import { Request, Response, NextFunction } from "express";
import User, { normalizeUserRole } from "../model/user.model";

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
        const authUser = user.toObject();
        (authUser as any).role = normalizeUserRole(authUser.role);
        (res.locals as any).user = authUser;
        (req as any).user = authUser;
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
        const allowedRoles = role.map(normalizeUserRole).filter(Boolean);
        const userRole = normalizeUserRole(user?.role);

        if(!user || !allowedRoles.includes(userRole)) {
            return res.status(403).send("Access denied");
        }
        return next();
    }
}
