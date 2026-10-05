import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import verifyRoute from "./routes/verifyRoute.js";
import 'dotenv/config';

// Import route files
import registerRoutes from "./routes/register.js";
import loginRoutes from "./routes/login.js";
import fetchRoutes from "./routes/fetch.js";
import CertificateRoutes from "./routes/certificateRoutes.js";
import StudentRoutes from "./routes/student.js";
import issuerRoutes from "./routes/issuer.js"
import adminRoutes from "./routes/admin.js"
import changePasswordRoute from "./routes/forgetpassword.js"

const app = express();
const PORT = Number(process.env.PORT || 4000);
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/certifier";

// ------------------- MIDDLEWARE -------------------
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ------------------- DATABASE CONNECTION -------------------
// ------------------- ROUTES -------------------
app.use("",(req,res,next)=>{console.log("----------------------------------");next();}       );

app.use("/register", registerRoutes)
app.use("/login", loginRoutes)
app.use("/", fetchRoutes)
app.use("/certificates",CertificateRoutes)
app.use("/student",StudentRoutes)
app.use("/issuer",issuerRoutes)
app.use("/auth", verifyRoute)
app.use("/admin",adminRoutes)
app.use("/changepassword",changePasswordRoute)

// ------------------- START SERVER -------------------
const startServer = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected successfully");
    app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exitCode = 1;
  }
};

startServer();
