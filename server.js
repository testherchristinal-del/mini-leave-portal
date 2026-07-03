const express = require("express");
const Database = require("better-sqlite3");
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

const db = new Database("./app.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL
  );

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

async function seed() {
  const row = db.prepare(`SELECT COUNT(*) as c FROM users`).get();
  if (row.c === 0) {
    const employeePass = await bcrypt.hash("Employee@123", 10);
    const adminPass = await bcrypt.hash("Admin@123", 10);

    db.prepare(`INSERT INTO users(email,password_hash,role) VALUES (?,?,?)`)
      .run("employee@test.com", employeePass, "employee");

    db.prepare(`INSERT INTO users(email,password_hash,role) VALUES (?,?,?)`)
      .run("admin@test.com", adminPass, "admin");

    console.log("Seeded users: employee@test.com / Employee@123 , admin@test.com / Admin@123");
  }
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
app.get("/", (req, res) => res.send("Mini Leave Portal API running. Try /health"));
app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/auth/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const { email, password } = parsed.data;

  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "1h" });
  res.json({ token });
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

  const result = db.prepare(
    `INSERT INTO leave_requests(user_id,start_date,end_date,reason,status) VALUES (?,?,?,?, 'PENDING')`
  ).run(req.user.sub, start_date, end_date, reason);

  res.status(201).json({ id: result.lastInsertRowid, status: "PENDING" });
});

// employee: list own requests
app.get("/leave-requests/me", auth, requireRole("employee"), (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC`
  ).all(req.user.sub);

  res.json({ items: rows });
});

// admin: list all
app.get("/admin/leave-requests", auth, requireRole("admin"), (req, res) => {
  const rows = db.prepare(
    `SELECT lr.*, u.email as employee_email
     FROM leave_requests lr JOIN users u ON u.id = lr.user_id
     ORDER BY lr.created_at DESC`
  ).all();

  res.json({ items: rows });
});

// admin: approve/reject
app.post("/admin/leave-requests/:id/decision", auth, requireRole("admin"), (req, res) => {
  const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const info = db.prepare(`UPDATE leave_requests SET status = ? WHERE id = ?`)
    .run(parsed.data.decision, req.params.id);

  if (info.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Mini Leave Portal running on http://localhost:${port}`));