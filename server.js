const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { z } = require("zod");

const app = express();
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

// INTENTIONALLY INSECURE DEFAULT (gap analyzer should catch this)
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const db = new sqlite3.Database("./app.db");

// --- DB init
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS leave_requests(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
});

// seed users if not exist
function seed() {
  db.get(`SELECT COUNT(*) as c FROM users`, async (err, row) => {
    if (row && row.c === 0) {
      const employeePass = await bcrypt.hash("Employee@123", 10);
      const adminPass = await bcrypt.hash("Admin@123", 10);
      db.run(`INSERT INTO users(email,password_hash,role) VALUES (?,?,?)`, ["employee@test.com", employeePass, "employee"]);
      db.run(`INSERT INTO users(email,password_hash,role) VALUES (?,?,?)`, ["admin@test.com", adminPass, "admin"]);
      console.log("Seeded users: employee@test.com / Employee@123 , admin@test.com / Admin@123");
    }
  });
}
seed();

// --- auth middleware
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

// --- routes
app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/auth/login", (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const { email, password } = parsed.data;

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ error: "db_error" });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "1h" });
    res.json({ token });
  });
});

// employee: create request
app.post("/leave-requests", auth, requireRole("employee"), (req, res) => {
  const schema = z.object({
    start_date: z.string().min(1),
    end_date: z.string().min(1),
    reason: z.string().min(3).max(500)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const { start_date, end_date, reason } = parsed.data;

  db.run(
    `INSERT INTO leave_requests(user_id,start_date,end_date,reason,status) VALUES (?,?,?,?, 'PENDING')`,
    [req.user.sub, start_date, end_date, reason],
    function (err) {
      if (err) return res.status(500).json({ error: "db_error" });
      res.status(201).json({ id: this.lastID, status: "PENDING" });
    }
  );
});

// employee: list own requests
app.get("/leave-requests/me", auth, requireRole("employee"), (req, res) => {
  db.all(`SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC`, [req.user.sub], (err, rows) => {
    if (err) return res.status(500).json({ error: "db_error" });
    res.json({ items: rows });
  });
});

// admin: list all
app.get("/admin/leave-requests", auth, requireRole("admin"), (req, res) => {
  db.all(
    `SELECT lr.*, u.email as employee_email
     FROM leave_requests lr JOIN users u ON u.id = lr.user_id
     ORDER BY lr.created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "db_error" });
      res.json({ items: rows });
    }
  );
});

// admin: approve/reject
app.post("/admin/leave-requests/:id/decision", auth, requireRole("admin"), (req, res) => {
  const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  db.run(`UPDATE leave_requests SET status = ? WHERE id = ?`, [parsed.data.decision, req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "db_error" });
    if (this.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Mini Leave Portal running on http://localhost:${port}`));