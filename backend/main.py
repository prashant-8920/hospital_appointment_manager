import base64
import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class Appointment(BaseModel):
    patientId: int = Field(gt=0)
    patientName: str = Field(min_length=1, max_length=100)
    waitingTime: float = Field(ge=0)


class ChartRequest(BaseModel):
    appointments: list[Appointment]


app = FastAPI(title="Hospital Appointment Manager Charts")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


@app.post("/waiting-time-chart")
def waiting_time_chart(request: ChartRequest):
    if not request.appointments:
        return {"image": None, "message": "No allocated appointments to plot."}

    labels = [
        appointment.patientName or f"Patient {appointment.patientId}"
        for appointment in request.appointments
    ]
    waiting_times = [appointment.waitingTime for appointment in request.appointments]

    figure, axis = plt.subplots(figsize=(7, 3.8))
    axis.plot(labels, waiting_times, marker="o", linewidth=2, color="#e06b43")
    axis.set_title("Waiting-Time Distribution")
    axis.set_xlabel("Patient")
    axis.set_ylabel("Waiting time (minutes)")
    axis.set_ylim(bottom=0)
    axis.grid(axis="y", alpha=0.25)
    figure.tight_layout()

    image_buffer = io.BytesIO()
    figure.savefig(image_buffer, format="png", dpi=150)
    plt.close(figure)
    image = base64.b64encode(image_buffer.getvalue()).decode("ascii")
    return {"image": f"data:image/png;base64,{image}"}
