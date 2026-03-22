from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, '..', 'data', 'crowdshield.db')
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Guard(Base):
    __tablename__ = "guards"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    badge_number = Column(String, nullable=False, unique=True)
    status = Column(String, nullable=False, default="available")
    current_zone_id = Column(String, nullable=True)


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    zone_id = Column(String, nullable=False)
    venue_id = Column(String, nullable=False, default="festival_v1")
    level = Column(String, nullable=False)
    density_at_trigger = Column(Float)
    growth_rate_at_trigger = Column(Float)
    guard_id = Column(Integer, ForeignKey("guards.id"), nullable=True)
    status = Column(String, nullable=False, default="open")
    opened_at = Column(DateTime, default=datetime.utcnow)
    assigned_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)


class ZoneEvent(Base):
    __tablename__ = "zone_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    zone_id = Column(String, nullable=False)
    venue_id = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    count = Column(Float, nullable=False)
    level = Column(String, nullable=False)
    growth_rate = Column(Float, nullable=False)

GUARD_SEED_DATA = [
    {"name": "Marcus Webb",  "badge_number": "G-001"},
    {"name": "Sarah Chen",   "badge_number": "G-002"},
    {"name": "Devon Parks",  "badge_number": "G-003"},
    {"name": "Lila Torres",  "badge_number": "G-004"},
    {"name": "James Okoro",  "badge_number": "G-005"},
    {"name": "Priya Nair",   "badge_number": "G-006"},
    {"name": "Tyler Brooks", "badge_number": "G-007"},
    {"name": "Aisha Grant",  "badge_number": "G-008"},
]


def seed_guards(db):
    existing = db.query(Guard).first()
    if existing is None:
        for g in GUARD_SEED_DATA:
            db.add(Guard(name=g["name"], badge_number=g["badge_number"]))
        db.commit()
        print("Guards seeded successfully")


def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_guards(db)
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

