const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const XLSX = require("xlsx");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = process.env.VERCEL ? os.tmpdir() : path.join(ROOT, "uploads");
const DB_PATH = path.join(DATA_DIR, "asistencia.json");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STATE_KEY = process.env.SUPABASE_STATE_KEY || "default";
const SESSION_SECRET = process.env.SESSION_SECRET || "cambiar-este-secreto-en-produccion";

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

if (!supabase) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(ROOT, "public")));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: "lax" }
  })
);

function emptyDb() {
  return {
    settings: {
      adminUser: ADMIN_USER,
      adminPasswordHash: hashPassword(ADMIN_PASSWORD),
      updatedAt: new Date().toISOString()
    },
    courses: [],
    students: [],
    attendance: [],
    audit: []
  };
}

function hashPassword(password) {
  return hash(`admin-password:${password}`);
}

function normalizeDb(db) {
  const normalized = { ...emptyDb(), ...db };
  normalized.settings = {
    ...emptyDb().settings,
    ...(db?.settings || {})
  };
  return normalized;
}

async function readDb() {
  if (supabase) {
    const { data, error } = await supabase
      .from("app_state")
      .select("value")
      .eq("key", SUPABASE_STATE_KEY)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return normalizeDb(data?.value || emptyDb());
  }
  if (!fs.existsSync(DB_PATH)) {
    return emptyDb();
  }
  return normalizeDb(JSON.parse(fs.readFileSync(DB_PATH, "utf8")));
}

