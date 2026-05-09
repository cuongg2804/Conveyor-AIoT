const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

require("dotenv").config();

const MONGO_URI = process.env.DATABASE;

const userSchema = new mongoose.Schema({
  user_id: String,
  username: String,
  password: String,
  fullname: String,
  role: String,
  token: String,
});

const User = mongoose.model("User", userSchema, "users");

async function main() {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log("MongoDB connected");

    const passwordHash = await bcrypt.hash("1", 10);

    await User.updateOne(
      { username: "admin" },
      {
        $set: {
          user_id: "U001",
          username: "admin",
          password: passwordHash,
          fullname: "Quản trị viên",
          role: "ADMIN",
          token: "",
        },
      },
      { upsert: true }
    );

    console.log("Created/updated user: admin / 1");
  } catch (error) {
    console.error("Create user error:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

main();