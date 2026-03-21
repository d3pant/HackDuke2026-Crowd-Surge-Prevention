from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import datetime
from models.db import get_db, Incident, Guard, ZoneEvent
from models.schemas import (
    IncidentCreate, IncidentUpdate, IncidentResponse,
    GuardResponse, GuardAssign, StreamControl
)

router = APIRouter()

@router.get("/guards", response_model=list[GuardResponse])
def get_guards(db: Session = Depends(get_db)):
    return db.query(Guard).all()

@router.get("/incidents", response_model=list[IncidentResponse])
def get_incidents(status: str = None, limit: int = 50, db: Session = Depends(get_db)):
    query = db.query(Incident)
    if status:
        query = query.filter(Incident.status == status)
    return query.order_by(Incident.opened_at.desc()).limit(limit).all()


@router.post("/incidents", response_model=IncidentResponse)
def create_incident(data: IncidentCreate, db: Session = Depends(get_db)):
    # check for existing open/assigned incident for this zone
    existing = db.query(Incident).filter(
        Incident.zone_id == data.zone_id,
        Incident.status.in_(["open", "assigned"])
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Active incident already exists for zone {data.zone_id}"
        )

    incident = Incident(
        zone_id=data.zone_id,
        level=data.level,
        density_at_trigger=data.density_at_trigger,
        growth_rate_at_trigger=data.growth_rate_at_trigger,
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)
    return format_incident(incident)


@router.get("/incidents/{incident_id}", response_model=IncidentResponse)
def get_incident(incident_id: int, db: Session = Depends(get_db)):
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return format_incident(incident)


@router.patch("/incidents/{incident_id}", response_model=IncidentResponse)
def update_incident(incident_id: int, data: IncidentUpdate, db: Session = Depends(get_db)):
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    if data.status:
        incident.status = data.status
    if data.guard_id:
        incident.guard_id = data.guard_id
    if data.notes:
        incident.notes = data.notes
    db.commit()
    db.refresh(incident)
    return format_incident(incident)

@router.post("/incidents/{incident_id}/assign", response_model=IncidentResponse)
def assign_guard(incident_id: int, body: GuardAssign, db: Session = Depends(get_db)):
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    guard = db.query(Guard).filter(Guard.id == body.guard_id).first()
    if not guard:
        raise HTTPException(status_code=404, detail="Guard not found")
    if guard.status == "dispatched":
        raise HTTPException(status_code=409, detail="Guard is already dispatched")

    incident.status = "assigned"
    incident.guard_id = body.guard_id
    incident.assigned_at = datetime.utcnow()

    guard.status = "dispatched"
    guard.current_zone_id = incident.zone_id

    db.commit()
    db.refresh(incident)
    return format_incident(incident)


@router.post("/incidents/{incident_id}/resolve", response_model=IncidentResponse)
def resolve_incident(incident_id: int, db: Session = Depends(get_db)):
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    incident.status = "resolved"
    incident.resolved_at = datetime.utcnow()

    # only free the guard if one was assigned
    if incident.guard_id:
        guard = db.query(Guard).filter(Guard.id == incident.guard_id).first()
        if guard:
            guard.status = "available"
            guard.current_zone_id = None

    db.commit()
    db.refresh(incident)
    return format_incident(incident)

@router.get("/zones/{zone_id}/history")
def get_zone_history(zone_id: str, limit: int = 60, db: Session = Depends(get_db)):
    events = db.query(ZoneEvent).filter(
        ZoneEvent.zone_id == zone_id
    ).order_by(ZoneEvent.timestamp.desc()).limit(limit).all()
    return events


@router.post("/stream/control")
def control_stream(body: StreamControl, request: Request):
    sim = request.app.state.simulator
    if body.action == "play":
        sim.resume()
    elif body.action == "pause":
        sim.pause()
    elif body.action == "reset":
        sim.reset()
    if body.speed:
        sim.set_speed(body.speed)
    return {"status": "ok"}

def format_incident(incident: Incident) -> dict:
    return {
        "id": incident.id,
        "zone_id": incident.zone_id,
        "venue_id": incident.venue_id,
        "level": incident.level,
        "density_at_trigger": incident.density_at_trigger,
        "growth_rate_at_trigger": incident.growth_rate_at_trigger,
        "guard_id": incident.guard_id,
        "status": incident.status,
        "opened_at": incident.opened_at.isoformat() if incident.opened_at else None,
        "assigned_at": incident.assigned_at.isoformat() if incident.assigned_at else None,
        "resolved_at": incident.resolved_at.isoformat() if incident.resolved_at else None,
        "notes": incident.notes,
    }

