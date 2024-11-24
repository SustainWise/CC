const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp({
    credential: admin.credential.applicationDefault(), 
});

const express = require("express");
const cors = require("cors");

// Main App
const app = express();
app.use(cors({ origin: true }));
const db = admin.firestore();


// token untuk firebase Auth
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send("Unauthorized: No token provided");
    }

    const idToken = authHeader.split("Bearer ")[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken; 
        next();
    } catch (error) {
        return res.status(401).send("Unauthorized: Invalid token");
    }
};

// Add Transaction
app.post("/transaction", authenticate, async (req, res) => {
    const { type, category, amount, note, date } = req.body;

    if (!type || !category || !amount || !note || !date) {
        return res.status(400).send("Bad Request: Missing required fields");
    }

    try {
        const categoryRef = db.collection("categories").doc(category);
        const categoryDoc = await categoryRef.get();

        if (!categoryDoc.exists) {
            return res.status(400).send("Bad Request: Invalid category");
        }

        const newTransaction = {
            user_id: req.user.uid, 
            type,                   
            category,              
            amount: parseFloat(amount),  
            note,                  
            date: new Date(date),  
        };

        await db.collection("transactions").add(newTransaction);
        return res.status(201).send({ message: "Transaction added successfully", newTransaction });
    } catch (error) {
        return res.status(500).send("Error adding transaction: " + error.message);
    }
});


// Edit Transaction
app.put("/transaction/:transactionId", authenticate, async (req, res) => {
    const { transactionId } = req.params;
    const { type, category, amount, note, date } = req.body;

    if (!type || !category || !amount || !note || !date) {
        return res.status(400).send("Bad Request: Missing required fields");
    }

    try {
        const categoryRef = db.collection("categories").doc(category);
        const categoryDoc = await categoryRef.get();

        if (!categoryDoc.exists) {
            return res.status(400).send("Bad Request: Invalid category");
        }

        const transactionRef = db.collection("transactions").doc(transactionId);
        const transactionDoc = await transactionRef.get();

        if (!transactionDoc.exists) {
            return res.status(404).send("Transaction not found");
        }

        if (transactionDoc.data().user_id !== req.user.uid) {
            return res.status(403).send("Forbidden: You are not authorized to edit this transaction");
        }

        const updatedTransaction = {
            type,
            category,
            amount: parseFloat(amount),
            note,
            date: new Date(date),
        };

        await transactionRef.update(updatedTransaction);
        return res.status(200).send({ message: "Transaction updated successfully", updatedTransaction });
    } catch (error) {
        return res.status(500).send("Error updating transaction: " + error.message);
    }
});


// Delete Transaction
app.delete("/transaction/:transactionId", authenticate, async (req, res) => {
    const { transactionId } = req.params;

    try {
        const transactionRef = db.collection("transactions").doc(transactionId);
        const transactionDoc = await transactionRef.get();

        if (!transactionDoc.exists) {
            return res.status(404).send("Transaction not found");
        }

        if (transactionDoc.data().user_id !== req.user.uid) {
            return res.status(403).send("Forbidden: You are not authorized to delete this transaction");
        }

        await transactionRef.delete();
        return res.status(200).send({ message: "Transaction deleted successfully" });
    } catch (error) {
        return res.status(500).send("Error deleting transaction: " + error.message);
    }
});


// edit user
app.patch("/edit-user", authenticate, async (req, res) => {
    const { username, phone } = req.body;

    if (!username && !phone) {
        return res.status(400).send({
            error: "Bad Request",
            message: "At least one of username or phone must be provided."
        });
    }

    try {
        const userId = req.user.uid; 
        const userRef = db.collection("users").doc(userId);

        const updateData = {};
        if (username) updateData.username = username;
        if (phone) updateData.phone = phone;

        await userRef.update(updateData);

        return res.status(200).send({
            message: "User updated successfully",
            updatedFields: updateData,
        });
    } catch (error) {
        console.error("Error updating user:", error);
        return res.status(500).send({
            error: "Internal Server Error",
            message: error.message,
        });
    }
});

// riwayat per bulan
app.get("/transactions/monthly", authenticate, async (req, res) => {
    const { type, month, year } = req.query;

    if (!type || !month || !year) {
        return res.status(400).send("Bad Request: Missing required fields (type, month, year).");
    }

    try {
        const startDate = new Date(year, month - 1, 1);  
        const endDate = new Date(year, month, 0);        

        const transactionsQuery = db.collection("transactions")
            .where("user_id", "==", req.user.uid)  
            .where("type", "==", type)              
            .where("date", ">=", startDate)        
            .where("date", "<=", endDate);         

        const snapshot = await transactionsQuery.get();

        if (snapshot.empty) {
            return res.status(404).send({ message: `No ${type} transactions found for ${month}-${year}.` });
        }

        const transactions = snapshot.docs.map(doc => doc.data());

        return res.status(200).send({ message: `${type} transactions for ${month}-${year}`, transactions });
    } catch (error) {
        console.error("Error fetching transactions:", error);
        return res.status(500).send({ error: "Internal Server Error", message: error.message });
    }
});

