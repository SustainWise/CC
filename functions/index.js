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


// Export the app
exports.app = functions.https.onRequest(app);