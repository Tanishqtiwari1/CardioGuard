from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DEFAULT_DATABASE_PATH = os.path.join(BASE_DIR, "cardioguard.db")


def normalise_database_url(url: str) -> str:
    """Hosts give bare postgres:// or postgresql:// URLs. Name the driver this project installs (psycopg2),
    because SQLAlchemy 2.1 otherwise looks for psycopg, which isn't installed."""
    return re.sub(r"^postgres(?:ql)?://", "postgresql+psycopg2://", url.strip())


SQLALCHEMY_DATABASE_URL = normalise_database_url(os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DATABASE_PATH}"))

# pool_pre_ping replaces connections a hosted database closed while idle, so requests don't fail with a 500.
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in SQLALCHEMY_DATABASE_URL else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()