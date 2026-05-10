from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Literal
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import JWTError, jwt
import uuid

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_HOURS = int(os.environ.get("JWT_EXPIRATION_HOURS", "720"))

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="UK Driving Instructor & Student Portal API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============= MODELS =============
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    name: str = Field(..., min_length=1)
    role: Literal["instructor", "student"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    role: Literal["instructor", "student"]
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


# ============= AUTH UTILS =============
def hash_password(p: str) -> str:
    return pwd_context.hash(p)


def verify_password(p: str, h: str) -> bool:
    try:
        return pwd_context.verify(p, h)
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": int(exp.timestamp()),
        "iat": int(now.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise ValueError("Bad scheme")
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def to_public_user(u: dict) -> UserPublic:
    return UserPublic(
        id=u["id"],
        email=u["email"],
        name=u["name"],
        role=u["role"],
        created_at=u["created_at"],
    )


# ============= ROUTES =============
@api_router.get("/")
async def root():
    return {"message": "UK Driving Portal API", "status": "ok"}


@api_router.post("/auth/register", response_model=TokenResponse)
async def register(req: RegisterRequest):
    existing = await db.users.find_one({"email": req.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    user_doc = {
        "id": user_id,
        "email": req.email.lower(),
        "name": req.name,
        "role": req.role,
        "password": hash_password(req.password),
        "created_at": now,
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, req.email.lower(), req.role)
    return TokenResponse(
        access_token=token,
        user=UserPublic(id=user_id, email=req.email.lower(), name=req.name, role=req.role, created_at=now),
    )


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not verify_password(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"], user["role"])
    return TokenResponse(access_token=token, user=to_public_user(user))


@api_router.get("/auth/me", response_model=UserPublic)
async def me(current_user: dict = Depends(get_current_user)):
    return to_public_user(current_user)


@api_router.get("/health")
async def health():
    return {"status": "healthy"}


# ============= STARTUP: Seed Demo Accounts =============
async def seed_demo_users():
    demos = [
        {
            "email": "instructor@demo.uk",
            "name": "Alex Thompson",
            "role": "instructor",
            "password": "password123",
        },
        {
            "email": "student@demo.uk",
            "name": "Jamie Williams",
            "role": "student",
            "password": "password123",
        },
    ]
    for d in demos:
        existing = await db.users.find_one({"email": d["email"]})
        if not existing:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": d["email"],
                "name": d["name"],
                "role": d["role"],
                "password": hash_password(d["password"]),
                "created_at": datetime.now(timezone.utc),
            })
            logger.info(f"Seeded demo user: {d['email']}")


@app.on_event("startup")
async def startup_event():
    await db.users.create_index("email", unique=True)
    await seed_demo_users()


@app.on_event("shutdown")
async def shutdown_event():
    client.close()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
