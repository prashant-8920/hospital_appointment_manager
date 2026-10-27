import { useEffect, useMemo, useRef, useState } from "react";
import "../style.css";

const CONSULTATION_MINUTES = 15;
const CLINIC_OPEN_MINUTES = 9 * 60;
const CLINIC_CLOSE_MINUTES = CLINIC_OPEN_MINUTES + 12 * 60;
const PRIORITY_NAMES = { 1: "Emergency", 2: "Urgent", 3: "Normal" };
const STORAGE_KEY = "hospital-appointment-manager-state";
const CHART_API_URL = "http://127.0.0.1:8000/waiting-time-chart";

class Patient {
  constructor(id, name, specialization, priority, arrivalTime) {
    this.id = id;
    this.name = name;
    this.specialization = specialization;
    this.priority = priority;
    this.arrivalTime = arrivalTime;
    this.next = null;
  }
}

class PatientLinkedList {
  constructor() {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  add(patient) {
    if (!this.head) this.head = this.tail = patient;
    else {
      this.tail.next = patient;
      this.tail = patient;
    }
    this.length += 1;
  }

  toArray() {
    const records = [];
    let current = this.head;
    while (current) {
      records.push(current);
      current = current.next;
    }
    return records;
  }

  clear() {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }
}

class FIFOQueue {
  constructor() {
    this.items = [];
    this.frontIndex = 0;
  }

  enqueue(item) {
    this.items.push(item);
  }

  dequeue() {
    if (this.isEmpty()) return null;
    const item = this.items[this.frontIndex];
    this.frontIndex += 1;
    return item;
  }

  peek() {
    return this.isEmpty() ? null : this.items[this.frontIndex];
  }

  isEmpty() {
    return this.frontIndex >= this.items.length;
  }

  toArray() {
    return this.items.slice(this.frontIndex);
  }
}

class PriorityQueue {
  constructor() {
    this.heap = [];
  }

  isHigherPriority(first, second) {
    if (first.priority !== second.priority) return first.priority < second.priority;
    if (first.arrivalTime !== second.arrivalTime) return first.arrivalTime < second.arrivalTime;
    return first.id < second.id;
  }

  enqueue(item) {
    this.heap.push(item);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.isHigherPriority(this.heap[index], this.heap[parent])) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
      index = parent;
    }
  }

  dequeue() {
    if (!this.heap.length) return null;
    if (this.heap.length === 1) return this.heap.pop();
    const first = this.heap[0];
    this.heap[0] = this.heap.pop();
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let smallest = index;
      if (left < this.heap.length && this.isHigherPriority(this.heap[left], this.heap[smallest])) smallest = left;
      if (right < this.heap.length && this.isHigherPriority(this.heap[right], this.heap[smallest])) smallest = right;
      if (smallest === index) break;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
    return first;
  }
}