async function writeDb(db) {
  if (supabase) {
    const { error } = await supabase
      .from("app_state")
      .upsert({
        key: SUPABASE_STATE_KEY,
        value: db,
        updated_at: new Date().toISOString()
      });
    if (error) {
      throw error;
    }
    return;
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function todayISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayKey(date = new Date()) {
  return ["DOM", "LUN", "MAR", "MIE", "JUE", "VIE", "SAB"][date.getDay()];
}

function minuteOfDay(time) {
  const [h, m] = String(time || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function nowMinute(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatDateLabel(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findColumn(headers, candidates) {
  const normalized = headers.map(normalizeHeader);
  return normalized.findIndex((header) =>
    candidates.some((candidate) => header.includes(candidate))
  );
}

function parseStudentsFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: ""
  });

  const headerIndex = rows.findIndex((row) => {
    const text = row.map(normalizeHeader).join(" ");
    return text.includes("nombre") || text.includes("correo") || text.includes("mail");
  });
  if (headerIndex === -1) {
    throw new Error("No se encontro una fila de encabezados con nombre/correo.");
  }

  const headers = rows[headerIndex];
  const firstNameIndex = findColumn(headers, ["nombres", "nombre"]);
  const lastNameIndex = findColumn(headers, ["apellidos", "apellido"]);
  const nameIndex = findColumn(headers, ["estudiante", "alumno", "nombre completo"]);
  const emailIndex = findColumn(headers, ["correo", "email", "mail", "uce"]);
  const codeIndex = findColumn(headers, ["cedula", "identific", "codigo", "matricula", "id"]);

  if (nameIndex === -1 && firstNameIndex === -1 && lastNameIndex === -1) {
    throw new Error("El Excel debe tener nombre/apellidos del estudiante.");
  }

  return rows
    .slice(headerIndex + 1)
    .map((row) => {
      const fullName =
        nameIndex >= 0
          ? String(row[nameIndex] || "")
          : `${lastNameIndex >= 0 ? row[lastNameIndex] || "" : ""} ${firstNameIndex >= 0 ? row[firstNameIndex] || "" : ""}`;
      return {
        externalId: codeIndex >= 0 ? String(row[codeIndex] || "").trim() : "",
        name: String(fullName).replace(/\s+/g, " ").trim(),
        email: emailIndex >= 0 ? String(row[emailIndex] || "").trim().toLowerCase() : ""
      };
    })
    .filter((student) => student.name && student.name.length > 2);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
  );
}

function signAdminToken(username) {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ username, expiresAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyAdminToken(token) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
    if (signature.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Date.now() > parsed.expiresAt) return null;
    return parsed.username;
  } catch {
    return null;
  }
}

function currentAdmin(req) {
  if (req.session?.adminUser) return req.session.adminUser;
  return verifyAdminToken(parseCookies(req).adminAuth);
}

function requireAdmin(req, res, next) {
  if (currentAdmin(req)) {
    return next();
  }
  return res.status(401).json({ error: "Debe iniciar sesion como docente." });
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress || "";
  return raw.split(",")[0].trim().replace(/^::ffff:/, "");
}

function getDeviceId(req, res) {
  const cookies = parseCookies(req);
  if (cookies.asistenciaDevice) {
    return cookies.asistenciaDevice;
  }
  const deviceId = crypto.randomBytes(16).toString("hex");
  res.cookie("asistenciaDevice", deviceId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
  return deviceId;
}

function activeWindow(course, date = new Date()) {
  const day = weekdayKey(date);
  const dateIso = todayISO(date);
  const scheduledToday = course.days.includes(day);
  const start = minuteOfDay(course.startTime);
  const end = minuteOfDay(course.endTime);
  const minute = nowMinute(date);
  const isOpen = scheduledToday && minute >= start && minute <= end;
  return {
    dateIso,
    weekday: day,
    scheduledToday,
    isOpen,
    startsInMinutes: start - minute,
    closesInMinutes: end - minute
  };
}

function dateRange(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const dates = [];
  for (let cursor = start; cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(todayISO(cursor));
  }
  return dates;
}

function scheduledDates(course, from, to) {
  return dateRange(from, to).filter((iso) => course.days.includes(weekdayKey(new Date(`${iso}T12:00:00`))));
}

function publicCourse(course) {
  const window = activeWindow(course);
  return {
    id: course.id,
    code: course.code,
    name: course.name,
    section: course.section,
    days: course.days,
    startTime: course.startTime,
    endTime: course.endTime,
    createdAt: course.createdAt,
    studentLink: `/estudiante/${course.code}`,
    window
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/setup-check", async (_req, res) => {
  const status = {
    ok: false,
    supabaseUrl: Boolean(SUPABASE_URL),
    supabaseServiceKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    storage: supabase ? "supabase" : "local-json"
  };
  try {
    await readDb();
    res.json({ ...status, ok: true });
  } catch (error) {
    res.status(500).json({
      ...status,
      error: error.message,
      code: error.code || null,
      hint: error.hint || null
    });
  }
});

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;
  const db = await readDb();
  if (username === db.settings.adminUser && hashPassword(password) === db.settings.adminPasswordHash) {
    req.session.admin = true;
    req.session.adminUser = username;
    res.cookie("adminAuth", signAdminToken(username), {
      httpOnly: true,
      sameSite: "lax",
      secure: Boolean(process.env.VERCEL || process.env.RENDER),
      maxAge: 8 * 60 * 60 * 1000
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Usuario o clave incorrectos." });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("adminAuth");
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/admin/me", async (req, res) => {
  const db = await readDb();
  const admin = currentAdmin(req);
  res.json({ admin: Boolean(admin), user: admin ? db.settings.adminUser : null });
});

app.post("/api/admin/change-password", requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: "La nueva clave debe tener al menos 8 caracteres." });
  }
  const db = await readDb();
  if (hashPassword(currentPassword) !== db.settings.adminPasswordHash) {
    return res.status(403).json({ error: "La clave actual no es correcta." });
  }
  db.settings.adminPasswordHash = hashPassword(newPassword);
  db.settings.updatedAt = new Date().toISOString();
  db.audit.push({
    id: id("audit"),
    type: "admin_password_changed",
    at: new Date().toISOString()
  });
  await writeDb(db);
  res.json({ ok: true });
});

app.get("/api/admin/courses", requireAdmin, async (req, res) => {
  const db = await readDb();
  const courses = db.courses.map((course) => {
    const studentsCount = db.students.filter((student) => student.courseId === course.id).length;
    return { ...publicCourse(course), studentsCount };
  });
  res.json({ courses });
});

