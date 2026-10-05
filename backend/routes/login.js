import express from "express";
import { admin, student, iss_verifier } from "../mongo.js";

const router = express.Router();

// ------------------- STUDENT LOGIN -------------------
router.post("/student", async (req, res) => {
  try {
    if (student.db.readyState !== 1) {
      return res.status(503).json({ message: "Database is unavailable. Please try again shortly." });
    }
    const { email, password } = req.body;
    const user = await student.findOne({ email });
    if (!user) return res.status(404).json({ message: "Student not found" });
    if (user.password !== password) return res.status(401).json({ message: "Incorrect password" });

    res.status(200).json({
      message: "Login successful",
      user: { name: user.name, id: user._id, email: user.email, role: "student" },
    });
  } catch (err) {
    console.error("Student login error:", err);
    res.status(500).json({ message: "Server error during student login" });
  }
});

// ------------------- ADMIN LOGIN -------------------
router.post("/admin", async (req, res) => {
  try {
    if (admin.db.readyState !== 1) {
      return res.status(503).json({ message: "Database is unavailable. Please try again shortly." });
    }
    const { email, password } = req.body;
    const user = await admin.findOne({ email });
    if (!user) return res.status(404).json({ message: "Admin not found" });
    if (user.password !== password) return res.status(401).json({ message: "Incorrect password" });

    res.status(200).json({
      message: "Login successful",
      user: { name: user.name, id: user._id, email: user.email, role: "admin" },
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ message: "Server error during admin login" });
  }
});

// ------------------- ISSUER LOGIN -------------------
router.post("/issuer", async (req, res) => {
  try {
    if (iss_verifier.db.readyState !== 1) {
      return res.status(503).json({ message: "Database is unavailable. Please try again shortly." });
    }
    const { email, password } = req.body;
    const user = await iss_verifier.findOne({ email });
    if (!user) return res.status(404).json({ message: "Issuer not found" });
    if (user.password !== password) return res.status(401).json({ message: "Incorrect password" });
    if (!user.adminApproved) {
      return res.status(401).json({ message: "Contact Admin to approve first" });
    }

    res.status(200).json({
      message: "Login successful",
      user: { name: user.issuerName, id: user._id, email: user.email, role: "issuer" },
    });
  } catch (err) {
    console.error("Issuer login error:", err);
    res.status(500).json({ message: "Server error during issuer login" });
  }
});

export default router;