function parseClockTime(clockTime) {
  if (!/^\d{2}:\d{2}$/.test(clockTime)) return null;
  const [hours, minutes] = clockTime.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClock(minutesSinceMidnight) {
  const hour24 = Math.floor(minutesSinceMidnight / 60) % 24;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minutesSinceMidnight % 60).padStart(2, "0")} ${suffix}`;
}

function isValidId(id) {
  return Number.isInteger(id) && id > 0;
}

function plainPatient(patient) {
  return {
    id: patient.id,
    name: patient.name,
    specialization: patient.specialization,
    priority: patient.priority,
    arrivalTime: patient.arrivalTime
  };
}

function storedAppointment(appointment) {
  return {
    patientId: appointment.patient.id,
    doctorId: appointment.doctor?.id ?? null,
    status: appointment.status,
    waitingTime: appointment.waitingTime,
    startTime: appointment.startTime,
    endTime: appointment.endTime
  };
}

function readStoredState() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return null;

    const doctors = Array.isArray(parsed.doctors)
      ? parsed.doctors.filter((doctor) => (
        isValidId(doctor.id)
        && typeof doctor.name === "string"
        && typeof doctor.specialization === "string"
        && Number.isFinite(doctor.availableAt)
      ))
      : [];
    const uniqueDoctors = doctors.filter((doctor, index, records) => (
      records.findIndex((record) => record.id === doctor.id) === index
    ));
    const patients = Array.isArray(parsed.patients)
      ? parsed.patients.filter((patient) => (
        isValidId(patient.id)
        && typeof patient.name === "string"
        && typeof patient.specialization === "string"
        && [1, 2, 3].includes(patient.priority)
        && Number.isInteger(patient.arrivalTime)
      ))
      : [];
    const uniquePatients = patients.filter((patient, index, records) => (
      records.findIndex((record) => record.id === patient.id) === index
    ));
    const patientById = new Map(uniquePatients.map((patient) => [patient.id, patient]));
    const doctorById = new Map(uniqueDoctors.map((doctor) => [doctor.id, doctor]));
    const appointments = Array.isArray(parsed.appointments)
      ? parsed.appointments.map((appointment) => ({
        ...appointment,
        patientId: appointment.patientId ?? appointment.patient?.id,
        doctorId: appointment.doctorId ?? appointment.doctor?.id ?? null
      })).filter((appointment) => (
        appointment
        && patientById.has(appointment.patientId)
        && (appointment.doctorId === null || doctorById.has(appointment.doctorId))
        && typeof appointment.status === "string"
        && (appointment.waitingTime === null || Number.isFinite(appointment.waitingTime))
        && (appointment.startTime === null || Number.isFinite(appointment.startTime))
        && (appointment.endTime === undefined || Number.isFinite(appointment.endTime))
      ))
      : [];
    const uniqueAppointments = appointments.filter((appointment, index, records) => (
      records.findIndex((record) => record.patientId === appointment.patientId) === index
    )).map((appointment) => ({
      ...appointment,
      patient: patientById.get(appointment.patientId),
      doctor: appointment.doctorId === null ? null : doctorById.get(appointment.doctorId)
    }));
    const appointmentByPatientId = new Map(
      uniqueAppointments.map((appointment) => [appointment.patient.id, appointment])
    );
    const allocationQueue = Array.isArray(parsed.allocationQueue)
      ? parsed.allocationQueue
        .map((appointment) => appointmentByPatientId.get(appointment?.patientId ?? appointment?.patient?.id))
        .filter(Boolean)
        .filter((appointment, index, records) => (
          records.findIndex((record) => record.patient.id === appointment.patient.id) === index
        ))
      : [];

    return {
      doctors: uniqueDoctors,
      patients: uniquePatients,
      appointments: uniqueAppointments,
      allocationQueue,
      hasScheduled: parsed.hasScheduled === true && uniqueAppointments.length > 0,
      nextDoctorId: Math.max(0, ...uniqueDoctors.map((doctor) => doctor.id)) + 1,
      nextPatientId: Math.max(0, ...uniquePatients.map((patient) => patient.id)) + 1
    };
  } catch {
    return null;
  }
}

function schedulePatients(patients, doctors) {
  const priorityQueue = new PriorityQueue();
  const freshDoctors = doctors.map((doctor) => ({ ...doctor, availableAt: CLINIC_OPEN_MINUTES }));
  const queue = new FIFOQueue();
  const results = [];
  patients.forEach((patient) => priorityQueue.enqueue(patient));

  while (priorityQueue.heap.length) {
    const patient = priorityQueue.dequeue();
    const matches = freshDoctors.filter(
      (doctor) => doctor.specialization.toLowerCase() === patient.specialization.toLowerCase()
    );
    if (!matches.length) {
      const result = { patient, doctor: null, status: "No matching doctor", waitingTime: null, startTime: null };
      results.push(result);
      queue.enqueue(result);
      continue;
    }
    matches.sort((first, second) => first.availableAt - second.availableAt || first.id - second.id);
    const doctor = matches[0];
    const startTime = Math.max(patient.arrivalTime, doctor.availableAt);
    const result = {
      patient,
      doctor,
      status: "Allocated",
      waitingTime: Math.max(0, startTime - patient.arrivalTime),
      startTime,
      endTime: startTime + CONSULTATION_MINUTES
    };
    doctor.availableAt = result.endTime;
    results.push(result);
    queue.enqueue(result);
  }
  return { doctors: freshDoctors, appointments: results, allocationQueue: queue.toArray() };
}

function PanelHeading({ eyebrow, title, symbol, children, subtitle }) {
  return (
    <div className="panel-heading panel-heading-wrap">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        {subtitle && <p className="section-subtitle">{subtitle}</p>}
      </div>
      {children || (symbol && <span className="panel-symbol">{symbol}</span>)}
    </div>
  );
}

function App() {
  const patientList = useRef(new PatientLinkedList());
  const nextPatientId = useRef(1);
  const nextDoctorId = useRef(1);
  const [doctors, setDoctors] = useState([]);
  const [patientsVersion, setPatientsVersion] = useState(0);
  const [appointments, setAppointments] = useState([]);
  const [allocationQueue, setAllocationQueue] = useState([]);
  const [hasScheduled, setHasScheduled] = useState(false);
  const [filterSpecialty, setFilterSpecialty] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [toast, setToast] = useState("");
  const [doctorForm, setDoctorForm] = useState({ name: "", specialty: "" });
  const [patientForm, setPatientForm] = useState({ name: "", specialty: "", priority: "3", arrival: "" });
  const [isHydrated, setIsHydrated] = useState(false);
  const [chartImage, setChartImage] = useState("");
  const [chartError, setChartError] = useState("");

  useEffect(() => {
    document.title = "Hospital Appointment Manager | DAA Mini Project";
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const storedState = readStoredState();
    if (storedState) {
      patientList.current.clear();
      storedState.patients.forEach((patient) => {
        patientList.current.add(new Patient(
          patient.id,
          patient.name,
          patient.specialization,
          patient.priority,
          patient.arrivalTime
        ));
      });
      nextPatientId.current = storedState.nextPatientId;
      nextDoctorId.current = storedState.nextDoctorId;
      setDoctors(storedState.doctors);
      setAppointments(storedState.appointments);
      setAllocationQueue(storedState.allocationQueue);
      setHasScheduled(storedState.hasScheduled);
      setPatientsVersion((version) => version + 1);
    }
    setIsHydrated(true);
  }, []);

  const patients = patientList.current.toArray();

  useEffect(() => {
    if (!isHydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        doctors,
        patients: patients.map(plainPatient),
        appointments: appointments.map(storedAppointment),
        allocationQueue: allocationQueue.map(storedAppointment),
        hasScheduled,
        nextDoctorId: nextDoctorId.current,
        nextPatientId: nextPatientId.current
      }));
    } catch {
      setToast("Unable to save data in browser storage.");
    }
  }, [isHydrated, doctors, patientsVersion, appointments, allocationQueue, hasScheduled]);

  useEffect(() => {
    const chartAppointments = appointments
      .filter((appointment) => appointment.status === "Allocated")
      .map((appointment) => ({
        patientId: appointment.patient.id,
        patientName: appointment.patient.name,
        waitingTime: appointment.waitingTime
      }));

    if (!chartAppointments.length) {
      setChartImage("");
      setChartError("");
      return undefined;
    }

    const controller = new AbortController();
    setChartError("");
    fetch(CHART_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointments: chartAppointments }),
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "The chart service rejected the appointment data.");
        return payload;
      })
      .then((payload) => {
        setChartImage(payload.image || "");
        setChartError("");
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setChartImage("");
        setChartError("Waiting-time chart is unavailable. Start the Python backend and try scheduling again.");
      });

    return () => controller.abort();
  }, [appointments]);

  const specialties = useMemo(
    () => [...new Set(doctors.map((doctor) => doctor.specialization))].sort(),
    [doctors]
  );
  const filteredDoctors = appliedFilter
    ? doctors.filter((doctor) => doctor.specialization.toLowerCase() === appliedFilter.toLowerCase())
    : [];
  const allocated = appointments.filter((appointment) => appointment.status === "Allocated");
  const averageWait = hasScheduled && allocated.length
    ? `${(allocated.reduce((sum, appointment) => sum + appointment.waitingTime, 0) / allocated.length).toFixed(1)}m`
    : "—";

  function resetSchedule() {
    setAppointments([]);
    setAllocationQueue([]);
    setHasScheduled(false);
  }

  function addDoctor(event) {
    event.preventDefault();
    const name = doctorForm.name.trim();
    const specialization = doctorForm.specialty.trim();
    if (!name || !specialization) return;
    setDoctors((current) => [...current, { id: nextDoctorId.current++, name, specialization, availableAt: CLINIC_OPEN_MINUTES }]);
    setDoctorForm({ name: "", specialty: "" });
    resetSchedule();
    setToast("Doctor added successfully.");
  }

  function removeDoctor(id) {
    setDoctors((current) => current.filter((doctor) => doctor.id !== id));
    resetSchedule();
    setToast("Doctor removed.");
  }

  function addPatient(event) {
    event.preventDefault();
    const name = patientForm.name.trim();
    const specialization = patientForm.specialty.trim();
    const arrivalTime = parseClockTime(patientForm.arrival);
    if (!name || !specialization || arrivalTime === null || arrivalTime < CLINIC_OPEN_MINUTES || arrivalTime > CLINIC_CLOSE_MINUTES) {
      setToast("Please enter valid patient details.");
      return;
    }
    patientList.current.add(new Patient(
      nextPatientId.current++,
      name,
      specialization,
      Number(patientForm.priority),
      arrivalTime
    ));
    setPatientsVersion((version) => version + 1);
    setPatientForm({ name: "", specialty: "", priority: "3", arrival: "" });
    resetSchedule();
    setToast("Patient registered in the linked list.");
  }

  function scheduleAppointments() {
    if (!patients.length) {
      setToast("Register at least one patient first.");
      return;
    }
    const scheduled = schedulePatients(patients, doctors);
    setDoctors(scheduled.doctors);
    setAppointments(scheduled.appointments);
    setAllocationQueue(scheduled.allocationQueue);
    setHasScheduled(true);
    setToast("Appointments scheduled.");
  }

  function resetDemo() {
    if (!window.confirm("Clear all doctors, patients, and appointment results?")) return;
    patientList.current.clear();
    nextPatientId.current = 1;
    nextDoctorId.current = 1;
    setPatientsVersion((version) => version + 1);
    setDoctors([]);
    setFilterSpecialty("");
    setAppliedFilter("");
    resetSchedule();
    setToast("Demo cleared.");
  }

  const scheduleMessage = !hasScheduled
    ? "Consultation duration: 15 minutes (demo setting). Scheduling is simulated, not a real booking."
    : appointments.some((appointment) => appointment.status !== "Allocated")
      ? `Scheduling complete. ${appointments.filter((appointment) => appointment.status !== "Allocated").length} patient(s) have no matching doctor. Add the required specialty and schedule again if needed.`
      : "Scheduling complete. Times are simulated from 09:00 AM; consultation duration is 15 minutes.";

  return (
    <>
      <header className="topbar">
        <div className="brand-mark">+</div>
        <div><p className="eyebrow">DAA MINI PROJECT · CIC-311</p><h1>Hospital Appointment Manager</h1></div>
        <div className="top-pill">React.js · Interactive demo</div>
      </header>
      <main className="container">
        <section className="intro">
          <div><p className="eyebrow accent">ALGORITHM PLAYGROUND</p><h2>Manage the queue.<br /><span>Schedule with clarity.</span></h2><p className="intro-copy">Add doctors and patients, prioritize appointments, match specialties, and inspect estimated waiting times — all in your browser.</p></div>
          <div className="intro-note"><span className="note-icon">⌘</span><div><strong>DAA concepts in action</strong><p>Linked List · Binary Heap Priority Queue · FIFO Queue · Filtering · Greedy Selection</p></div></div>
        </section>

        <section className="stats-grid" aria-label="Project summary">
          <article className="stat-card"><span className="stat-label">Doctors added</span><strong>{doctors.length}</strong><span className="stat-foot">Available specialties</span></article>
          <article className="stat-card"><span className="stat-label">Patients registered</span><strong>{patients.length}</strong><span className="stat-foot">Stored in linked list</span></article>
          <article className="stat-card"><span className="stat-label">Allocated</span><strong>{allocated.length}</strong><span className="stat-foot">Appointments scheduled</span></article>
          <article className="stat-card"><span className="stat-label">Average waiting</span><strong>{averageWait}</strong><span className="stat-foot">Minutes, allocated patients</span></article>
        </section>

        <section className="workspace-grid">
          <div className="main-column">
            <section className="panel">
              <PanelHeading eyebrow="01 / STAFF" title="Add a doctor" symbol="✚" />
              <form className="form-grid" onSubmit={addDoctor}>
                <label>Doctor name<input required maxLength="60" placeholder="e.g. Dr. Sharma" value={doctorForm.name} onChange={(event) => setDoctorForm({ ...doctorForm, name: event.target.value })} /></label>
                <label>Specialization<input required maxLength="60" placeholder="e.g. Cardiology" value={doctorForm.specialty} onChange={(event) => setDoctorForm({ ...doctorForm, specialty: event.target.value })} /></label>
                <button className="btn btn-primary full-row" type="submit">+ Add doctor</button>
              </form>
              <div className="table-wrap"><table><thead><tr><th>Doctor</th><th>Specialization</th><th>Next available</th><th /></tr></thead><tbody>
                {!doctors.length ? <tr><td colSpan="4" className="empty-cell">No doctors added yet. Add a doctor above.</td></tr> : doctors.map((doctor) => <tr key={doctor.id}><td><strong>{doctor.name}</strong></td><td>{doctor.specialization}</td><td>{formatClock(doctor.availableAt)}</td><td><button className="btn btn-quiet" type="button" onClick={() => removeDoctor(doctor.id)}>Remove</button></td></tr>)}
              </tbody></table></div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="02 / REGISTRATION" title="Register a patient" symbol="＋" />
              <form className="form-grid" onSubmit={addPatient}>
                <label>Patient name<input required maxLength="60" placeholder="e.g. Aman Verma" value={patientForm.name} onChange={(event) => setPatientForm({ ...patientForm, name: event.target.value })} /></label>
                <label>Required specialization<input required maxLength="60" list="specialtyOptions" placeholder="e.g. Cardiology" value={patientForm.specialty} onChange={(event) => setPatientForm({ ...patientForm, specialty: event.target.value })} /><datalist id="specialtyOptions">{specialties.map((specialty) => <option value={specialty} key={specialty} />)}</datalist></label>
                <label>Priority<select value={patientForm.priority} onChange={(event) => setPatientForm({ ...patientForm, priority: event.target.value })}><option value="1">Emergency — 1</option><option value="2">Urgent — 2</option><option value="3">Normal — 3</option></select></label>
                <label>Arrival time <span className="label-help">(12-hour clock)</span><input type="time" min="09:00" max="21:00" required value={patientForm.arrival} onChange={(event) => setPatientForm({ ...patientForm, arrival: event.target.value })} /></label>
                <button className="btn btn-primary full-row" type="submit">+ Register patient</button>
              </form>
              <p className="helper">Priority 1 is highest. For equal priority, earlier arrival is scheduled first. Times are displayed in 12-hour AM/PM format.</p>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="03 / SPECIALIZATION FILTER" title="Find matching doctors" />
              <div className="filter-row"><label className="filter-input">Specialization<input list="specialtyOptions" placeholder="Type a specialty" value={filterSpecialty} onChange={(event) => setFilterSpecialty(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setAppliedFilter(filterSpecialty.trim()); }} /></label><button className="btn btn-secondary" type="button" onClick={() => setAppliedFilter(filterSpecialty.trim())}>Filter doctors</button><button className="btn btn-quiet" type="button" onClick={() => { setFilterSpecialty(""); setAppliedFilter(""); }}>Show all</button></div>
              <div className="filter-results">{!appliedFilter ? <span className="muted">Enter a specialty and select “Filter doctors”.</span> : !filteredDoctors.length ? <span className="muted">No doctors found for “{appliedFilter}”.</span> : filteredDoctors.map((doctor) => <div className="doctor-chip" key={doctor.id}><strong>{doctor.name}</strong><span>{doctor.specialization} · Available {formatClock(doctor.availableAt)}</span></div>)}</div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="04 / SCHEDULING" title="Appointment dashboard" subtitle="Appointments are allocated using the priority queue and earliest-available matching doctor."><button className="btn btn-primary" type="button" onClick={scheduleAppointments}>Schedule appointments →</button></PanelHeading>
              <div className="table-wrap"><table className="appointments-table"><thead><tr><th>ID</th><th>Patient</th><th>Priority</th><th>Specialty</th><th>Doctor</th><th>Start time</th><th>Waiting</th><th>Status</th></tr></thead><tbody>
                {!appointments.length ? <tr><td colSpan="8" className="empty-cell">Register patients, then schedule appointments.</td></tr> : appointments.map((appointment) => <tr key={appointment.patient.id}><td>#{appointment.patient.id}</td><td><strong>{appointment.patient.name}</strong></td><td><span className={`priority-tag priority-${appointment.patient.priority}`}>{PRIORITY_NAMES[appointment.patient.priority]}</span></td><td>{appointment.patient.specialization}</td><td>{appointment.doctor?.name || "—"}</td><td>{appointment.startTime === null ? "—" : formatClock(appointment.startTime)}</td><td>{appointment.waitingTime === null ? "—" : `${appointment.waitingTime} min`}</td><td><span className={`status-tag ${appointment.status === "Allocated" ? "status-allocated" : "status-missing"}`}>{appointment.status}</span></td></tr>)}
              </tbody></table></div>
              <p className="helper">{scheduleMessage}</p>
            </section>
          </div>

          <aside className="side-column">
            <section className="panel chart-panel"><PanelHeading eyebrow="05 / VISUALIZATION" title="Waiting-time plot" symbol="▥" /><p className="section-subtitle">Waiting time in minutes for each allocated patient.</p><div className="waiting-chart">{!allocated.length ? <div className="empty-chart">Your waiting-time chart will appear after scheduling.</div> : chartError ? <div className="empty-chart">{chartError}</div> : chartImage ? <img className="waiting-chart-image" src={chartImage} alt="Waiting-time distribution line chart" /> : <div className="empty-chart">Generating waiting-time chart...</div>}</div><div className="chart-legend"><span className="legend-dot" /> Matplotlib waiting-time distribution <span className="chart-unit">Minutes</span></div></section>
            <section className="panel queue-panel"><PanelHeading eyebrow="06 / FIFO QUEUE" title="Allocation order" symbol="↕" /><p className="section-subtitle">Results are placed in a FIFO queue and displayed from front to rear.</p><ol className="fifo-list">{!allocationQueue.length ? <li className="empty-list">No appointments yet.</li> : allocationQueue.map((appointment, index) => <li key={appointment.patient.id}><span className="queue-number">{index + 1}</span><div className="queue-detail"><strong>{appointment.patient.name}</strong><span>{appointment.patient.specialization}</span></div><span className="queue-status">{appointment.status === "Allocated" ? "Allocated" : "Unmatched"}</span></li>)}</ol></section>
            <section className="panel algorithm-panel"><PanelHeading eyebrow="DAA NOTES" title="How it works" />
              <div className="algorithm-step"><span>1</span><div><strong>Linked List</strong><p>Patient nodes connect through a <code>next</code> pointer.</p></div></div>
              <div className="algorithm-step"><span>2</span><div><strong>Binary Min-Heap</strong><p>Priority 1 comes before 2 and 3; arrival time breaks ties.</p></div></div>
              <div className="algorithm-step"><span>3</span><div><strong>Specialty Filter</strong><p>Only doctors matching the patient's requested specialty are considered.</p></div></div>
              <div className="algorithm-step"><span>4</span><div><strong>Greedy Selection</strong><p>Choose the matching doctor who is available earliest.</p></div></div>
              <div className="algorithm-step"><span>5</span><div><strong>Waiting time</strong><p><code>max(arrival, doctor free time) − arrival</code></p></div></div>
              <div className="complexity"><p className="eyebrow">COMPLEXITY SNAPSHOT</p><div><span>Linked-list append</span><code>O(1)</code></div><div><span>Heap insert / remove</span><code>O(log n)</code></div><div><span>Specialty filter</span><code>O(d)</code></div><div><span>Greedy scheduling</span><code>O(n log n + nd + Σkᵢ log kᵢ)</code></div><div><span>Storage</span><code>O(n + d)</code></div><p className="tiny-note">n = patients · d = doctors · kᵢ = matching doctors for patient i</p></div>
            </section>
            <button className="btn btn-danger-outline reset-button" type="button" onClick={resetDemo}>Reset demo data</button>
          </aside>
        </section>
        <footer><span>Hospital Appointment Manager</span><span>DAA Mini Project · Browser-only demo · Data persists in localStorage</span></footer>
      </main>
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}

export {
  FIFOQueue,
  Patient,
  PatientLinkedList,
  PriorityQueue,
  parseClockTime,
  readStoredState,
  schedulePatients
};

export default App;
