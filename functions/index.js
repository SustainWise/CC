const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const { getWeek, startOfMonth, endOfMonth } = require('date-fns');
const { Timestamp } = require('firebase-admin/firestore');
const { Storage } = require("@google-cloud/storage");
const multer = require("multer");
const storage = new Storage();
const bucket = storage.bucket("gs://sustainwise-36776.firebasestorage.app"); 

admin.initializeApp({
    credential: admin.credential.applicationDefault()
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // Maksimal 5MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('Only JPG, JPEG, and PNG images are allowed.'));
        }
        cb(null, true);
    }
});

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

app.patch("/edit-user", authenticate, async (req, res) => {
    const { username, photo } = req.body;

    if (!username && !photo) {
        return res.status(400).send({
            error: "Bad Request",
            message: "At least one of username or photo must be provided.",
        });
    }

    try {
        const userId = req.user.uid;
        const userRef = db.collection("users").doc(userId);
        const updateData = {};

        if (username) {
            updateData.username = username;
        }

        if (photo) {
            // Decode Base64 image string
            const matches = photo.match(/^data:image\/([a-zA-Z]*);base64,([^\"]*)$/);
            if (!matches || matches.length !== 3) {
                return res.status(400).send({
                    error: "Bad Request",
                    message: "Invalid image data format",
                });
            }

            const imageBuffer = Buffer.from(matches[2], 'base64');

            // Generate a file name
            const fileName = `users/${userId}/profile-photo-${Date.now()}.jpg`;

            const blob = bucket.file(fileName);
            const blobStream = blob.createWriteStream({
                resumable: false,
            });

            blobStream.on("error", (err) => {
                console.error("Upload error:", err);
                return res.status(500).send({
                    error: "Internal Server Error",
                    message: `Failed to upload image. Error: ${JSON.stringify(err)}`,
                });
            });

            blobStream.on("finish", async () => {
                // Get public URL from Firebase Storage
                const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(blob.name)}?alt=media`;
                updateData.photo = publicUrl;

                // Update user data in Firestore
                await userRef.update(updateData);

                return res.status(200).send({
                    message: "User updated successfully",
                    updatedFields: updateData,
                });
            });

            // Upload file buffer
            blobStream.end(imageBuffer);
        } else {
            // Jika tidak ada photo, hanya update username
            await userRef.update(updateData);
            return res.status(200).send({
                message: "User updated successfully",
                updatedFields: updateData,
            });
        }
    } catch (error) {
        console.error("Error updating user:", error);
        return res.status(500).send({
            error: "Internal Server Error",
            message: error.message,
        });
    }
});

app.get("/user", authenticate, async (req, res) => {
    try {
        // Mengambil data pengguna dari Firebase Authentication
        const userRecord = await admin.auth().getUser(req.user.uid);

        // Mengambil data pengguna dari Firestore
        const userRef = db.collection("users").doc(req.user.uid);
        const userDoc = await userRef.get();

        // Jika pengguna tidak ditemukan di Firestore
        if (!userDoc.exists) {
            return res.status(404).send({
                error: "Not Found",
                message: "User data not found in Firestore.",
            });
        }

        // Mendapatkan data yang dibutuhkan
        const { username, photo } = userDoc.data();

        // Membuat response
        const userData = {
            email: userRecord.email, // Dari Firebase Authentication
            username: username || null, // Dari Firestore
            photo: photo || null, // Dari Firestore
        };

        return res.status(200).send(userData);
    } catch (error) {
        console.error("Error fetching user data:", error.message);
        res.status(500).send({
            error: "Internal Server Error",
            message: error.message,
        });
    }
});

app.post("/transaction", authenticate, async (req, res) => {
    const { type, category, amount, date } = req.body;

    if (!type || !category || !amount || !date) {
        return res.status(400).send("Bad Request: Missing required fields");
    }

    if (type !== "Income" && type !== "Outcome") {
        return res.status(400).send("Bad Request: Type must be 'Income' or 'Outcome'");
    }

    let transactionDate;
    try {
        transactionDate = new Date(date);
        if (isNaN(transactionDate.getTime())) {
            return res.status(400).send("Bad Request: Invalid date format");
        }
    } catch (error) {
        return res.status(400).send("Bad Request: Invalid date format");
    }

    try {
        // Referensi ke user dan saldo
        const userRef = db.collection("users").doc(req.user.uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send("User not found");
        }

        const currentSaldo = userDoc.data().saldo || 0;
        const transactionAmount = parseFloat(amount);

        // Hitung saldo baru
        const newSaldo = type === "Income"
            ? currentSaldo + transactionAmount
            : currentSaldo - transactionAmount;

        // Update saldo pengguna
        await userRef.update({ saldo: newSaldo });

        // Simpan transaksi ke subkoleksi berdasarkan type
        const transactionRef = db.collection("transactions")
            .doc(req.user.uid)
            .collection(type)
            .doc();

        await transactionRef.set({
            id: transactionRef.id,
            user_id: req.user.uid,
            type,
            category,
            amount: transactionAmount,
            date: transactionDate,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        return res.status(201).send({
            message: "Transaction added successfully",
            newSaldo,
        });
    } catch (error) {
        console.error("Error adding transaction:", error);
        return res.status(500).send("Error adding transaction: " + error.message);
    }
});

// Kurangi atau Tambahkan Saldo Saat Transaksi Dihapus
app.delete("/transaction/:type/:transactionId", authenticate, async (req, res) => {
    const { type, transactionId } = req.params;

    if (!["Income", "Outcome"].includes(type)) {
        return res.status(400).send("Bad Request: Type must be 'Income' or 'Outcome'");
    }

    try {
        // Referensi ke subkoleksi berdasarkan tipe
        const transactionRef = db
            .collection("transactions")
            .doc(req.user.uid)
            .collection(type)
            .doc(transactionId);

        const transactionDoc = await transactionRef.get();

        if (!transactionDoc.exists) {
            return res.status(404).send("Transaction not found");
        }

        const transactionData = transactionDoc.data();

        // Pastikan user hanya dapat menghapus transaksi miliknya
        if (transactionData.user_id !== req.user.uid) {
            return res.status(403).send("Forbidden: You are not authorized to delete this transaction");
        }

        // Referensi ke pengguna
        const userRef = db.collection("users").doc(req.user.uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send("User not found");
        }

        // Update saldo berdasarkan tipe transaksi
        const currentSaldo = userDoc.data().saldo || 0;
        const transactionAmount = parseFloat(transactionData.amount);

        const updatedSaldo =
            type === "Income"
                ? currentSaldo - transactionAmount // Kurangi saldo jika income dihapus
                : currentSaldo + transactionAmount; // Tambahkan saldo jika outcome dihapus

        // Perbarui saldo pengguna
        await userRef.update({ saldo: updatedSaldo });

        // Hapus transaksi
        await transactionRef.delete();

        return res.status(200).send({
            message: "Transaction deleted successfully",
            updatedSaldo,
        });
    } catch (error) {
        console.error("Error deleting transaction:", error);
        return res.status(500).send("Error deleting transaction: " + error.message);
    }
});


app.get("/transaction/weekly-expenses", authenticate, async (req, res) => {
    const { year, month } = req.query;

    if (!year || !month) {
        return res.status(400).send("Bad Request: Missing year or month");
    }

    try {
        const userRef = db.collection("users").doc(req.user.uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send("User not found");
        }

        const startDate = new Date(Date.UTC(year, month - 1, 1));  // Start of the month
        const endDate = new Date(Date.UTC(year, month, 0));        // End of the month

        const startTimestamp = Timestamp.fromDate(startDate);
        const endTimestamp = Timestamp.fromDate(endDate);

        // Query transactions from the user's "Outcome" sub-collection
        const transactionsRef = db.collection("transactions")
            .doc(req.user.uid) // Access user's sub-collection
            .collection("Outcome"); // Specify the "Outcome" sub-collection

        const querySnapshot = await transactionsRef
            .where("date", ">=", startTimestamp)
            .where("date", "<=", endTimestamp)
            .get();

        const weeklyExpenses = [];
        const maxWeeksInMonth = 4;

        querySnapshot.forEach((doc) => {
            const transaction = doc.data();
            const transactionDate = transaction.date.toDate();  // Convert Firestore Timestamp to JavaScript Date

            // Calculate week number within the month
            const weekNumber = Math.ceil((transactionDate.getDate()) / 7);
            const validWeekNumber = Math.min(weekNumber, maxWeeksInMonth);

            let week = weeklyExpenses.find((week) => week.week === validWeekNumber);
            if (!week) {
                week = { week: validWeekNumber, totalExpense: 0 };
                weeklyExpenses.push(week);
            }

            week.totalExpense += transaction.amount;
        });

        // Ensure all weeks are represented
        for (let i = 1; i <= maxWeeksInMonth; i++) {
            if (!weeklyExpenses.some(week => week.week === i)) {
                weeklyExpenses.push({ week: i, totalExpense: 0 });
            }
        }

        const formattedWeeks = weeklyExpenses.map(week => ({
            week: `Week ${week.week}`,
            totalExpense: week.totalExpense
        }));

        return res.status(200).send({
            message: "Weekly expenses retrieved successfully",
            weeklyExpenses: formattedWeeks,
        });
    } catch (error) {
        console.error("Error retrieving weekly expenses:", error);
        return res.status(500).send("Error retrieving weekly expenses: " + error.message);
    }
});


app.get("/statistics/outcome-by-category", authenticate, async (req, res) => {
    const { year, month } = req.query;

    if (!year || !month) {
        return res.status(400).send("Bad Request: Missing required fields (year, month).");
    }

    try {
        const startDate = new Date(Date.UTC(year, month - 1, 1)); // Start of the month
        const endDate = new Date(Date.UTC(year, month, 0)); // End of the month

        const transactionsQuery = db.collection("transactions")
            .doc(req.user.uid) // Access user's sub-collection
            .collection("Outcome") // Specify the "Outcome" sub-collection
            .where("date", ">=", startDate)
            .where("date", "<=", endDate);

        const snapshot = await transactionsQuery.get();

        if (snapshot.empty) {
            return res.status(404).send({ message: `No transactions found for ${year}-${month}.` });
        }

        let totalIncome = 0;
        let totalOutcome = 0;
        const categories = {};

        snapshot.docs.forEach(doc => {
            const transaction = doc.data();
            const amount = transaction.amount;
            const category = transaction.category || "Uncategorized"; // Default category

            if (transaction.type === "Income") {
                totalIncome += amount;
            } else if (transaction.type === "Outcome") {
                totalOutcome += amount;

                categories[category] = (categories[category] || 0) + amount;
            }
        });

        return res.status(200).send({
            message: `Outcome by Category statistics for ${year}-${month}`,
            totalOutcome,
            categories,
        });
    } catch (error) {
        console.error("Error fetching statistics:", error);
        return res.status(500).send({ error: "Internal Server Error", message: error.message });
    }
});

app.get("/statistics/income-vs-outcome", authenticate, async (req, res) => {
    const { year, month } = req.query;

    if (!year || !month) {
        return res.status(400).send("Bad Request: Missing required fields (year, month).");
    }

    try {
        const startDate = new Date(Date.UTC(year, month - 1, 1)); // Start of the month
        const endDate = new Date(Date.UTC(year, month, 0)); // End of the month

        // Query both Income and Outcome sub-collections for the user
        const incomeQuery = db.collection("transactions")
            .doc(req.user.uid)
            .collection("Income")
            .where("date", ">=", startDate)
            .where("date", "<=", endDate);

        const outcomeQuery = db.collection("transactions")
            .doc(req.user.uid)
            .collection("Outcome")
            .where("date", ">=", startDate)
            .where("date", "<=", endDate);

        // Fetch income transactions
        const incomeSnapshot = await incomeQuery.get();
        let totalIncome = 0;
        incomeSnapshot.docs.forEach(doc => {
            const transaction = doc.data();
            totalIncome += transaction.amount;
        });

        // Fetch outcome transactions
        const outcomeSnapshot = await outcomeQuery.get();
        let totalOutcome = 0;
        outcomeSnapshot.docs.forEach(doc => {
            const transaction = doc.data();
            totalOutcome += transaction.amount;
        });

        return res.status(200).send({
            message: `Income vs Outcome statistics for ${year}-${month}`,
            totalIncome,
            totalOutcome,
        });
    } catch (error) {
        console.error("Error fetching statistics:", error);
        return res.status(500).send({ error: "Internal Server Error", message: error.message });
    }
});


// riwayat per bulan
app.get("/transactions/monthly", authenticate, async (req, res) => {
    const { type, month, year } = req.query;

    if (!type || !month || !year) {
        return res.status(400).send("Bad Request: Missing required fields (type, month, year).");
    }

    try {
        const startDate = new Date(year, month - 1, 1); // Start of the month
        const endDate = new Date(year, month, 0); // End of the month (last day of the month)

        const transactions = [];

        // Function to query a user's transactions of a specific type within a date range
        const getTransactionsByType = async (transactionType) => {
            const transactionsQuery = db.collection("transactions")
                .doc(req.user.uid) // The user's sub-collection
                .collection(transactionType) // Sub-collection: "Income" or "Outcome"
                .where("date", ">=", startDate)
                .where("date", "<=", endDate);

            const snapshot = await transactionsQuery.get();
            snapshot.forEach(doc => {
                transactions.push({
                    id: doc.id,
                    ...doc.data(),
                    date: doc.data().date.toDate().toISOString(), // Convert date to ISO string
                });
            });
        };

        if (type === "All") {
            // Query both "Income" and "Outcome"
            await getTransactionsByType("Income");
            await getTransactionsByType("Outcome");
        } else {
            // Query for a specific type (Income or Outcome)
            await getTransactionsByType(type);
        }

        if (transactions.length === 0) {
            return res.status(404).send({ message: `No ${type} transactions found for ${month}-${year}.` });
        }

        return res.status(200).send({
            message: `${type === 'All' ? 'All' : type} transactions for ${month}-${year}`,
            transactions,
        });
    } catch (error) {
        console.error("Error fetching transactions:", error);
        return res.status(500).send({ error: "Internal Server Error", message: error.message });
    }
});

app.get("/transactions/latest", authenticate, async (req, res) => {
    try {
        // Query transactions for the user, order by created_at, and limit to 5 latest transactions
        const transactionsQuery = db.collection("transactions")
            .doc(req.user.uid) // The user's sub-collection
            .collection("Income") // Start with the "Income" sub-collection
            .orderBy("created_at", "desc")
            .limit(5);

        // Query for Outcome transactions as well
        const outcomeQuery = db.collection("transactions")
            .doc(req.user.uid) // The user's sub-collection
            .collection("Outcome") // Outcome sub-collection
            .orderBy("created_at", "desc")
            .limit(5);

        // Fetch both queries
        const [incomeSnapshot, outcomeSnapshot] = await Promise.all([
            transactionsQuery.get(),
            outcomeQuery.get(),
        ]);

        const transactions = [];

        // Process the "Income" transactions
        incomeSnapshot.forEach(doc => {
            const data = doc.data();
            let date = data.date;
            if (date instanceof admin.firestore.Timestamp) {
                date = date.toDate().toISOString();
            }

            let created_at = data.created_at;
            if (created_at instanceof admin.firestore.Timestamp) {
                created_at = created_at.toDate().toISOString();
            }

            transactions.push({
                id: doc.id,
                ...data,
                date,
                created_at,
            });
        });

        // Process the "Outcome" transactions
        outcomeSnapshot.forEach(doc => {
            const data = doc.data();
            let date = data.date;
            if (date instanceof admin.firestore.Timestamp) {
                date = date.toDate().toISOString();
            }

            let created_at = data.created_at;
            if (created_at instanceof admin.firestore.Timestamp) {
                created_at = created_at.toDate().toISOString();
            }

            transactions.push({
                id: doc.id,
                ...data,
                date,
                created_at,
            });
        });

        // Sort the transactions by created_at (in case some are from different collections)
        transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (transactions.length === 0) {
            return res.status(404).send({ message: "No transactions found" });
        }

        return res.status(200).send({
            message: "Latest 5 transactions retrieved successfully",
            transactions: transactions.slice(0, 5), // Limit to the 5 latest transactions
        });
    } catch (error) {
        console.error("Error fetching latest transactions:", error);
        return res.status(500).send({ error: "Internal Server Error", message: error.message });
    }
});

app.get("/saldo/monthly", authenticate, async (req, res) => {
    try {
        // Extract the month and year from query parameters
        const { month, year } = req.query;

        // Check if both month and year are provided
        if (!month || !year) {
            return res.status(400).send("Bad Request: Missing month or year parameter");
        }

        // Validate that the month is between 1 and 12
        if (isNaN(month) || month < 1 || month > 12) {
            return res.status(400).send("Bad Request: Invalid month value. It should be between 1 and 12.");
        }

        // Validate that the year is a valid number
        if (isNaN(year)) {
            return res.status(400).send("Bad Request: Invalid year value.");
        }

        // Query the saldo_checkpoint for the specific month and year
        const saldoCheckpointRef = db.collection("saldo_checkpoint")
            .doc(req.user.uid)
            .collection("monthly")
            .where("month", "==", parseInt(month)) // Filter by the specific month
            .where("year", "==", parseInt(year)) // Filter by the specified year
            .limit(1); // We only need one document, so limit to 1

        const snapshot = await saldoCheckpointRef.get();

        if (snapshot.empty) {
            return res.status(404).send({
                message: `No saldo checkpoint data found for ${month}/${year}`
            });
        }

        // Prepare the saldo data for response, returning only the necessary fields
        const saldoData = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                saldo_start_of_month: data.saldo_start_of_month,
                saldo_end_of_month: data.saldo_end_of_month
            };
        });

        return res.status(200).send({
            message: "Saldo data retrieved successfully",
            saldo: saldoData[0], // Since we limited to 1, we return the first item
        });
    } catch (error) {
        console.error("Error retrieving saldo data:", error);
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

// Register User - Tambahkan Saldo Awal
app.post("/register", async (req, res) => {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
        return res.status(400).send("All fields are required");
    }

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

        await db.collection("users").doc(userRecord.uid).set({
            username,
            email,
            saldo: 0, // Set saldo awal menjadi 0
            photo: null, // Set photo sebagai null
        });

        res.status(201).send("User registered successfully");
    } catch (error) {
        console.error("Error registering user:", error);
        res.status(500).send("Error registering user");
    }
});



app.get("/saldo", authenticate, async (req, res) => {
    try {
        // Referensi ke dokumen user berdasarkan UID
        const userRef = db.collection("users").doc(req.user.uid);
        const userDoc = await userRef.get();

        // Periksa apakah user ditemukan
        if (!userDoc.exists) {
            return res.status(404).send("User not found");
        }

        // Ambil saldo dari dokumen user
        const saldo = userDoc.data().saldo || 0;

        return res.status(200).send({
            message: "Saldo retrieved successfully",
            saldo,
        });
    } catch (error) {
        console.error("Error retrieving saldo:", error);
        return res.status(500).send("Error retrieving saldo: " + error.message);
    }
});




// Export the app
exports.app = functions.https.onRequest(app);