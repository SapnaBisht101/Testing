import mongoose from 'mongoose';

// --- ISSUER / VERIFIER SCHEMA ---
const IssuerSchema = new mongoose.Schema({
  issuerName: { type: String, required: true },
  issuerTitle: { type: String, required: true },
  institutionName: { type: String, required: true },
  institutionLogo: { type: String, default: null }, // Base64 string
  signatureImage: { type: String, default: null }, // Base64 string
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // issuer also needs password for login
  otp: String,
isVerified: { type: Boolean, default: false },
adminApproved:{type:Boolean,default:false}

  
});

// --- STUDENT SCHEMA ---
const StudentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  otp: String,
isVerified: { type: Boolean, default: false }

});

// --- ADMIN SCHEMA ---
const AdminSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  otp: String,
  isVerified: { type: Boolean, default: false }

});

// --- CERTIFICATE SCHEMA ---
const CertificateSchema = new mongoose.Schema({
  templateVersion: { type: String, default: "1.0" },
  qrCodeId: { type: String, required: true, unique: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  recipientName: { type: String, required: true },
  issuerId: { type: mongoose.Schema.Types.ObjectId, ref: 'IssuerVerifier', required: true },
  issuerName: { type: String },
  institutionName: { type: String },
  certificateTitle: { type: String, required: true },
  courseName: { type: String, required: true },
  certificateDescription: { type: String },
  completionDate: { type: Date, required: true },
  issuedAt: { type: Date, default: Date.now },
  qrImage:{type:String,required:true},
  certificateHash: { type: String, default: null }, // Jo hash blockchain pe bheja
  txHash: { type: String, default: null },          // Blockchain Transaction ID (Proof)
  isOnChain: { type: Boolean, default: false }, // blockchain pe hai ya nhi 
  status: {
    type: String,
    enum: ["active", "revoked"],
    default: "active",
  },
  revokedAt: { type: Date, default: null },
});


const reqSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        required: true
    },
    issuerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Issuer",
        required: true
    },
    message: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ["pending", "issued", "rejected"],
        default: "pending"
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});




// --- MODEL CREATION ---
const IssuerVerifier = mongoose.model('IssuerVerifier', IssuerSchema);
const Admin = mongoose.model('Admin', AdminSchema);
const Student = mongoose.model('Student', StudentSchema);
const Certificate = mongoose.model('Certificate', CertificateSchema);
const CertiRequest = mongoose.model('CertiRequest',reqSchema)

export { IssuerVerifier as iss_verifier, Student as student, Certificate as certificate, Admin as admin ,CertiRequest as certReq};
