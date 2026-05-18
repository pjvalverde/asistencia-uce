const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let currentStudentCourse = null;
let currentCourseCode = "";

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function showMessage(text, type = "neutral") {
  const box = $("#studentMessage");
  box.className = `message ${type}`;
  box.textContent = text;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(payload.error || payload || "No se pudo completar la accion.");
  }
  return payload;
}

function setView(viewId) {
  $$(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === viewId));
  $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === viewId));
}

function dayText(days) {
  const names = { LUN: "lunes", MAR: "martes", MIE: "miercoles", JUE: "jueves", VIE: "viernes", SAB: "sabado", DOM: "domingo" };
  return days.map((day) => names[day] || day).join(", ");
}

function renderStudentCourse(course) {
  currentStudentCourse = course;
  $("#studentCourse").classList.remove("hidden");
  $("#studentCourseTitle").textContent = `${course.name}${course.section ? ` · ${course.section}` : ""}`;
  $("#studentCourseMeta").textContent = `${dayText(course.days)} · ${course.startTime} a ${course.endTime}`;
  const badge = $("#windowBadge");
  badge.textContent = course.window.isOpen ? "Abierta ahora" : "Cerrada";
  badge.classList.toggle("open", course.window.isOpen);
  showMessage(
    course.window.isOpen
      ? "La ventana esta abierta. Busque su nombre y pulse Dar check una sola vez."
      : course.window.scheduledToday
        ? `Hoy existe clase, pero la asistencia abre de ${course.startTime} a ${course.endTime}.`
        : "Hoy no esta programada la toma de asistencia para esta materia.",
    course.window.isOpen ? "ok" : "neutral"
  );
}

function renderStudentResults(students) {
  const container = $("#studentResults");
  container.innerHTML = "";
  if (!students.length) {
    container.innerHTML = '<p class="muted">No hay resultados con ese texto.</p>';
    return;
  }
  const template = $("#studentCardTemplate");
  students.forEach((student) => {
    const node = template.content.cloneNode(true);
    node.querySelector("strong").textContent = student.name;
    node.querySelector("span").textContent = [student.email, student.externalId].filter(Boolean).join(" · ");
    const button = node.querySelector("button");
    button.disabled = !currentStudentCourse?.window?.isOpen;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const payload = await request(`/api/student/course/${currentCourseCode}/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: student.id })
        });
        showMessage(`Asistencia registrada para ${payload.student.name}. Hora: ${new Date(payload.record.checkedAt).toLocaleTimeString()}. Ya no necesita hacer nada mas.`, "ok");
        $("#studentResults").innerHTML = "";
        $("#studentSearchInput").value = "";
      } catch (error) {
        showMessage(error.message, "error");
        button.disabled = false;
      }
    });
    container.appendChild(node);
  });
}

async function loadAdminState() {
  const me = await request("/api/admin/me");
  $("#loginPanel").classList.toggle("hidden", me.admin);
  $("#dashboardPanel").classList.toggle("hidden", !me.admin);
  if (me.admin) {
    await loadCourses();
  }
}

async function loadCourses() {
  const { courses } = await request("/api/admin/courses");
  const list = $("#courseList");
  list.innerHTML = "";
  if (!courses.length) {
    list.innerHTML = '<p class="muted">Aun no hay materias creadas.</p>';
    return;
  }
  courses.forEach((course) => {
    const item = document.createElement("article");
    item.className = "course-item";
    item.innerHTML = `
      <div>
        <strong>${course.name}${course.section ? ` · ${course.section}` : ""}</strong>
        <span>${course.studentsCount} estudiantes · ${dayText(course.days)} · ${course.startTime}-${course.endTime}</span>
        <span>Codigo para estudiantes: <b>${course.code}</b></span>
      </div>
      <form class="report-form">
        <label>Desde<input name="from" type="date" value="${localDateValue()}" /></label>
        <label>Hasta<input name="to" type="date" value="${localDateValue()}" /></label>
        <button type="submit">Descargar Excel</button>
      </form>
      <div class="course-actions">
        <a href="${course.studentLink}" target="_blank" rel="noreferrer">Abrir estudiante</a>
        <button type="button" data-copy="${course.code}">Copiar codigo</button>
        <button type="button" data-link="${location.origin}${course.studentLink}">Copiar enlace</button>
      </div>
    `;
    item.querySelector(".report-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const from = form.get("from");
      const to = form.get("to");
      location.href = `/api/admin/courses/${course.id}/report.xlsx?from=${from}&to=${to}`;
    });
    item.querySelector("[data-copy]").addEventListener("click", async (event) => {
      await navigator.clipboard.writeText(event.currentTarget.dataset.copy);
      event.currentTarget.textContent = "Copiado";
    });
    item.querySelector("[data-link]").addEventListener("click", async (event) => {
      await navigator.clipboard.writeText(event.currentTarget.dataset.link);
      event.currentTarget.textContent = "Copiado";
    });
    list.appendChild(item);
  });
}

$$(".tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));

$("#courseCodeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = $("#courseCodeInput").value.trim().toUpperCase();
  if (!code) return;
  currentCourseCode = code;
  history.replaceState(null, "", `/estudiante/${code}`);
  try {
    const { course } = await request(`/api/student/course/${code}`);
    renderStudentCourse(course);
  } catch (error) {
    showMessage(error.message, "error");
  }
});

let searchTimer = null;
$("#studentSearchInput").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = $("#studentSearchInput").value.trim();
    if (!currentCourseCode || q.length < 2) {
      $("#studentResults").innerHTML = "";
      return;
    }
    try {
      const { students } = await request(`/api/student/course/${currentCourseCode}/search?q=${encodeURIComponent(q)}`);
      renderStudentResults(students);
    } catch (error) {
      showMessage(error.message, "error");
    }
  }, 220);
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form))
    });
    await loadAdminState();
  } catch (error) {
    alert(error.message);
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await request("/api/admin/logout", { method: "POST" });
  await loadAdminState();
});

$("#courseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const selectedDays = form.getAll("days");
  form.delete("days");
  selectedDays.forEach((day) => form.append("days", day));
  try {
    await request("/api/admin/courses", { method: "POST", body: form });
    event.currentTarget.reset();
    await loadCourses();
    alert("Materia creada e importada correctamente.");
  } catch (error) {
    alert(error.message);
  }
});

$("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await request("/api/admin/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form))
    });
    event.currentTarget.reset();
    alert("Clave actualizada correctamente.");
  } catch (error) {
    alert(error.message);
  }
});

async function bootFromPath() {
  const match = location.pathname.match(/^\/estudiante\/([^/]+)/);
  if (match) {
    setView("studentView");
    $("#courseCodeForm").classList.add("hidden");
    $("#directLinkNote").classList.remove("hidden");
    $("#courseCodeInput").value = decodeURIComponent(match[1]).toUpperCase();
    $("#courseCodeForm").dispatchEvent(new Event("submit"));
  }
  await loadAdminState();
}

bootFromPath();
