import mongoose from "mongoose";

export const connect = async () => {
  try {
    const uri = process.env.DATABASE || process.env.MONGO_URI;
    if (!uri) throw new Error("Thiếu URI kết nối cơ sở dữ liệu trong biến môi trường.");
    await mongoose.connect(uri);
    console.log("Kết nối thành công đến cơ sở dữ liệu");
  } catch (error) {
    console.error("Kết nối thất bại đến cơ sở dữ liệu: ", error);
    throw error;
  }
};
