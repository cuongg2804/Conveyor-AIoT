import mongoose from "mongoose";

export const connect = async () => {
  try {
    const uri = process.env.DATABASE || process.env.MONGO_URI;
    if (!uri) throw new Error("Missing DATABASE or MONGO_URI in .env");
    await mongoose.connect(uri);
    console.log("Connect successfully to database");
  } catch (error) {
    console.error("Connect fail to database:", error);
  }
};
