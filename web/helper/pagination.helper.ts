import { Request, Response } from "express";
export const PaginationHelper = (req : Request, totalRecord: number, limit: number) => {
  const pagination: {
          totalPage?: number,
          limit: number,
          skip?: number
          page: number
      } = {
          limit: limit,
          page: 1
      }
      if(req.query.page && parseInt(`${req.query.page}`) >0) {
          pagination.page = parseInt(`${req.query.page}`);
      }
      pagination.totalPage = Math.ceil(totalRecord / pagination.limit);
      pagination.skip = (pagination.page - 1) * pagination.limit;

  return pagination;
}