const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const cookieParser = require("cookie-parser");

// Creating an Express application instance
const app = express();
const PORT = 3000;
const JWT_SECRET = "yourSecretKey"; // Replace with your actual secret key

// Create a pool for PostgreSQL connection
const pool = new Pool({
  connectionString:
    "postgresql://neondb_owner:1pjJ8WdUngSV@ep-small-brook-a5vpxef3.us-east-2.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }, // Ensure this is set to true in production
});

// Middleware to parse JSON bodies
// app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(cookieParser()); // This should be set before your routes

// Middleware for JWT validation
const verifyToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = decoded;
    next();
  });
};

app.get("/login", (req, res) => {
  const filePath = path.join(__dirname, "..", "public", "login.html");
  res.sendFile(filePath);
});

app.get("/register", (req, res) => {
  const filePath = path.join(__dirname, "..", "public", "register.html");
  res.sendFile(filePath);
});

app.get("/dashboard", (req, res) => {
  const filePath = path.join(__dirname, "..", "public", "dashboard.html");
  res.sendFile(filePath);
});

app.get("/js/dashboard", (req, res) => {
  const filePath = path.join(__dirname, "..", "server", "dashboard.js");
  res.sendFile(filePath);
});

app.get("/history", (req, res) => {
  const filePath = path.join(
    __dirname,
    "..",
    "public",
    "bankTransactionsHistory.html",
  );
  res.sendFile(filePath);
});

app.get("/js/history", (req, res) => {
  const filePath = path.join(__dirname, "..", "server", "bankTransactionsHistory.js");
  res.sendFile(filePath);
});

app.get("/api/user/connections", async (req, res) => {
  let client;

  try {
    // Check for the token in cookies
    const token = await req.cookies.token;
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Verify and decode the JWT token
    const decoded = jwt.verify(token, JWT_SECRET); // Use your JWT_SECRET
    const userEmail = decoded.email; // Assume the email was encoded in the token

    client = await pool.connect();

    // Get the user ID using the email from the decoded token
    const userResult = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [userEmail],
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Fetch all connection records for the user
    const connectionsResult = await client.query(
      "SELECT access_date, access_time, ip_address FROM ip WHERE user_id = $1 ORDER BY access_date DESC, access_time DESC",
      [user.id],
    );

    const connections = connectionsResult.rows;

    // Send the connections data back as the response
    res.status(200).json({ connections });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    // Release the client back to the pool if it's defined
    if (client) {
      client.release();
    }
  }
});

app.get("/transactions", (req, res) => {
  const filePath = path.join(
    __dirname,
    "..",
    "public",
    "addBankTransaction.html",
  );
  res.sendFile(filePath);
});

app.get("/profile", (req, res) => {
  const filePath = path.join(__dirname, "..", "public", "userProfile.html");
  res.sendFile(filePath);
});

app.get("/add", (req, res) => {
  const filePath = path.join(__dirname, "..", "public", "addBankAccount.html");
  res.sendFile(filePath);
});

// Route to register a new user with the "nom" field first
app.post("/api/register", async (req, res) => {
  const { nom, email, password } = req.body; // Accepting "nom", "email", and "password"

  console.log(nom, email, password);

  let client;

  try {
    // Use the connection pool for querying
    client = await pool.connect();

    // Check if the email already exists
    const result = await client.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (result.rows.length > 0) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new user into the database, including "nom"
    const userResult = await client.query(
      "INSERT INTO users (nom, email, password) VALUES ($1, $2, $3) RETURNING id",
      [nom, email, hashedPassword],
    );

    const userId = userResult.rows[0].id; // Get the new user's id

    // Get the user's IP address
    const ipAddress = req.headers["x-forwarded-for"] || req.ip; // Use 'x-forwarded-for' for proxy support
    const currentDate = new Date();

    // Insert the IP record for this user
    await client.query(
      "INSERT INTO ip (user_id, access_date, access_time, ip_address) VALUES ($1, $2, $3, $4)",
      [
        userId,
        currentDate.toISOString().split("T")[0], // Get the current date in 'YYYY-MM-DD' format
        currentDate.toISOString().split("T")[1].split(".")[0], // Get the current time in 'HH:MM:SS' format
        ipAddress,
      ],
    );

    // Generate JWT token
    const token = jwt.sign({ email: email }, JWT_SECRET, { expiresIn: "1h" });

    // Set cookie
    res.cookie("token", token, { httpOnly: true });

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    // Release the client back to the pool if it's defined
    if (client) {
      client.release();
    }
  }
});

// Route to authenticate and log in a user
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  let client;

  try {
    client = await pool.connect();

    // Check if the email exists
    const result = await client.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const user = result.rows[0];

    if (!user) {
      console.log("User not found");
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check if the password matches
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Log the IP address, date, and time of login
    const ipAddress = req.headers["x-forwarded-for"] || req.ip; // Use 'x-forwarded-for' for proxy support
    const currentDate = new Date();

    // Insert the IP record for this user
    await client.query(
      "INSERT INTO ip (user_id, access_date, access_time, ip_address) VALUES ($1, $2, $3, $4)",
      [
        user.id,
        currentDate.toISOString().split("T")[0], // Current date in 'YYYY-MM-DD' format
        currentDate.toISOString().split("T")[1].split(".")[0], // Current time in 'HH:MM:SS' format
        ipAddress,
      ],
    );

    // Generate JWT token
    const token = jwt.sign({ email: user.email }, JWT_SECRET, {
      expiresIn: "1h",
    });

    // Set cookie with the token
    res.cookie("token", token, { httpOnly: true });

    res.status(200).json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    // Release the client back to the pool if it's defined
    if (client) {
      client.release();
    }
  }
});

