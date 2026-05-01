import mongoose from "mongoose";

export const connect = async () => {
  try {
    const uri = process.env.DATABASE;
    if (!uri) throw new Error("Missing DATABASE in .env");
    await mongoose.connect(uri);
    console.log("Connect successfully to database");
  } catch (error) {
    console.error("Connect fail to database:", error);
  }
};
