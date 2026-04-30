import mongoose from "mongoose";

export const connect = async () => {
  try {
    mongoose.connect(`${process.env.DATABASE}`)
    .then(() => 
      console.log("Ket noi thanh cong toi database")
    );
  } catch (error) {
    console.log("Ket noi database that bai");
  }
}
