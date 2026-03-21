from pydantic import BaseModel, ConfigDict
from typing import Optional

class CellSchema(BaseModel):
    id: str
    row: int
    col: int
    count: float
    capacity: int
    level: str
    density_pct: float
    growth_rate: float


class AlertSchema(BaseModel):
    zone_id: str
    level: str
    count: float
    capacity: int
    density_pct: float
    growth_rate: float
    message: str


class DensityPayload(BaseModel):
    timestamp: int
    venue_id: str
    total_count: float
    venue_capacity: int
    grid: dict
    alerts: list[AlertSchema]


class IncidentCreate(BaseModel):
    zone_id: str
    level: str
    density_at_trigger: float
    growth_rate_at_trigger: float


class IncidentUpdate(BaseModel):
    status: Optional[str] = None
    guard_id: Optional[int] = None
    notes: Optional[str] = None


class IncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    zone_id: str
    venue_id: str
    level: str
    density_at_trigger: float
    growth_rate_at_trigger: float
    guard_id: Optional[int]
    status: str
    opened_at: str
    assigned_at: Optional[str]
    resolved_at: Optional[str]
    notes: Optional[str]


class GuardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    badge_number: str
    status: str
    current_zone_id: Optional[str]


class GuardAssign(BaseModel):
    guard_id: int


class StreamControl(BaseModel):
    action: str
    speed: Optional[float] = None