app.post("/api/admin/courses", requireAdmin, upload.single("studentsFile"), async (req, res) => {
  try {
    const { name, section, days, startTime, endTime } = req.body;
    if (!name || !startTime || !endTime || !days || !req.file) {
      return res.status(400).json({ error: "Complete materia, dias, horario y archivo Excel." });
    }

    const selectedDays = Array.isArray(days) ? days : String(days).split(",");
    if (!selectedDays.length) {
      return res.status(400).json({ error: "Seleccione al menos un dia de asistencia." });
    }
    if (minuteOfDay(startTime) >= minuteOfDay(endTime)) {
      return res.status(400).json({ error: "La hora inicial debe ser menor que la hora final." });
    }

    const imported = parseStudentsFromExcel(req.file.path);
    if (!imported.length) {
      return res.status(400).json({ error: "No se encontraron estudiantes en el Excel." });
    }

    const db = await readDb();
    const course = {
      id: id("course"),
      code: `${slugify(name)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
      name: String(name).trim(),
      section: String(section || "").trim(),
      days: selectedDays,
      startTime,
      endTime,
      createdAt: new Date().toISOString(),
      originalFileName: req.file.originalname
    };

    const seen = new Set();
    const students = imported
      .filter((student) => {
        const key = `${student.name}|${student.email || student.externalId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((student) => ({
        id: id("student"),
        courseId: course.id,
        externalId: student.externalId,
        name: student.name,
        email: student.email,
        createdAt: new Date().toISOString()
      }));

    db.courses.push(course);
    db.students.push(...students);
    db.audit.push({
      id: id("audit"),
      type: "course_created",
      courseId: course.id,
      at: new Date().toISOString(),
      detail: { students: students.length, file: req.file.originalname }
    });
    await writeDb(db);

    res.json({ course: publicCourse(course), studentsCount: students.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/admin/courses/:courseId/schedule", requireAdmin, async (req, res) => {
  const { courseId } = req.params;
  const { days, startTime, endTime } = req.body;
  const selectedDays = Array.isArray(days) ? days : String(days || "").split(",").filter(Boolean);
  if (!selectedDays.length || !startTime || !endTime) {
    return res.status(400).json({ error: "Seleccione dias y horario." });
  }
  if (minuteOfDay(startTime) >= minuteOfDay(endTime)) {
    return res.status(400).json({ error: "La hora inicial debe ser menor que la hora final." });
  }
  const db = await readDb();
  const course = db.courses.find((item) => item.id === courseId);
  if (!course) {
    return res.status(404).json({ error: "Materia no encontrada." });
  }
  course.days = selectedDays;
  course.startTime = startTime;
  course.endTime = endTime;
  course.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ course: publicCourse(course) });
});

app.get("/api/admin/courses/:courseId/students", requireAdmin, async (req, res) => {
  const db = await readDb();
  const students = db.students
    .filter((student) => student.courseId === req.params.courseId)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ students });
});

app.get("/api/admin/courses/:courseId/attendance", requireAdmin, async (req, res) => {
  const { courseId } = req.params;
  const from = req.query.from || todayISO();
  const to = req.query.to || from;
  const db = await readDb();
  const course = db.courses.find((item) => item.id === courseId);
  if (!course) {
    return res.status(404).json({ error: "Materia no encontrada." });
  }
  const dates = scheduledDates(course, from, to);
  const students = db.students.filter((student) => student.courseId === courseId);
  const records = db.attendance.filter(
    (record) => record.courseId === courseId && dates.includes(record.date)
  );
  res.json({ dates, students, records });
});

app.get("/api/admin/courses/:courseId/report.xlsx", requireAdmin, async (req, res) => {
  const { courseId } = req.params;
  const from = req.query.from || todayISO();
  const to = req.query.to || from;
  const db = await readDb();
  const course = db.courses.find((item) => item.id === courseId);
  if (!course) {
    return res.status(404).send("Materia no encontrada.");
  }

  const dates = scheduledDates(course, from, to);
  const students = db.students
    .filter((student) => student.courseId === courseId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const attendanceSet = new Set(
    db.attendance
      .filter((record) => record.courseId === courseId && dates.includes(record.date))
      .map((record) => `${record.studentId}|${record.date}`)
  );

  const rows = students.map((student) => {
    const row = {
      "Nombre del estudiante": student.name,
      "Correo institucional": student.email,
      "Identificacion/Codigo": student.externalId
    };
    dates.forEach((date) => {
      row[formatDateLabel(date)] = attendanceSet.has(`${student.id}|${date}`) ? "SI" : "NO";
    });
    return row;
  });

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Asistencia");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const filename = `asistencia_${slugify(course.name)}_${from}_a_${to}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

app.get("/api/student/course/:code", async (req, res) => {
  const db = await readDb();
  const course = db.courses.find((item) => item.code === req.params.code);
  if (!course) {
    return res.status(404).json({ error: "Materia no encontrada." });
  }
  res.json({ course: publicCourse(course) });
});

app.get("/api/student/course/:code/search", async (req, res) => {
  const db = await readDb();
  const course = db.courses.find((item) => item.code === req.params.code);
  if (!course) {
    return res.status(404).json({ error: "Materia no encontrada." });
  }
  const q = normalizeHeader(req.query.q || "");
  if (q.length < 2) {
    return res.json({ students: [] });
  }
  const students = db.students
    .filter((student) => student.courseId === course.id)
    .filter((student) => {
      const haystack = normalizeHeader(`${student.name} ${student.email} ${student.externalId}`);
      return haystack.includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((student) => ({
      id: student.id,
      name: student.name,
      email: student.email,
      externalId: student.externalId
    }));
  res.json({ students });
});

app.post("/api/student/course/:code/check", async (req, res) => {
  const db = await readDb();
  const course = db.courses.find((item) => item.code === req.params.code);
  if (!course) {
    return res.status(404).json({ error: "Materia no encontrada." });
  }

  const window = activeWindow(course);
  if (!window.isOpen) {
    const message = window.scheduledToday
      ? `La asistencia esta cerrada. La ventana es de ${course.startTime} a ${course.endTime}.`
      : "Hoy no esta programada la toma de asistencia para esta materia.";
    return res.status(403).json({ error: message, window });
  }

  const student = db.students.find(
    (item) => item.id === req.body.studentId && item.courseId === course.id
  );
  if (!student) {
    return res.status(404).json({ error: "Estudiante no encontrado en esta materia." });
  }

  const deviceId = getDeviceId(req, res);
  const ip = getClientIp(req);
  const deviceHash = hash(deviceId);
  const ipHash = hash(ip);

  const sameStudent = db.attendance.find(
    (record) => record.courseId === course.id && record.studentId === student.id && record.date === window.dateIso
  );
  if (sameStudent) {
    return res.status(409).json({ error: "Ya registro su asistencia para hoy." });
  }

  const sameDevice = db.attendance.find(
    (record) => record.courseId === course.id && record.date === window.dateIso && record.deviceHash === deviceHash
  );
  if (sameDevice) {
    return res.status(409).json({ error: "Este celular o navegador ya fue usado para registrar asistencia hoy." });
  }

  const sameIp = db.attendance.find(
    (record) => record.courseId === course.id && record.date === window.dateIso && record.ipHash === ipHash
  );
  if (sameIp) {
    return res.status(409).json({ error: "Esta direccion IP ya fue usada para registrar asistencia hoy." });
  }

  const record = {
    id: id("att"),
    courseId: course.id,
    studentId: student.id,
    date: window.dateIso,
    checkedAt: new Date().toISOString(),
    deviceHash,
    ipHash,
    userAgentHash: hash(req.headers["user-agent"] || "")
  };
  db.attendance.push(record);
  await writeDb(db);
  res.json({
    ok: true,
    record: { date: record.date, checkedAt: record.checkedAt },
    student: { name: student.name, email: student.email }
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`App de asistencia disponible en http://localhost:${PORT}`);
    console.log(`Docente inicial: ${ADMIN_USER} / ${ADMIN_PASSWORD}`);
  });
}

module.exports = app;