// Add a new category
app.post("/category", async (req, res) => {
    const { name, defaultCategory } = req.body;

    if (!name) {
        return res.status(400).send("Bad Request: Missing required fields");
    }

    try {
        const newCategory = {
            name,
            default: defaultCategory || false, 
        };

        await db.collection("categories").doc(name).set(newCategory);
        return res.status(201).send({ message: "Category added successfully", newCategory });
    } catch (error) {
        return res.status(500).send("Error adding category: " + error.message);
    }
});

// Login Register

app.post("/register", async (req, res) => {
    const { email, password, username, phone } = req.body;

    if (!email || !password || !username || !phone) {
        return res.status(400).send("All fields are required");
    }

    // Validasi format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).send("Gunakan valid email");
    }

    try {
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: username,
        });

        // Simpan data pengguna tambahan ke Firestore
        await db.collection("users").doc(userRecord.uid).set({
            username,
            email,
            phone,
            saldo: "",
        });

        res.status(201).send("User registered successfully");
    } catch (error) {
        console.error("Error registering user:", error);
        res.status(500).send("Gunakan valid email");
    }
});


app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send("Email and password are required");
    }

    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        const user = await admin.auth().verifyPassword(email, password);

        // Generate custom token untuk aplikasi Anda
        const customToken = await admin.auth().createCustomToken(userRecord.uid);
        res.status(200).send({ token: customToken });
    } catch (error) {
        console.error("Error logging in with email and password:", error.message);
        res.status(401).send("Invalid email or password");
    }
});

app.post("/register-google", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).send({
            success: false,
            message: "Email is required",
        });
    }

    // Validasi format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).send({
            success: false,
            message: "Gunakan valid email",
        });
    }

    try {
        // Periksa apakah pengguna sudah ada
        const existingUser = await admin.auth().getUserByEmail(email);

        return res.status(200).send({
            success: true,
            message: "User already exists. Proceed to login.",
            user: {
                uid: existingUser.uid,
                email: existingUser.email,
            },
        });
    } catch (error) {
        if (error.code === "auth/user-not-found") {
            try {
                // Buat pengguna baru jika tidak ditemukan
                const newUser = await admin.auth().createUser({
                    email: email,
                });

                // Tambahkan data pengguna ke Firestore
                await db.collection("users").doc(newUser.uid).set({
                    email: newUser.email,
                    username: "", // Kosongkan username
                    phone: "",
                    saldo: "",   // Kosongkan phone
                });

                return res.status(201).send({
                    success: true,
                    message: "User registered successfully",
                    user: {
                        uid: newUser.uid,
                        email: newUser.email,
                    },
                });
            } catch (createError) {
                console.error("Error creating new user:", createError.message);
                return res.status(500).send({
                    success: false,
                    message: "Gunakan valid email",
                });
            }
        }

        console.error("Error registering user with Google:", error.message);
        return res.status(500).send({
            success: false,
            message: "Gunakan valid email",
        });
    }
});

// Endpoint untuk login menggunakan Google ID Token
app.post("/login-google", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).send({
            success: false,
            message: "Email is required",
        });
    }

    try {
        // Periksa apakah pengguna sudah ada
        const userRecord = await admin.auth().getUserByEmail(email);
        // Buat token khusus untuk pengguna
        const customToken = await admin.auth().createCustomToken(userRecord.uid);

        return res.status(200).send({
            success: true,
            message: "Login successful",
            token: customToken,
            user: {
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName,
            },
        });
    } catch (error) {
        console.error("Error during Google login:", error.code, error.message, error);

        if (error.code === "auth/user-not-found") {
            return res.status(404).send({
                success: false,
                message: "User not found. Please register first.",
            });
        }

        if (error.code === "auth/invalid-email") {
            return res.status(400).send({
                success: false,
                message: "Invalid email format.",
            });
        }

        return res.status(500).send({
            success: false,
            message: "An error occurred during login",
        });
    }
});



// Endpoint untuk mendapatkan data pengguna setelah login
app.get("/user", authenticate, async (req, res) => {
    try {
        const userRecord = await admin.auth().getUser(req.user.uid);
        res.status(200).send(userRecord);
    } catch (error) {
        console.error("Error fetching user data:", error.message);
        res.status(500).send("Error fetching user data");
    }
});

// Export the app
exports.app = functions.https.onRequest(app);