import { describe, expect, it, beforeEach } from "vitest";
import {
  FIFOQueue,
  Patient,
  PatientLinkedList,
  PriorityQueue,
  readStoredState,
  schedulePatients
} from "./App.jsx";

describe("Hospital Appointment Manager data structures", () => {
  it("supports FIFO enqueue, peek, dequeue, and empty checks", () => {
    const queue = new FIFOQueue();
    expect(queue.isEmpty()).toBe(true);
    queue.enqueue("first");
    queue.enqueue("second");
    expect(queue.peek()).toBe("first");
    expect(queue.dequeue()).toBe("first");
    expect(queue.dequeue()).toBe("second");
    expect(queue.dequeue()).toBeNull();
    expect(queue.isEmpty()).toBe(true);
  });

  it("orders emergency patients before normal patients and breaks ties by arrival", () => {
    const queue = new PriorityQueue();
    queue.enqueue(new Patient(1, "Normal", "Cardiology", 3, 540));
    queue.enqueue(new Patient(2, "Emergency", "Cardiology", 1, 570));
    queue.enqueue(new Patient(3, "Urgent", "Cardiology", 2, 540));
    queue.enqueue(new Patient(4, "Earlier", "Cardiology", 3, 530));
    expect([queue.dequeue().name, queue.dequeue().name, queue.dequeue().name, queue.dequeue().name])
      .toEqual(["Emergency", "Urgent", "Earlier", "Normal"]);
  });

  it("matches specialties, uses earliest availability, and applies 15-minute consultations", () => {
    const patients = [
      new Patient(1, "Cardio", "Cardiology", 3, 540),
      new Patient(2, "Cardio second", "Cardiology", 3, 540),
      new Patient(3, "Cardio later", "Cardiology", 3, 540),
      new Patient(4, "Neuro", "Neurology", 3, 540)
    ];
    const result = schedulePatients(patients, [
      { id: 1, name: "Dr Cardio 1", specialization: "Cardiology", availableAt: 600 },
      { id: 2, name: "Dr Cardio 2", specialization: "Cardiology", availableAt: 540 },
      { id: 3, name: "Dr Neuro", specialization: "Neurology", availableAt: 540 }
    ]);
    expect(result.appointments.map((appointment) => appointment.doctor.name))
      .toEqual(["Dr Cardio 1", "Dr Cardio 2", "Dr Cardio 1", "Dr Neuro"]);
    expect(result.appointments[0].startTime).toBe(540);
    expect(result.appointments[0].waitingTime).toBe(0);
    expect(result.appointments[2].startTime).toBe(555);
    expect(result.appointments[2].waitingTime).toBe(15);
    expect(result.appointments[2].endTime).toBe(570);
  });
});

describe("localStorage restoration", () => {
  beforeEach(() => {
    globalThis.window = {
      localStorage: {
        getItem: () => JSON.stringify({
          doctors: [{ id: 1, name: "Dr A", specialization: "Cardiology", availableAt: 555 }],
          patients: [{
            id: 1,
            name: "Patient A",
            specialization: "Cardiology",
            priority: 1,
            arrivalTime: 540
          }],
          appointments: [{
            patientId: 1,
            doctorId: 1,
            status: "Allocated",
            waitingTime: 15,
            startTime: 555,
            endTime: 570
          }],
          allocationQueue: [{ patientId: 1, doctorId: 1, status: "Allocated", waitingTime: 15, startTime: 555, endTime: 570 }],
          hasScheduled: true
        })
      }
    };
  });

  it("restores plain patients and links appointments without linked-list chains", () => {
    const restored = readStoredState();
    const list = new PatientLinkedList();
    restored.patients.forEach((patient) => list.add(new Patient(
      patient.id,
      patient.name,
      patient.specialization,
      patient.priority,
      patient.arrivalTime
    )));
    expect(list.toArray()).toHaveLength(1);
    expect(restored.appointments[0].patient.name).toBe("Patient A");
    expect(restored.appointments[0].patient.next).toBeUndefined();
    expect(restored.appointments[0].waitingTime).toBe(15);
  });
});