app.get("/api/logout", (req, res) => {
  // Clear the "token" cookie by setting it to an empty value and an expired date
  res.clearCookie("token", { httpOnly: true, sameSite: "Strict" });

  res.status(200).json({ message: "User logged out successfully" });
});

// Protected route to get user details
app.get("/api/user", verifyToken, async (req, res) => {
  let client; // Declare the client variable

  try {
    client = await pool.connect();

    // Fetch user details using the decoded token
    const result = await client.query("SELECT * FROM users WHERE email = $1", [
      req.user.email,
    ]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.status(200).json({ email: user.email });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    // Release the client back to the pool if it's defined
    if (client) {
      client.release();
    }
  }
});

// Default route
app.get("/", (req, res) => {
  res.send("Welcome to my User Registration and Login API!");
});

// ###########

// Middleware to get user from JWT token in cookies
// Middleware to get user from JWT token in cookies
async function getUserFromToken(req, res, next) {
  const token = req.cookies.token; // Get token from cookies
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userEmail = decoded.email; // Get user email from decoded token
    console.log("Decoded token:", decoded); // Debugging line
    console.log("User email:", userEmail); // Debugging line

    const client = await pool.connect();
    const userResult = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [userEmail],
    );
    const user = userResult.rows[0];
    client.release();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    req.userId = user.id; // Attach userId to the request
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// New Route: Get all transactions for an account as CSV
app.get("/api/transaction/csv", getUserFromToken, async (req, res) => {
  const userId = req.userId;

  console.log("Accounts result:", userId); // Debugging line

  try {
    const client = await pool.connect();

    // Query to find all accounts belonging to the user
    const accountsResult = await client.query(
      "SELECT id FROM accounts WHERE userId = $1",
      [userId],
    );

    console.log("Accounts result:", userId); // Debugging line

    // If no accounts are found for the user, return an error
    if (accountsResult.rows.length === 0) {
      return res.status(404).json({ error: "No accounts found for this user" });
    }

    // Extract all account IDs
    const accountIds = accountsResult.rows.map((account) => account.id);

    // Query to find all transactions related to the user's accounts
    const transactionsResult = await client.query(
      "SELECT t.id, t.type, t.amount, t.balance, t.accountId " +
        "FROM transactions t " +
        "WHERE t.accountId = ANY($1)",
      [accountIds],
    );
    client.release();

    const transactions = transactionsResult.rows;

    if (transactions.length === 0) {
      return res
        .status(404)
        .json({ error: "No transactions found for the user" });
    }

    // Convert the data to CSV format using PapaParse
    const csv = Papa.unparse(transactions);

    // Set headers to indicate the response is CSV
    res.header("Content-Type", "text/csv");
    res.attachment("transactions.csv"); // Optional: Set the filename for download
    res.send(csv); // Send the CSV content as the response
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// API to add a new account
app.post("/api/account/add", getUserFromToken, async (req, res) => {
  const { name, type, lowSale, balance } = req.body;
  const userId = req.userId;

  if (!name || !type || lowSale === undefined || balance === undefined) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const client = await pool.connect();
    const result = await client.query(
      "INSERT INTO accounts (name, type, lowSale, balance, userId) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, type, lowSale, balance, userId],
    );
    client.release();

    const newAccount = result.rows[0];
    return res
      .status(201)
      .json({ message: "Account created successfully", account: newAccount });
  } catch (error) {
    return res.status(500).json({ error: "Failed to create account" });
  }
});

// API to remove an account
app.post("/api/account/remove", getUserFromToken, async (req, res) => {
  const { accountId } = req.body;
  const userId = req.userId;

  if (!accountId) {
    return res.status(400).json({ error: "Missing account ID" });
  }

  try {
    const client = await pool.connect();
    const result = await client.query(
      "DELETE FROM accounts WHERE id = $1 AND userId = $2 RETURNING *",
      [accountId, userId],
    );
    client.release();

    const deletedAccount = result.rows[0];
    if (!deletedAccount) {
      return res
        .status(404)
        .json({ error: "Account not found or does not belong to user" });
    }

    return res.status(200).json({
      message: "Account removed successfully",
      account: deletedAccount,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to remove account" });
  }
});

// API to add a transaction
app.post("/api/transaction/add", getUserFromToken, async (req, res) => {
  const { type, amount, balance, accountId } = req.body;
  const userId = req.userId;

  if (!type || !amount || !balance || !accountId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const client = await pool.connect();
    const result = await client.query(
      "INSERT INTO transactions (type, amount, balance, accountId) VALUES ($1, $2, $3, $4) RETURNING *",
      [type, amount, balance, accountId],
    );
    client.release();

    const newTransaction = result.rows[0];
    return res.status(201).json({
      message: "Transaction added successfully",
      transaction: newTransaction,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to add transaction" });
  }
});

// API to get all transactions for the user
app.post("/api/transaction/list", getUserFromToken, async (req, res) => {
  const userId = req.userId;

  try {
    const client = await pool.connect();
    const result = await client.query(
      "SELECT * FROM transactions t JOIN accounts a ON t.accountId = a.id WHERE a.userId = $1",
      [userId],
    );
    client.release();

    const transactions = result.rows;
    return res.status(200).json({ transactions });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// Start the server
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
