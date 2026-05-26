import { Request, Response } from "express";
import Config_log from "../model/config_logs.model";
import Control_log from "../model/control_logs.model";
import Conveyor from "../model/conveyor.model";
import User from "../model/user.model";

const dayRange = (dateValue: string) => {
    const start = new Date(`${dateValue}T00:00:00`).getTime()
    const end = new Date(`${dateValue}T23:59:59.999`).getTime()

    return {start, end}
}
export const index = async (req: Request, res: Response) => {
    try {
        const tab = String(req.query.tab || "control")
        const date = String(req.query.date || "")
        const conveyor_id = String(req.query.conveyor_id || "").trim().toUpperCase()

        const filter : any = {}

        if(date) {
            const {start, end} = dayRange(date)
            filter.created_at = {
                $gte: new Date(start),
                $lte: new Date(end),
            }
        }

        if(conveyor_id) {
            filter.conveyor_id = conveyor_id
        }

        const conveyors = await Conveyor.find({},{
            _id: 0, conveyor_id: 1,name: 1
        } 
        ).lean()

        const controlLogs = tab === "control" ? await Control_log.find(filter).sort({created_at: -1}).lean() : []
        const configLogs = tab === "config" ? await Config_log.find(filter).sort({created_at: -1}).lean() : []

        const logsForMap = tab === "control"
            ? controlLogs
            : configLogs;

        const user_ids = logsForMap
            .map((item: any) => item.user_id)
            .filter(Boolean);

        const conveyor_ids = logsForMap
            .map((item: any) => item.conveyor_id)
            .filter(Boolean);

        const users_log = await User.find(
            { user_id:  {$in: user_ids}},
            { _id: 0, user_id: 1, username: 1, fullname: 1}
        ).lean()
        const conveyors_log = await Conveyor.find(
            { conveyor_id:  {$in: conveyor_ids}},
            { _id: 0, conveyor_id: 1, name: 1}
        ).lean()

        const userMap = new Map(
            users_log.map((u: any) => [u.user_id, u.fullname || u.username])
        )
        const conveyorMap = new Map(
            conveyors_log.map((c: any) => [c.conveyor_id, c.name])
        )

        const list = (items: any[]) =>
            items.map((item: any) => ({
                ...item,
                user_name: item.user_id
                ? userMap.get(item.user_id) || item.user_id
                : "-",
                conveyor_name: item.conveyor_id
                ? conveyorMap.get(item.conveyor_id) || item.conveyor_id
                : "-",
            }));

        const controlLog_list = list(controlLogs)
        const configLog_list = list(configLogs)

        return res.render("logs/index", {
            title: "Nhật ký hệ thống",
            tab,
            controlLogs: controlLog_list,
            configLogs: configLog_list,
            conveyors,
            filters: {
                date,
                conveyor_id: conveyor_id,
            },
        })
    } catch (error) {
        console.error("Lỗi: ", error)
        return res.status(500).send("Không thể tải nhật ký hệ thống")
    }
}