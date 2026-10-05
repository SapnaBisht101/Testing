# CertiChain: Blockchain-Based Certificate Verification System

**CertiChain** is a hybrid certificate issuance and verification platform that combines the speed of **MongoDB** with the immutable security of **Ethereum Blockchain**. It prevents certificate forgery by storing a unique SHA-256 cryptographic fingerprint (hash) of each certificate on the blockchain.

---

##  Key Features

* **Immutable Proof:** Each certificate hash is locked onto the blockchain, making it impossible to alter or fake.
* **Hybrid Verification:** Performs a dual-check against MongoDB records and Blockchain state.
* **QR Code Integration:** Instant verification via QR scanning using `jsQR` and `Jimp`.
* **Data Integrity:** Implements SHA-256 hashing with data normalization to prevent false "Tampering" alerts.
* **Role-Based Access:** Managed access for Admins (Approvers), Issuers (Universities), and Students.
* **Disaster Recovery Ready:** Provision for IPFS CID storage for decentralized backup.

---

##  Tech Stack

* **Backend:** Node.js, Express.js
* **Database:** MongoDB (Mongoose ODM)
* **Blockchain:** Solidity, Hardhat, Ethers.js (v6)
* **Network:** Sepolia Testnet / Hardhat Local Node
* **Security:** SHA-256 Hashing, JWT Authentication, `onlyOwner` Smart Contract Modifiers.

---

##  System Architecture

1. **Issuance:** Issuer generates a certificate  System creates a SHA-256 hash:


2. **Blockchain Write:** The hash is sent to the Smart Contract's `issueCertificate` function.
3. **Storage:** Metadata is saved in MongoDB; Transaction Hash is linked to the record.
4. **Verification:** * Data is pulled from MongoDB via `populate('studentId')`.
* A fresh hash is generated from current data.
* The system compares the fresh hash with the hash stored on the Blockchain.



---

##  Setup & Installation

### 1. Blockchain Setup

```bash
cd blockchain
npm install
# Start local node
npx hardhat node
# Deploy contract
npx hardhat run scripts/deploy.js --network localhost

```

### 2. Backend Setup

1. Create a `.env` file in the `backend` folder:

```env
PORT=4000
MONGO_URI=your_mongodb_uri
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=your_account_0_private_key
CONTRACT_ADDRESS=deployed_contract_address

```

2. Start the server:

```bash
cd backend
npm install
npm run dev

```

---

##  Smart Contract Logic

The core logic resides in `CertificateRegistry.sol`:

* `mapping(string => CertData) certificates`: Stores data against a unique UUID.
* `issueCertificate()`: Restricted to the contract owner (Backend wallet).
* `getCertificate()`: Public function to fetch the on-chain proof.

---

##  Contribution

This project was developed as a Major Project to solve the problem of academic document fraud.

---
# Testing
