import mongoose from "mongoose";
import dns from "dns";

export const connect = async () => {
  try {
    if (process.env.DNS_SERVERS) {
      const dnsServers = process.env.DNS_SERVERS
        .split(",")
        .map((server) => server.trim())
        .filter(Boolean);
      dns.setServers(dnsServers);
    }

    const uri = process.env.DATABASE || process.env.MONGO_URI;
    if (!uri) throw new Error("Thiếu URI kết nối cơ sở dữ liệu trong biến môi trường.");
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8000),
      connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 8000),
      socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 20000),
    });
    console.log("Kết nối thành công đến cơ sở dữ liệu");
  } catch (error) {
    console.error("Kết nối thất bại đến cơ sở dữ liệu:", error);
  }
};
