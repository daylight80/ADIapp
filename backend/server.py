from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Literal, List
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import JWTError, jwt
import uuid
import stripe
from lesson_reminders import start_lesson_reminder_scheduler, stop_lesson_reminder_scheduler

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_HOURS = int(os.environ.get("JWT_EXPIRATION_HOURS", "720"))
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
APP_DOMAIN = os.environ.get("APP_DOMAIN", "http://localhost:3000")
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
EMERGENT_LLM_KEY    = os.environ.get("EMERGENT_LLM_KEY", "")

# Stripe Price IDs per subscription tier (set in backend/.env)
STRIPE_PRICE_GROWTH         = os.environ.get("STRIPE_PRICE_GROWTH", "")
STRIPE_PRICE_PRO            = os.environ.get("STRIPE_PRICE_PRO", "")
STRIPE_PRICE_FRANCHISE_BASE = os.environ.get("STRIPE_PRICE_FRANCHISE_BASE", "")
STRIPE_PRICE_FRANCHISE_SEAT = os.environ.get("STRIPE_PRICE_FRANCHISE_SEAT", "")

# Supabase (used by webhook + Supabase-auth-bridge endpoints)
SUPABASE_URL              = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_JWT_SECRET       = os.environ.get("SUPABASE_JWT_SECRET", "")


def tier_to_line_items(tier: str, seat_count: int = 1):
    """Return the Stripe Checkout line_items list for a given subscription tier.

    For 'franchise', the school is billed:
        - £39.99/mo base (qty 1, always)
        - £10/mo per additional instructor beyond the first (qty = seat_count - 1)
    """
    tier = (tier or "").lower()
    if tier == "growth":
        if not STRIPE_PRICE_GROWTH:
            raise HTTPException(status_code=500, detail="STRIPE_PRICE_GROWTH is not configured")
        return [{"price": STRIPE_PRICE_GROWTH, "quantity": 1}]
    if tier == "pro":
        if not STRIPE_PRICE_PRO:
            raise HTTPException(status_code=500, detail="STRIPE_PRICE_PRO is not configured")
        return [{"price": STRIPE_PRICE_PRO, "quantity": 1}]
    if tier == "franchise":
        if not STRIPE_PRICE_FRANCHISE_BASE or not STRIPE_PRICE_FRANCHISE_SEAT:
            raise HTTPException(status_code=500, detail="STRIPE_PRICE_FRANCHISE_* prices are not configured")
        items = [{"price": STRIPE_PRICE_FRANCHISE_BASE, "quantity": 1}]
        # Extra instructors beyond the included one are billed via the seat price.
        extra_seats = max(0, int(seat_count) - 1)
        if extra_seats > 0:
            items.append({"price": STRIPE_PRICE_FRANCHISE_SEAT, "quantity": extra_seats})
        return items
    raise HTTPException(status_code=400, detail=f"Unknown tier: {tier}")


stripe.api_key = STRIPE_API_KEY

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="UK Driving Instructor & Student Portal API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_PRO_PRICE_ID: Optional[str] = None


# ============= MODELS =============
class RegisterInstructorRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    name: str = Field(..., min_length=1)
    adi_number: str = Field(..., min_length=4, max_length=12, description="DVSA ADI number")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    role: Literal["instructor", "student"]
    adi_number: Optional[str] = None
    invited_by_adi: Optional[str] = None
    subscription_status: Literal["free", "pro", "past_due", "canceled"] = "free"
    stripe_customer_id: Optional[str] = None
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class InviteStudentRequest(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=1)
    phone: Optional[str] = None


class InviteResponse(BaseModel):
    invite_token: str
    invite_url: str
    expires_at: datetime


class InvitePreview(BaseModel):
    email: str
    name: str
    instructor_name: str
    instructor_adi: str
    expires_at: datetime


class AcceptInviteRequest(BaseModel):
    invite_token: str
    password: str = Field(..., min_length=6)


class CheckoutSessionRequest(BaseModel):
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    tier: Optional[Literal["growth", "pro", "franchise"]] = None
    seat_count: Optional[int] = 1


class CheckoutSessionResponse(BaseModel):
    url: str


# ============= UTILS =============
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
    return jwt.encode(
        {"sub": user_id, "email": email, "role": role, "exp": int(exp.timestamp()), "iat": int(now.timestamp())},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def create_invite_token(email: str, name: str, adi: str, instructor_name: str, phone: Optional[str]) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(days=7)
    payload = {
        "kind": "invite",
        "email": email.lower(),
        "name": name,
        "phone": phone,
        "instructor_adi": adi,
        "instructor_name": instructor_name,
        "exp": int(exp.timestamp()),
        "iat": int(now.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM), exp


def decode_invite(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("kind") != "invite":
            raise HTTPException(status_code=400, detail="Not an invite token")
        return payload
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired invite link")


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


# Accepts EITHER a legacy Mongo-issued JWT (get_current_user) OR a Supabase
# Auth bearer token (get_current_supabase_user). Used by endpoints we want to
# work from both old demo accounts and the new Supabase-only accounts.
async def get_current_user_any(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    # Try legacy Mongo JWT first (fast — pure JWT decode, no network).
    try:
        scheme, token = authorization.split()
        if scheme.lower() == "bearer":
            try:
                payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
                user_id = payload.get("sub")
                if user_id:
                    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
                    if user:
                        return {"source": "legacy", **user}
            except JWTError:
                pass
    except ValueError:
        pass
    # Fall back to Supabase Auth token verification (network round-trip).
    try:
        sb_user = await get_current_supabase_user(authorization)
        return {"source": "supabase", **sb_user}
    except HTTPException:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def to_public_user(u: dict) -> UserPublic:
    return UserPublic(
        id=u["id"],
        email=u["email"],
        name=u["name"],
        role=u["role"],
        adi_number=u.get("adi_number"),
        invited_by_adi=u.get("invited_by_adi"),
        subscription_status=u.get("subscription_status", "free"),
        stripe_customer_id=u.get("stripe_customer_id"),
        created_at=u["created_at"],
    )


# ============= AUTH ROUTES =============
@api_router.get("/")
async def root():
    return {"message": "UK Driving Portal API", "status": "ok"}


@api_router.post("/auth/register", response_model=TokenResponse)
async def register_instructor(req: RegisterInstructorRequest):
    """Instructor self-registration. Students must be invited."""
    adi = req.adi_number.strip()
    existing_email = await db.users.find_one({"email": req.email.lower()})
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")
    existing_adi = await db.users.find_one({"adi_number": adi})
    if existing_adi:
        raise HTTPException(status_code=400, detail="An instructor with this ADI number already exists")

    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    user_doc = {
        "id": user_id,
        "email": req.email.lower(),
        "name": req.name,
        "role": "instructor",
        "adi_number": adi,
        "invited_by_adi": None,
        "password": hash_password(req.password),
        "subscription_status": "free",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "created_at": now,
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, req.email.lower(), "instructor")
    return TokenResponse(access_token=token, user=to_public_user(user_doc))


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


# ============= INVITES =============
@api_router.post("/instructor/invite-student", response_model=InviteResponse)
async def invite_student(req: InviteStudentRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "instructor":
        raise HTTPException(status_code=403, detail="Only instructors can invite students")
    if not current_user.get("adi_number"):
        raise HTTPException(status_code=400, detail="Set your ADI number first")
    # Reject if a user already exists for that email
    existing = await db.users.find_one({"email": req.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="A user with this email already exists")
    token, exp = create_invite_token(
        email=req.email,
        name=req.name,
        adi=current_user["adi_number"],
        instructor_name=current_user["name"],
        phone=req.phone,
    )
    invite_url = f"{APP_DOMAIN}/sign-up-login-screen?invite={token}"
    return InviteResponse(invite_token=token, invite_url=invite_url, expires_at=exp)


@api_router.get("/auth/invite/{token}", response_model=InvitePreview)
async def preview_invite(token: str):
    payload = decode_invite(token)
    return InvitePreview(
        email=payload["email"],
        name=payload["name"],
        instructor_name=payload["instructor_name"],
        instructor_adi=payload["instructor_adi"],
        expires_at=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
    )


@api_router.post("/auth/accept-invite", response_model=TokenResponse)
async def accept_invite(req: AcceptInviteRequest):
    payload = decode_invite(req.invite_token)
    email = payload["email"]
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="This invite has already been used")

    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    user_doc = {
        "id": user_id,
        "email": email,
        "name": payload["name"],
        "role": "student",
        "adi_number": None,
        "invited_by_adi": payload["instructor_adi"],
        "phone": payload.get("phone"),
        "password": hash_password(req.password),
        "subscription_status": "free",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "created_at": now,
    }
    await db.users.insert_one(user_doc)
    access = create_access_token(user_id, email, "student")
    return TokenResponse(access_token=access, user=to_public_user(user_doc))


# ============= STRIPE BILLING (unchanged from previous iteration) =============
async def get_or_create_pro_price() -> str:
    global _PRO_PRICE_ID
    if _PRO_PRICE_ID:
        return _PRO_PRICE_ID
    try:
        products = stripe.Product.list(limit=100, active=True)
        product_id = None
        for p in products.data:
            if p.metadata.get("plan_key") == "drivehub_pro_monthly":
                product_id = p.id
                break
        if not product_id:
            product = stripe.Product.create(
                name="DriveHub UK Pro",
                description="Unlimited students, invoicing, push notifications.",
                metadata={"plan_key": "drivehub_pro_monthly"},
            )
            product_id = product.id
        prices = stripe.Price.list(product=product_id, active=True, limit=100)
        for pr in prices.data:
            if pr.recurring and pr.recurring.get("interval") == "month" and pr.unit_amount == 999 and pr.currency == "gbp":
                _PRO_PRICE_ID = pr.id
                return pr.id
        price = stripe.Price.create(
            unit_amount=999, currency="gbp", recurring={"interval": "month"}, product=product_id,
            metadata={"plan_key": "drivehub_pro_monthly"},
        )
        _PRO_PRICE_ID = price.id
        return price.id
    except Exception as e:
        logger.error(f"Failed to set up Stripe price: {e}")
        raise HTTPException(status_code=500, detail="Billing not configured")


@api_router.post("/billing/create-checkout-session", response_model=CheckoutSessionResponse)
async def create_checkout_session(req: CheckoutSessionRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "instructor":
        raise HTTPException(status_code=403, detail="Only instructors can subscribe")

    tier = (req.tier or "pro").lower()
    seat_count = max(1, int(req.seat_count or 1))

    # Don't let users buy the same tier twice if it's already active
    if current_user.get("subscription_status") == tier:
        raise HTTPException(status_code=400, detail=f"You already have an active {tier.capitalize()} subscription")

    line_items = tier_to_line_items(tier, seat_count=seat_count)

    customer_id = current_user.get("stripe_customer_id")
    if not customer_id:
        customer = stripe.Customer.create(email=current_user["email"], name=current_user["name"], metadata={"user_id": current_user["id"]})
        customer_id = customer.id
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"stripe_customer_id": customer_id}})
    success_url = (req.success_url or f"{APP_DOMAIN}/pricing-screen") + "?status=success&session_id={CHECKOUT_SESSION_ID}"
    cancel_url = req.cancel_url or f"{APP_DOMAIN}/pricing-screen?status=cancelled"
    session = stripe.checkout.Session.create(
        customer=customer_id, mode="subscription", payment_method_types=["card"],
        line_items=line_items,
        success_url=success_url, cancel_url=cancel_url,
        client_reference_id=current_user["id"],
        metadata={"user_id": current_user["id"], "tier": tier, "seat_count": seat_count},
        subscription_data={"metadata": {"user_id": current_user["id"], "tier": tier}},
    )
    return CheckoutSessionResponse(url=session.url)


@api_router.get("/billing/subscription-status")
async def subscription_status(current_user: dict = Depends(get_current_user)):
    return {"subscription_status": current_user.get("subscription_status", "free"), "stripe_customer_id": current_user.get("stripe_customer_id")}


@api_router.post("/billing/verify-session")
async def verify_session(payload: dict, current_user: dict = Depends(get_current_user)):
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    session = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
    if session.client_reference_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Session does not belong to you")
    if session.payment_status == "paid" and session.subscription:
        sub = session.subscription
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"subscription_status": "pro", "stripe_subscription_id": sub["id"] if isinstance(sub, dict) else sub.id, "subscription_started_at": datetime.now(timezone.utc)}},
        )
        return {"subscription_status": "pro", "verified": True}
    return {"subscription_status": current_user.get("subscription_status", "free"), "verified": False}


@api_router.post("/billing/create-portal-session", response_model=CheckoutSessionResponse)
async def create_portal_session(current_user: dict = Depends(get_current_user)):
    customer_id = current_user.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer for this user")
    session = stripe.billing_portal.Session.create(customer=customer_id, return_url=f"{APP_DOMAIN}/home-screen")
    return CheckoutSessionResponse(url=session.url)


@api_router.post("/billing/cancel-mock")
async def cancel_mock(current_user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"subscription_status": "free", "stripe_subscription_id": None}})
    return {"subscription_status": "free"}


# ============= MAPS / TRAVEL TIME =============
import httpx
import hashlib

_travel_cache: dict[str, tuple[float, dict]] = {}
TRAVEL_CACHE_TTL = 300  # 5 minutes


class TravelTimeRequest(BaseModel):
    origin: str = Field(..., min_length=3)
    destination: str = Field(..., min_length=3)
    departure_at: Optional[datetime] = None


class TravelTimeResponse(BaseModel):
    duration_minutes: int
    duration_in_traffic_minutes: int
    distance_km: float
    status: Literal["ok", "fallback", "no_route", "error"]
    cached: bool = False


def _mock_travel(origin: str, destination: str) -> dict:
    """Deterministic mock travel time based on string hash. Used when no Google key set."""
    h = int(hashlib.sha256(f"{origin}|{destination}".encode()).hexdigest(), 16)
    base = 8 + (h % 28)  # 8 to 35 min base
    traffic = base + 1 + (h % 9)  # add 1-9 mins for traffic
    distance = round(base * 0.7 + (h % 5), 1)  # rough km estimate
    return {
        "duration_minutes": base,
        "duration_in_traffic_minutes": traffic,
        "distance_km": distance,
        "status": "fallback",
    }


@api_router.post("/maps/travel-time", response_model=TravelTimeResponse)
async def travel_time(req: TravelTimeRequest, current_user: dict = Depends(get_current_user_any)):
    cache_key = f"{req.origin.lower().strip()}|{req.destination.lower().strip()}"
    now_ts = datetime.now(timezone.utc).timestamp()

    # Cache hit
    if cache_key in _travel_cache:
        ts, data = _travel_cache[cache_key]
        if now_ts - ts < TRAVEL_CACHE_TTL:
            return TravelTimeResponse(**{**data, "cached": True})

    # No key → mock fallback (still cached so the diary doesn't flicker)
    if not GOOGLE_MAPS_API_KEY:
        data = _mock_travel(req.origin, req.destination)
        _travel_cache[cache_key] = (now_ts, data)
        return TravelTimeResponse(**data, cached=False)

    # Live Google Distance Matrix API
    departure = int((req.departure_at or datetime.now(timezone.utc)).timestamp())
    params = {
        "origins": req.origin,
        "destinations": req.destination,
        "mode": "driving",
        "units": "metric",
        "departure_time": max(departure, int(now_ts)),  # must be now or future
        "traffic_model": "best_guess",
        "region": "uk",
        "key": GOOGLE_MAPS_API_KEY,
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client_h:
            r = await client_h.get("https://maps.googleapis.com/maps/api/distancematrix/json", params=params)
            r.raise_for_status()
            body = r.json()
    except Exception as e:
        logger.warning(f"Google Maps API failed, using fallback: {e}")
        data = _mock_travel(req.origin, req.destination)
        _travel_cache[cache_key] = (now_ts, data)
        return TravelTimeResponse(**data)

    try:
        top = body["rows"][0]["elements"][0]
        if top["status"] != "OK":
            data = {**_mock_travel(req.origin, req.destination), "status": "no_route"}
            _travel_cache[cache_key] = (now_ts, data)
            return TravelTimeResponse(**data)
        normal_sec = top["duration"]["value"]
        traffic_sec = top.get("duration_in_traffic", top["duration"])["value"]
        dist_m = top["distance"]["value"]
        data = {
            "duration_minutes": int(round(normal_sec / 60)),
            "duration_in_traffic_minutes": int(round(traffic_sec / 60)),
            "distance_km": round(dist_m / 1000, 1),
            "status": "ok",
        }
        _travel_cache[cache_key] = (now_ts, data)
        return TravelTimeResponse(**data)
    except Exception as e:
        logger.error(f"Failed to parse Distance Matrix response: {e}")
        data = {**_mock_travel(req.origin, req.destination), "status": "error"}
        return TravelTimeResponse(**data)


@api_router.post("/billing/webhook-legacy")
async def stripe_webhook_legacy(request: Request):
    """Deprecated. Kept only for the legacy MongoDB-auth flow. The new
    Supabase tier-aware handler is registered below as /api/billing/webhook."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
        else:
            import json
            event = json.loads(payload.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid webhook: {e}")
    event_type = event.get("type") if isinstance(event, dict) else event.type
    data_object = event["data"]["object"] if isinstance(event, dict) else event.data.object
    if event_type == "checkout.session.completed":
        user_id = data_object.get("client_reference_id") or data_object.get("metadata", {}).get("user_id")
        if user_id:
            await db.users.update_one({"id": user_id}, {"$set": {"subscription_status": "pro", "stripe_subscription_id": data_object.get("subscription"), "subscription_started_at": datetime.now(timezone.utc)}})
    elif event_type == "customer.subscription.deleted":
        customer_id = data_object.get("customer")
        await db.users.update_one({"stripe_customer_id": customer_id}, {"$set": {"subscription_status": "canceled"}})
    elif event_type == "invoice.payment_failed":
        customer_id = data_object.get("customer")
        await db.users.update_one({"stripe_customer_id": customer_id}, {"$set": {"subscription_status": "past_due"}})
    return {"status": "received"}


# ============= STARTUP =============
async def seed_demo_users():
    instructor = await db.users.find_one({"email": "instructor@demo.uk"})
    if not instructor:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": "instructor@demo.uk",
            "name": "Alex Thompson",
            "role": "instructor",
            "adi_number": "123456",
            "invited_by_adi": None,
            "password": hash_password("password123"),
            "subscription_status": "free",
            "stripe_customer_id": None,
            "stripe_subscription_id": None,
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded demo instructor with ADI 123456")
    else:
        # Backfill ADI if missing
        if not instructor.get("adi_number"):
            await db.users.update_one({"id": instructor["id"]}, {"$set": {"adi_number": "123456"}})

    student = await db.users.find_one({"email": "student@demo.uk"})
    if not student:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": "student@demo.uk",
            "name": "Jamie Williams",
            "role": "student",
            "adi_number": None,
            "invited_by_adi": "123456",
            "password": hash_password("password123"),
            "subscription_status": "free",
            "stripe_customer_id": None,
            "stripe_subscription_id": None,
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded demo student linked to ADI 123456")
    else:
        if not student.get("invited_by_adi"):
            await db.users.update_one({"id": student["id"]}, {"$set": {"invited_by_adi": "123456"}})


@app.on_event("startup")
async def startup_event():
    await db.users.create_index("email", unique=True)
    # Partial unique index: only index documents where adi_number is a string.
    # Plain sparse=True doesn't help here because docs with adi_number:null are
    # still indexed and collide on subsequent inserts.
    existing_indexes = await db.users.index_information()
    if "adi_number_1" in existing_indexes:
        opts = existing_indexes["adi_number_1"]
        if not opts.get("partialFilterExpression"):
            await db.users.drop_index("adi_number_1")
    await db.users.create_index(
        "adi_number",
        unique=True,
        partialFilterExpression={"adi_number": {"$type": "string"}},
        name="adi_number_1",
    )
    await seed_demo_users()
    # Kick off the lesson-reminder scheduler — fires push notifications to
    # students 48 h, 25 h, and 1 h before each lesson.
    start_lesson_reminder_scheduler()


@app.on_event("shutdown")
async def shutdown_event():
    client.close()
    stop_lesson_reminder_scheduler()


# ============================================================================
# SUPABASE BRIDGE — verifier + service-role REST helpers
# ============================================================================
# This block lets the FastAPI backend speak to the Supabase project for
# tier-aware Stripe operations. Two surfaces:
#   1) get_current_supabase_user — verifies the JWT issued by Supabase Auth
#      (HS256, signed with SUPABASE_JWT_SECRET). Returns the auth user id +
#      a freshly-fetched driving_schools row for the owner.
#   2) sb_* helpers — service-role HTTP calls (bypass RLS) for the webhook
#      and seat-sync endpoint to update driving_schools.
# ============================================================================

from fastapi import Request as FastAPIRequest

_sb_rest_base = f"{SUPABASE_URL.rstrip('/')}/rest/v1" if SUPABASE_URL else ""

def _sb_headers(prefer: str = "") -> dict:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="SUPABASE_SERVICE_ROLE_KEY is not configured")
    h = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


async def sb_get_school_by_auth_user(auth_user_id: str) -> Optional[dict]:
    """Return the driving_schools row owned by the given auth user, or None."""
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.get(
            f"{_sb_rest_base}/driving_schools",
            params={"owner_auth_id": f"eq.{auth_user_id}", "select": "*", "limit": "1"},
            headers=_sb_headers(),
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Supabase read failed: {r.text}")
    rows = r.json()
    return rows[0] if rows else None


async def sb_get_school_by_customer(stripe_customer_id: str) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.get(
            f"{_sb_rest_base}/driving_schools",
            params={"stripe_customer_id": f"eq.{stripe_customer_id}", "select": "*", "limit": "1"},
            headers=_sb_headers(),
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Supabase read failed: {r.text}")
    rows = r.json()
    return rows[0] if rows else None


async def sb_update_school(school_id: str, patch: dict) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.patch(
            f"{_sb_rest_base}/driving_schools",
            params={"id": f"eq.{school_id}"},
            headers=_sb_headers(prefer="return=representation"),
            json=patch,
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Supabase write failed: {r.text}")
    rows = r.json()
    return rows[0] if rows else {}


async def get_current_supabase_user(authorization: Optional[str] = Header(None)) -> dict:
    """FastAPI dependency: verify a Supabase Auth token by asking Supabase's
    /auth/v1/user endpoint. Avoids us having to track ES256 JWKS rotation."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.get(
            f"{SUPABASE_URL.rstrip('/')}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_SERVICE_ROLE_KEY},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail=f"Invalid Supabase token: {r.text[:140]}")
    user = r.json()
    auth_user_id = user.get("id")
    email = user.get("email")
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="Supabase token missing user id")
    school = await sb_get_school_by_auth_user(auth_user_id)
    return {"auth_user_id": auth_user_id, "email": email, "school": school, "user": user}


# ============================================================================
# NEW TIER-AWARE BILLING ENDPOINTS (Supabase-authenticated)
# ============================================================================

class CheckoutV2Request(BaseModel):
    tier: Literal["growth", "pro", "franchise"]
    seat_count: Optional[int] = 1
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


@api_router.post("/v2/billing/checkout", response_model=CheckoutSessionResponse)
async def billing_v2_checkout(req: CheckoutV2Request, sb_user: dict = Depends(get_current_supabase_user)):
    if not sb_user.get("school"):
        raise HTTPException(status_code=400, detail="No driving school linked to this auth user")
    school = sb_user["school"]
    seat_count = max(1, int(req.seat_count or school.get("seat_count") or 1))

    if school.get("tier") == req.tier:
        raise HTTPException(status_code=400, detail=f"You already have an active {req.tier.capitalize()} subscription")

    # Ensure a Stripe customer exists
    customer_id = school.get("stripe_customer_id")
    if not customer_id:
        customer = stripe.Customer.create(
            email=sb_user.get("email"),
            name=school.get("business_name"),
            metadata={"school_id": school["id"], "auth_user_id": sb_user["auth_user_id"]},
        )
        customer_id = customer.id
        await sb_update_school(school["id"], {"stripe_customer_id": customer_id})

    success_url = (req.success_url or f"{APP_DOMAIN}/pricing-screen") + "?status=success&session_id={CHECKOUT_SESSION_ID}"
    cancel_url = req.cancel_url or f"{APP_DOMAIN}/pricing-screen?status=cancelled"

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        payment_method_types=["card"],
        line_items=tier_to_line_items(req.tier, seat_count=seat_count),
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=school["id"],
        metadata={"school_id": school["id"], "tier": req.tier, "seat_count": seat_count},
        subscription_data={"metadata": {"school_id": school["id"], "tier": req.tier}},
    )
    return CheckoutSessionResponse(url=session.url)


@api_router.post("/v2/billing/portal", response_model=CheckoutSessionResponse)
async def billing_v2_portal(sb_user: dict = Depends(get_current_supabase_user)):
    school = sb_user.get("school")
    if not school or not school.get("stripe_customer_id"):
        raise HTTPException(status_code=400, detail="No Stripe customer for this school yet")
    session = stripe.billing_portal.Session.create(
        customer=school["stripe_customer_id"],
        return_url=f"{APP_DOMAIN}/pricing-screen",
    )
    return CheckoutSessionResponse(url=session.url)


@api_router.post("/v2/billing/sync-seats")
async def billing_v2_sync_seats(sb_user: dict = Depends(get_current_supabase_user)):
    """Re-sync the Franchise seat-count to Stripe based on driving_schools.seat_count.

    Call this whenever a school owner adds or removes an instructor. The DB
    trigger has already updated seat_count; we just need to push the new
    quantity to the Stripe subscription item that uses the seat price.
    """
    school = sb_user.get("school")
    if not school:
        raise HTTPException(status_code=400, detail="No school for this user")
    if school.get("tier") != "franchise":
        return {"updated": False, "reason": "Only Franchise tier uses per-seat billing"}
    if not school.get("stripe_subscription_id"):
        return {"updated": False, "reason": "No active subscription"}

    sub_id = school["stripe_subscription_id"]
    seat_count = max(1, int(school.get("seat_count") or 1))
    target_seat_qty = max(0, seat_count - 1)

    # Find the subscription item using the seat price
    sub = stripe.Subscription.retrieve(sub_id, expand=["items.data.price"])
    seat_item = None
    for item in sub["items"]["data"]:
        if item["price"]["id"] == STRIPE_PRICE_FRANCHISE_SEAT:
            seat_item = item
            break

    if seat_item is None and target_seat_qty > 0:
        # Add the seat line item now
        seat_item = stripe.SubscriptionItem.create(
            subscription=sub_id, price=STRIPE_PRICE_FRANCHISE_SEAT, quantity=target_seat_qty,
        )
        return {"updated": True, "action": "added", "quantity": target_seat_qty}

    if seat_item is not None:
        if target_seat_qty == 0:
            stripe.SubscriptionItem.delete(seat_item["id"])
            return {"updated": True, "action": "removed", "quantity": 0}
        if int(seat_item.get("quantity") or 0) != target_seat_qty:
            stripe.SubscriptionItem.modify(seat_item["id"], quantity=target_seat_qty, proration_behavior="create_prorations")
            return {"updated": True, "action": "updated", "quantity": target_seat_qty}

    return {"updated": False, "quantity": target_seat_qty}


# ============================================================================
# STRIPE WEBHOOK — syncs Stripe → driving_schools
# ============================================================================

def _tier_from_price_id(price_id: str) -> Optional[str]:
    if price_id == STRIPE_PRICE_GROWTH:           return "growth"
    if price_id == STRIPE_PRICE_PRO:              return "pro"
    if price_id == STRIPE_PRICE_FRANCHISE_BASE:   return "franchise"
    if price_id == STRIPE_PRICE_FRANCHISE_SEAT:   return "franchise"
    return None


def _tier_from_subscription(sub: dict) -> Optional[str]:
    """Inspect a Stripe Subscription object and return our internal tier name."""
    items = (sub.get("items") or {}).get("data") or []
    for it in items:
        pid = (it.get("price") or {}).get("id")
        t = _tier_from_price_id(pid)
        if t:
            return t
    return None


def _seat_qty_from_subscription(sub: dict) -> int:
    items = (sub.get("items") or {}).get("data") or []
    base_qty = 0
    seat_qty = 0
    for it in items:
        pid = (it.get("price") or {}).get("id")
        q = int(it.get("quantity") or 0)
        if pid == STRIPE_PRICE_FRANCHISE_BASE: base_qty = q
        elif pid == STRIPE_PRICE_FRANCHISE_SEAT: seat_qty = q
    return max(1, base_qty + seat_qty)


@api_router.post("/billing/webhook")
async def stripe_webhook(request: FastAPIRequest):
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="STRIPE_WEBHOOK_SECRET not configured")
    payload = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid Stripe signature: {e}")

    etype = event["type"]
    data = event["data"]["object"]

    try:
        if etype == "checkout.session.completed":
            school_id = (data.get("metadata") or {}).get("school_id") or data.get("client_reference_id")
            sub_id = data.get("subscription")
            if school_id and sub_id:
                sub = stripe.Subscription.retrieve(sub_id, expand=["items.data.price"])
                patch = {
                    "tier": _tier_from_subscription(sub) or "pro",
                    "subscription_status": "active",
                    "stripe_subscription_id": sub_id,
                    "seat_count": _seat_qty_from_subscription(sub),
                    "current_period_end": datetime.fromtimestamp(sub["current_period_end"], tz=timezone.utc).isoformat() if sub.get("current_period_end") else None,
                    "stripe_customer_id": data.get("customer"),
                }
                await sb_update_school(school_id, patch)

        elif etype in ("customer.subscription.updated", "customer.subscription.created"):
            customer_id = data.get("customer")
            if customer_id:
                school = await sb_get_school_by_customer(customer_id)
                if school:
                    patch = {
                        "tier": _tier_from_subscription(data) or school.get("tier") or "pro",
                        "subscription_status": data.get("status") or "active",
                        "stripe_subscription_id": data.get("id"),
                        "seat_count": _seat_qty_from_subscription(data),
                        "current_period_end": datetime.fromtimestamp(data["current_period_end"], tz=timezone.utc).isoformat() if data.get("current_period_end") else None,
                    }
                    await sb_update_school(school["id"], patch)

        elif etype == "customer.subscription.deleted":
            customer_id = data.get("customer")
            if customer_id:
                school = await sb_get_school_by_customer(customer_id)
                if school:
                    await sb_update_school(school["id"], {
                        "tier": "starter",
                        "subscription_status": "cancelled",
                        "stripe_subscription_id": None,
                        "current_period_end": None,
                    })

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Stripe webhook handler failed: %s", e)
        return {"received": True, "handled": False, "error": str(e)}

    return {"received": True, "handled": True, "type": etype}


# ============================================================================
# STUDENT INVITE EMAIL — via Supabase Auth (built-in email provider)
# ============================================================================

class StudentInviteRequest(BaseModel):
    email: EmailStr
    student_name: Optional[str] = None
    student_id: Optional[str] = None  # the existing students.id row in Supabase

class StudentInviteResponse(BaseModel):
    sent: bool
    email: str
    detail: Optional[str] = None


@api_router.post("/v2/students/invite", response_model=StudentInviteResponse)
async def v2_invite_student(req: StudentInviteRequest, sb_user: dict = Depends(get_current_supabase_user)):
    """Send a Supabase Auth invite email to the given address. Uses the
    school owner's auth context, and stamps the invitee with role=student
    plus the inviting instructor/school metadata so AuthContext can wire
    them up automatically when they accept."""
    if not sb_user.get("school"):
        raise HTTPException(status_code=400, detail="No driving school linked to this auth user")

    school = sb_user["school"]
    instructor_id = None
    # Look up instructor row for this auth user (school owner is usually
    # also an instructor — see ensureInstructorBootstrap in AuthContext)
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        ir = await client_http.get(
            f"{_sb_rest_base}/instructors",
            params={"auth_user_id": f"eq.{sb_user['auth_user_id']}", "select": "id,full_name", "limit": "1"},
            headers=_sb_headers(),
        )
    if ir.status_code < 400 and ir.json():
        instructor_row = ir.json()[0]
        instructor_id = instructor_row["id"]
        inviter_name = instructor_row.get("full_name") or school.get("business_name")
    else:
        inviter_name = school.get("business_name") or "Your driving instructor"

    redirect_to = f"{APP_DOMAIN}/?invite_accept=1"

    payload = {
        "email": str(req.email),
        "data": {
            "role": "student",
            "name": req.student_name or str(req.email).split("@")[0],
            "school_id": school["id"],
            "instructor_id": instructor_id,
            "student_id": req.student_id,
            "inviter_name": inviter_name,
        },
        "redirect_to": redirect_to,
    }

    async with httpx.AsyncClient(timeout=15.0) as client_http:
        r = await client_http.post(
            f"{SUPABASE_URL.rstrip('/')}/auth/v1/invite",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if r.status_code >= 400:
        # Supabase commonly returns 422 if the email already has an active user.
        # In that case we still consider the invite "issued" — they already
        # have credentials and can sign in.
        body = r.text[:240]
        if "already" in body.lower():
            return StudentInviteResponse(sent=False, email=str(req.email), detail="Email already has an active account — they can sign in directly.")
        raise HTTPException(status_code=502, detail=f"Supabase invite failed: {body}")

    return StudentInviteResponse(sent=True, email=str(req.email), detail=f"Invite email sent to {req.email}.")


# =============================================================================
# Smart Gap Broadcast — fan out real Expo Push notifications to learners on
# the school's waiting_list when a lesson is cancelled.
# =============================================================================
class GapBroadcastRequest(BaseModel):
    lesson_id: str
    title: Optional[str] = None
    body: Optional[str] = None


class GapBroadcastResponse(BaseModel):
    sent: int
    skipped: int
    detail: str


@api_router.post("/broadcasts/gap", response_model=GapBroadcastResponse)
async def broadcast_gap(req: GapBroadcastRequest, sb_user: dict = Depends(get_current_supabase_user)):
    """Notify every learner on the active waiting_list for this lesson's school
    that a slot has just opened up. Returns counts of sent vs skipped.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase service role key not configured")

    # 1. Look up the lesson to derive school_id (via instructors FK) + a default message body.
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.get(
            f"{_sb_rest_base}/lessons",
            params={
                "id": f"eq.{req.lesson_id}",
                "select": "id,instructor_id,start_time,end_time,topic,instructors(school_id)",
                "limit": "1",
            },
            headers=_sb_headers(),
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Lesson lookup failed: {r.text}")
    rows = r.json()
    if not rows:
        raise HTTPException(status_code=404, detail="Lesson not found")
    lesson = rows[0]
    lesson_school_id = (lesson.get("instructors") or {}).get("school_id")
    if not lesson_school_id:
        raise HTTPException(status_code=500, detail="Lesson is missing its instructor → school link")

    # 2. Verify the caller actually owns this lesson's school.
    school = sb_user.get("school") or await sb_get_school_by_auth_user(sb_user["auth_user_id"])
    if not school or school["id"] != lesson_school_id:
        raise HTTPException(status_code=403, detail="Not your lesson")

    # 3. Pull the active waiting_list with each student's auth_user_id.
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        wl = await client_http.get(
            f"{_sb_rest_base}/waiting_list",
            params={
                "school_id": f"eq.{lesson_school_id}",
                "active": "eq.true",
                "select": "student_id,students(id,auth_user_id,full_name)",
            },
            headers=_sb_headers(),
        )
    if wl.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Waiting list read failed: {wl.text}")
    rows = wl.json()
    auth_ids = [row["students"]["auth_user_id"] for row in rows if row.get("students") and row["students"].get("auth_user_id")]
    if not auth_ids:
        return GapBroadcastResponse(sent=0, skipped=0, detail="No one is on the waiting list yet.")

    # 4. Fetch push tokens for those users.
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        pt = await client_http.get(
            f"{_sb_rest_base}/push_tokens",
            params={
                "auth_user_id": f"in.({','.join(auth_ids)})",
                "select": "auth_user_id,expo_token",
            },
            headers=_sb_headers(),
        )
    if pt.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Push tokens read failed: {pt.text}")
    tokens = [row["expo_token"] for row in pt.json() if row.get("expo_token")]
    skipped = len(auth_ids) - len({row["auth_user_id"] for row in pt.json()})

    if not tokens:
        return GapBroadcastResponse(sent=0, skipped=skipped, detail="Waiting-list members have no push tokens yet.")

    # start_time / end_time are full ISO timestamptz strings — derive date + HH:MM.
    start_ts = lesson.get("start_time") or ""
    end_ts   = lesson.get("end_time") or ""
    lesson_date = start_ts.split("T")[0] if "T" in start_ts else start_ts
    start_hhmm  = start_ts.split("T")[1][:5] if "T" in start_ts else start_ts
    end_hhmm    = end_ts.split("T")[1][:5]   if "T" in end_ts   else end_ts

    title = req.title or "Lesson slot just opened!"
    body  = req.body  or (
        f"A {start_hhmm}–{end_hhmm} slot has just freed up on "
        f"{lesson_date}. Open ADI Pro to grab it before it's gone."
    )

    # 5. Fan out to Expo Push API in a single batched POST.
    messages = [{
        "to": tok,
        "title": title,
        "body": body,
        "sound": "default",
        "priority": "high",
        "data": {"type": "gap_broadcast", "lesson_id": req.lesson_id},
    } for tok in tokens]

    sent = 0
    try:
        async with httpx.AsyncClient(timeout=15.0) as client_http:
            resp = await client_http.post(
                "https://exp.host/--/api/v2/push/send",
                json=messages,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        if resp.status_code < 400:
            data = resp.json().get("data", [])
            sent = sum(1 for r in data if r.get("status") == "ok")
        else:
            logging.warning(f"Expo Push HTTP {resp.status_code}: {resp.text}")
    except Exception as e:
        logging.exception("Expo Push fan-out failed")
        raise HTTPException(status_code=502, detail=f"Expo Push fan-out failed: {e}")

    return GapBroadcastResponse(
        sent=sent,
        skipped=skipped + (len(tokens) - sent),
        detail=f"Notified {sent} of {len(auth_ids)} waiting-list learner(s).",
    )


# =============================================================================
# Multi-instructor — Owner-only invite + school-wide leaderboard
# =============================================================================
class InstructorInviteRequest(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    adi_number: Optional[str] = None


class InstructorInviteResponse(BaseModel):
    sent: bool
    email: str
    detail: str


async def _is_school_owner(sb_user: dict) -> bool:
    """True if the signed-in auth user is the owner of their driving school."""
    school = sb_user.get("school")
    if not school:
        school = await sb_get_school_by_auth_user(sb_user["auth_user_id"])
    return bool(school and school.get("owner_auth_id") == sb_user["auth_user_id"])


@api_router.post("/v2/instructors/invite", response_model=InstructorInviteResponse)
async def v2_invite_instructor(
    req: InstructorInviteRequest,
    sb_user: dict = Depends(get_current_supabase_user),
):
    """Owner-only: invite a new sub-instructor to the school. Sends a Supabase
    Auth invite email with role=instructor + school_id in metadata so the
    AuthContext bootstrap creates the instructor row on first sign-in."""
    if not await _is_school_owner(sb_user):
        raise HTTPException(status_code=403, detail="Only the school owner can invite instructors")

    school = sb_user["school"]

    # Pre-flight: refuse early (before sending an invite email) if the school's
    # current tier doesn't permit another instructor seat. The DB trigger would
    # block the eventual INSERT anyway, but failing here yields a much nicer
    # message and avoids polluting the auth invite log.
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        cr = await client_http.post(
            f"{_sb_rest_base}/rpc/can_add_instructor",
            headers={**_sb_headers(), "Content-Type": "application/json"},
            json={"school": school["id"]},
        )
    if cr.status_code < 400:
        allowed = bool(cr.json())
        if not allowed:
            current_tier = (school.get("tier") or "starter").lower()
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Your '{current_tier}' tier only allows 1 instructor seat. "
                    "Upgrade to the Franchise tier to add more instructors."
                ),
            )

    redirect_to = f"{APP_DOMAIN}/?invite_accept=1"
    payload = {
        "email": str(req.email),
        "data": {
            "role": "instructor",
            "name": req.full_name or str(req.email).split("@")[0],
            "adi_number": req.adi_number,
            "school_id": school["id"],
            "inviter_name": school.get("business_name") or "Your school owner",
        },
        "redirect_to": redirect_to,
    }

    async with httpx.AsyncClient(timeout=15.0) as client_http:
        r = await client_http.post(
            f"{SUPABASE_URL.rstrip('/')}/auth/v1/invite",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if r.status_code >= 400:
        body = r.text[:240]
        if "already" in body.lower():
            return InstructorInviteResponse(
                sent=False, email=str(req.email),
                detail="Email already has an active account — they can sign in directly.",
            )
        raise HTTPException(status_code=502, detail=f"Supabase invite failed: {body}")

    return InstructorInviteResponse(
        sent=True, email=str(req.email),
        detail=f"Instructor invite sent to {req.email}.",
    )


class LeaderboardRow(BaseModel):
    instructor_id: str
    full_name: str
    adi_number: Optional[str] = None
    is_owner: bool
    students_active: int
    lessons_month: int
    revenue_month: float
    pass_rate: float        # 0..100, NaN if no data → returned as 0


class LeaderboardResponse(BaseModel):
    school_id: str
    business_name: Optional[str] = None
    month_iso: str          # YYYY-MM
    tier: str
    seat_count: int
    seat_limit: Optional[int] = None   # None = unlimited
    can_add_instructor: bool
    totals: dict            # {students_active:int, lessons_month:int, revenue_month:float, pass_rate:float}
    rows: List[LeaderboardRow]


@api_router.get("/v2/school/leaderboard", response_model=LeaderboardResponse)
async def v2_school_leaderboard(sb_user: dict = Depends(get_current_supabase_user)):
    """Owner-only. School-wide KPIs + per-instructor breakdown for the current month."""
    if not await _is_school_owner(sb_user):
        raise HTTPException(status_code=403, detail="Only the school owner can view the leaderboard")
    school = sb_user["school"]
    school_id = school["id"]

    today = datetime.now(timezone.utc).date()
    month_start = today.replace(day=1).isoformat()
    month_iso = today.strftime("%Y-%m")

    async with httpx.AsyncClient(timeout=15.0) as client_http:
        # 1. All instructors in this school
        ir = await client_http.get(
            f"{_sb_rest_base}/instructors",
            params={"school_id": f"eq.{school_id}", "select": "id,full_name,adi_number,auth_user_id"},
            headers=_sb_headers(),
        )
        if ir.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Failed to load instructors: {ir.text[:200]}")
        instructors = ir.json() or []

        # 2. Active students per instructor
        sr = await client_http.get(
            f"{_sb_rest_base}/students",
            params={"school_id": f"eq.{school_id}", "select": "id,instructor_id,status"},
            headers=_sb_headers(),
        )
        students = sr.json() if sr.status_code < 400 else []

        # 3. This-month lessons (use start_time ≥ first of month)
        lr = await client_http.get(
            f"{_sb_rest_base}/lessons",
            params={
                "select": "id,instructor_id,status,amount_paid,start_time",
                "start_time": f"gte.{month_start}T00:00:00",
                "instructor_id": f"in.({','.join(i['id'] for i in instructors) or 'null'})",
            },
            headers=_sb_headers(),
        )
        lessons = lr.json() if lr.status_code < 400 else []

    owner_auth_id = school["owner_auth_id"]
    rows: List[LeaderboardRow] = []
    for ins in instructors:
        ins_id = ins["id"]
        students_active = sum(1 for s in students if s.get("instructor_id") == ins_id and (s.get("status") or "").lower() in ("new", "active", "test ready", "test_ready"))
        my_lessons = [l for l in lessons if l.get("instructor_id") == ins_id and (l.get("status") or "").lower() != "cancelled"]
        lessons_month = len(my_lessons)
        revenue_month = float(sum((l.get("amount_paid") or 0) for l in my_lessons))
        # Pass rate = students passed / (students passed + students who had Test Ready set previously). Best-effort proxy using current snapshot.
        passed = sum(1 for s in students if s.get("instructor_id") == ins_id and (s.get("status") or "").lower() == "passed")
        test_ready = sum(1 for s in students if s.get("instructor_id") == ins_id and (s.get("status") or "").lower() in ("test ready", "test_ready"))
        denom = passed + test_ready
        pass_rate = round((passed / denom) * 100, 1) if denom > 0 else 0.0

        rows.append(LeaderboardRow(
            instructor_id=ins_id,
            full_name=ins.get("full_name") or "(unnamed)",
            adi_number=ins.get("adi_number"),
            is_owner=(ins.get("auth_user_id") == owner_auth_id),
            students_active=students_active,
            lessons_month=lessons_month,
            revenue_month=round(revenue_month, 2),
            pass_rate=pass_rate,
        ))

    # School totals
    totals = {
        "students_active": sum(r.students_active for r in rows),
        "lessons_month":   sum(r.lessons_month   for r in rows),
        "revenue_month":   round(sum(r.revenue_month for r in rows), 2),
        "pass_rate":       round(sum(r.pass_rate for r in rows) / len(rows), 1) if rows else 0.0,
    }

    # Sort by revenue desc as a sensible default
    rows.sort(key=lambda r: r.revenue_month, reverse=True)

    # Tier / seat metadata so the UI can render the badge + gate the invite button
    tier = (school.get("tier") or "starter").lower()
    seat_limit_map = {"starter": 1, "growth": 1, "pro": 1, "franchise": None}
    seat_limit = seat_limit_map.get(tier, 1)
    seat_count = len(instructors)
    can_add = (seat_limit is None) or (seat_count < seat_limit)

    return LeaderboardResponse(
        school_id=school_id,
        business_name=school.get("business_name"),
        month_iso=month_iso,
        tier=tier,
        seat_count=seat_count,
        seat_limit=seat_limit,
        can_add_instructor=can_add,
        totals=totals,
        rows=rows,
    )


class ReassignStudentsRequest(BaseModel):
    assignments: List[dict]   # [{"student_id": uuid, "new_instructor_id": uuid}]


class ReassignStudentsResponse(BaseModel):
    moved: int
    skipped: int
    errors: List[str]


@api_router.post("/v2/students/reassign", response_model=ReassignStudentsResponse)
async def v2_reassign_students(
    req: ReassignStudentsRequest,
    sb_user: dict = Depends(get_current_supabase_user),
):
    """Owner-only. Atomically reassigns one or more students from their current
    instructor to a new instructor in the same school. Verifies both the student
    and the target instructor belong to the owner's school."""
    if not await _is_school_owner(sb_user):
        raise HTTPException(status_code=403, detail="Only the school owner can reassign students")
    school_id = sb_user["school"]["id"]

    moved = 0
    skipped = 0
    errors: List[str] = []

    async with httpx.AsyncClient(timeout=15.0) as client_http:
        # Pre-fetch valid instructor ids for this school
        ir = await client_http.get(
            f"{_sb_rest_base}/instructors",
            params={"school_id": f"eq.{school_id}", "select": "id"},
            headers=_sb_headers(),
        )
        valid_instructors = {row["id"] for row in (ir.json() or [])}

        for entry in req.assignments:
            sid = (entry.get("student_id") or "").strip()
            iid = (entry.get("new_instructor_id") or "").strip()
            if not sid or not iid:
                skipped += 1
                errors.append("Missing student_id or new_instructor_id")
                continue
            if iid not in valid_instructors:
                skipped += 1
                errors.append(f"Instructor {iid[:8]}… is not part of your school")
                continue
            # Verify student belongs to this school
            sr = await client_http.get(
                f"{_sb_rest_base}/students",
                params={"id": f"eq.{sid}", "school_id": f"eq.{school_id}", "select": "id,instructor_id", "limit": "1"},
                headers=_sb_headers(),
            )
            rows = sr.json() if sr.status_code < 400 else []
            if not rows:
                skipped += 1
                errors.append(f"Student {sid[:8]}… not in your school")
                continue
            if rows[0].get("instructor_id") == iid:
                skipped += 1
                continue   # already assigned, no-op

            # Patch
            up = await client_http.patch(
                f"{_sb_rest_base}/students",
                params={"id": f"eq.{sid}"},
                headers={**_sb_headers(), "Content-Type": "application/json", "Prefer": "return=minimal"},
                json={"instructor_id": iid},
            )
            if up.status_code >= 400:
                skipped += 1
                errors.append(f"Update failed for {sid[:8]}…: {up.text[:120]}")
            else:
                moved += 1

    return ReassignStudentsResponse(moved=moved, skipped=skipped, errors=errors[:10])


# ---------------------------------------------------------------------------
# Student lifecycle status + hard delete
# ---------------------------------------------------------------------------

# Allowed status values must mirror the DB check constraint defined in
# /app/supabase/migrations/018_student_lifecycle_statuses.sql.
_ALLOWED_STUDENT_STATUSES = {"New", "Active", "Test Ready", "Passed", "Inactive", "Waitlist"}


class StudentStatusPatch(BaseModel):
    status: str


class StudentMutationResponse(BaseModel):
    ok: bool
    student_id: str
    status: Optional[str] = None
    detail: Optional[str] = None


async def _ensure_owns_student(sb_user: dict, student_id: str) -> dict:
    """Tenant guard — fetch the student, verify it belongs to either:
      * the owner's school (owners can manage every student in their school), or
      * the calling instructor (instructors can only manage their own assigned students).

    Returns the student row on success; raises 403/404 otherwise.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            f"{_sb_rest_base}/students",
            headers=_sb_headers(),
            params={"select": "id,school_id,instructor_id", "id": f"eq.{student_id}", "limit": "1"},
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Supabase read failed: {r.text[:120]}")
    rows = r.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Student not found")
    row = rows[0]

    # Owners pass when the student's school matches their owned school.
    if await _is_school_owner(sb_user):
        if row.get("school_id") == sb_user["school"]["id"]:
            return row
        raise HTTPException(status_code=403, detail="Student does not belong to your school")

    # Otherwise check instructor identity (sub-instructor or solo-instructor).
    inst_id = sb_user.get("instructor", {}).get("id")
    if inst_id and row.get("instructor_id") == inst_id:
        return row
    raise HTTPException(status_code=403, detail="You may only manage your own assigned students")


@api_router.patch("/v2/students/{student_id}/status", response_model=StudentMutationResponse)
async def v2_update_student_status(
    student_id: str,
    body: StudentStatusPatch,
    sb_user: dict = Depends(get_current_supabase_user),
):
    """Transition a student between the lifecycle statuses.

    Allowed values: 'New' | 'Active' | 'Test Ready' | 'Passed' | 'Inactive' | 'Waitlist'.
    The endpoint enforces tenant isolation — instructors may only mutate students
    assigned to them; owners may mutate any student in their school. The DB check
    constraint provides defence-in-depth against invalid values.
    """
    new_status = (body.status or "").strip()
    if new_status not in _ALLOWED_STUDENT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {sorted(_ALLOWED_STUDENT_STATUSES)}",
        )
    await _ensure_owns_student(sb_user, student_id)

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.patch(
            f"{_sb_rest_base}/students",
            params={"id": f"eq.{student_id}"},
            headers={**_sb_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"status": new_status},
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Update failed: {r.text[:200]}")
    rows = r.json() or []
    return StudentMutationResponse(
        ok=True,
        student_id=student_id,
        status=(rows[0]["status"] if rows else new_status),
        detail="Status updated",
    )


@api_router.delete("/v2/students/{student_id}", response_model=StudentMutationResponse)
async def v2_delete_student(
    student_id: str,
    sb_user: dict = Depends(get_current_supabase_user),
):
    """Permanently delete a student record.

    All dependent rows (lessons, DVSA tracking, test outcomes, packages,
    wallet ledger, waiting-list entries, lesson history) are cascade-deleted
    by the FK constraints defined in migrations 001/002/007/015. This is a
    HARD delete — the operation cannot be reversed by the application.
    """
    await _ensure_owns_student(sb_user, student_id)

    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.delete(
            f"{_sb_rest_base}/students",
            params={"id": f"eq.{student_id}"},
            headers=_sb_headers(),
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Delete failed: {r.text[:200]}")
    return StudentMutationResponse(ok=True, student_id=student_id, detail="Student deleted")


class TodayLessonRow(BaseModel):
    lesson_id: str
    instructor_id: str
    instructor_name: str
    student_id: Optional[str] = None
    student_name: Optional[str] = None
    start_time: str
    end_time: str
    status: str
    topic: Optional[str] = None
    pickup_address: Optional[str] = None


@api_router.get("/v2/school/today", response_model=List[TodayLessonRow])
async def v2_school_today(sb_user: dict = Depends(get_current_supabase_user)):
    """Owner-only. Every lesson scheduled across the school for today (UTC)."""
    if not await _is_school_owner(sb_user):
        raise HTTPException(status_code=403, detail="Only the school owner can view the live diary")
    school_id = sb_user["school"]["id"]
    today = datetime.now(timezone.utc).date()
    tomorrow = (today + timedelta(days=1)).isoformat()
    today_iso = today.isoformat()

    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.get(
            f"{_sb_rest_base}/lessons",
            params={
                "select": (
                    "id,instructor_id,student_id,start_time,end_time,status,topic,pickup_address,"
                    "instructors(id,full_name,school_id),students(id,full_name)"
                ),
                "start_time": f"gte.{today_iso}T00:00:00",
                "and": f"(start_time.lt.{tomorrow}T00:00:00)",
                "order": "start_time.asc",
            },
            headers=_sb_headers(),
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Failed to load lessons: {r.text[:200]}")
    raw = r.json() or []
    out: List[TodayLessonRow] = []
    for row in raw:
        ins = row.get("instructors") or {}
        if ins.get("school_id") and ins["school_id"] != school_id:
            continue  # belt-and-braces — only this school
        stu = row.get("students") or {}
        out.append(TodayLessonRow(
            lesson_id=row["id"],
            instructor_id=row.get("instructor_id") or "",
            instructor_name=ins.get("full_name") or "(unknown)",
            student_id=row.get("student_id"),
            student_name=stu.get("full_name"),
            start_time=row.get("start_time") or "",
            end_time=row.get("end_time") or "",
            status=row.get("status") or "Scheduled",
            topic=row.get("topic"),
            pickup_address=row.get("pickup_address"),
        ))
    return out


# =============================================================================
# Digital Receipt Scanner — Gemini 2.5 Flash vision OCR
# =============================================================================
import base64 as _b64
import json as _json
import re as _re

class ReceiptScanRequest(BaseModel):
    image_base64: str          # raw base64 (no data: prefix), JPEG/PNG/WEBP
    mime_type: Optional[str] = "image/jpeg"


class ReceiptScanResponse(BaseModel):
    vendor: Optional[str] = None
    occurred_at: Optional[str] = None  # YYYY-MM-DD
    amount_total: Optional[float] = None
    vat_amount: Optional[float] = None
    category: Optional[str] = None     # one of the allowed categories
    raw_text: Optional[str] = None
    status: str                        # 'ok' | 'fallback'


_RECEIPT_CATEGORIES = [
    "fuel", "maintenance", "car_wash", "parking", "tolls",
    "mot", "insurance", "lesson_supplies", "other",
]


@api_router.post("/receipts/scan", response_model=ReceiptScanResponse)
async def receipts_scan(req: ReceiptScanRequest, sb_user: dict = Depends(get_current_supabase_user)):
    """OCR a receipt image using Gemini 2.5 Flash and return structured fields.
    Falls back gracefully if the model returns unparseable JSON.
    """
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured on backend.")
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 is required")
    # Strip any data: URI prefix if the client included one.
    img_b64 = req.image_base64
    if img_b64.startswith("data:"):
        try:
            img_b64 = img_b64.split(",", 1)[1]
        except Exception:
            pass

    # Basic sanity: must decode as bytes (don't actually decode the full payload).
    try:
        _b64.b64decode(img_b64[:128] + "==", validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="image_base64 is not valid base64")

    # Lazy import to avoid cold-start cost on unrelated routes.
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"emergentintegrations not installed: {e}")

    system_msg = (
        "You are an expert OCR engine for UK driving-instructor receipts. "
        "Given a single receipt image, extract: vendor (merchant name), "
        "occurred_at (ISO date YYYY-MM-DD), amount_total (GBP, number only), "
        "vat_amount (GBP, number only — null if not shown), and category "
        "(one of: fuel, maintenance, car_wash, parking, tolls, mot, insurance, "
        "lesson_supplies, other). Use 'fuel' for any petrol/diesel/EV-charging "
        "purchase. Use 'maintenance' for service/repair/MOT-prep work. Use "
        "'car_wash' for hand-wash or automated car wash. Use 'other' only if "
        "nothing else fits.\n\n"
        "Respond ONLY with a JSON object — no markdown, no commentary — "
        "containing exactly these keys: vendor, occurred_at, amount_total, "
        "vat_amount, category. If a field cannot be read, return null for it."
    )

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"receipt-scan-{sb_user['auth_user_id']}-{uuid.uuid4().hex[:8]}",
        system_message=system_msg,
    ).with_model("gemini", "gemini-2.5-flash")

    user_msg = UserMessage(
        text="Extract the receipt fields as JSON.",
        file_contents=[ImageContent(image_base64=img_b64)],
    )

    try:
        raw = await chat.send_message(user_msg)
    except Exception as e:
        logging.exception("[receipts/scan] Gemini call failed")
        raise HTTPException(status_code=502, detail=f"OCR backend failure: {e}")

    raw_text = str(raw).strip()

    # Strip ```json fences if the model added them despite instructions.
    fenced = _re.search(r"```(?:json)?\s*(\{[\s\S]+?\})\s*```", raw_text, _re.I)
    json_payload = fenced.group(1) if fenced else raw_text
    # Find the first JSON object substring if there's stray prose.
    if not json_payload.lstrip().startswith("{"):
        m = _re.search(r"\{[\s\S]+\}", json_payload)
        if m:
            json_payload = m.group(0)

    try:
        parsed = _json.loads(json_payload)
    except Exception:
        return ReceiptScanResponse(raw_text=raw_text, status="fallback")

    vendor       = parsed.get("vendor")
    occurred_at  = parsed.get("occurred_at")
    amount_total = parsed.get("amount_total")
    vat_amount   = parsed.get("vat_amount")
    category     = (parsed.get("category") or "").strip().lower()
    if category and category not in _RECEIPT_CATEGORIES:
        category = "other"
    # Coerce numerics
    def _to_float(v):
        if v is None or v == "":
            return None
        try:
            return float(str(v).replace("£", "").replace(",", "").strip())
        except Exception:
            return None
    amount_total = _to_float(amount_total)
    vat_amount   = _to_float(vat_amount)

    return ReceiptScanResponse(
        vendor=vendor if isinstance(vendor, str) else None,
        occurred_at=occurred_at if isinstance(occurred_at, str) else None,
        amount_total=amount_total,
        vat_amount=vat_amount,
        category=category or None,
        raw_text=raw_text,
        status="ok",
    )


# ============================================================================
# CALENDAR FEED (.ics) — per-instructor iCal subscribable feed
# ============================================================================
# Migration 012 adds `calendar_feed_token` on `instructors`. The feed itself is
# publicly accessible at GET /api/calendar/{token}.ics so Apple Calendar,
# Google Calendar and Outlook can subscribe without an OAuth dance. Knowledge
# of the token is the only auth — instructors can rotate it any time via
# POST /api/calendar/regenerate which instantly revokes the previous URL.
# ============================================================================

import secrets as _secrets
from fastapi.responses import Response as _Response


async def _find_instructor_for_auth_user(auth_user_id: str) -> Optional[dict]:
    """Return the public.instructors row for a Supabase auth user, or None."""
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.get(
            f"{_sb_rest_base}/instructors",
            params={"auth_user_id": f"eq.{auth_user_id}", "select": "*", "limit": "1"},
            headers=_sb_headers(),
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Supabase read failed: {r.text}")
    rows = r.json()
    return rows[0] if rows else None


async def _patch_instructor(instructor_id: str, patch: dict) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.patch(
            f"{_sb_rest_base}/instructors",
            params={"id": f"eq.{instructor_id}"},
            headers=_sb_headers(prefer="return=representation"),
            json=patch,
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Supabase write failed: {r.text}")
    rows = r.json()
    return rows[0] if rows else {}


class CalendarTokenResponse(BaseModel):
    enabled: bool
    token: Optional[str] = None
    feed_path: Optional[str] = None  # relative path: /api/calendar/<token>.ics


@api_router.post("/calendar/enable", response_model=CalendarTokenResponse)
async def calendar_enable(sb_user: dict = Depends(get_current_supabase_user)):
    """Idempotently turn the feed on for this instructor. Returns the existing
    token if one is already present; otherwise mints a fresh 32-char URL-safe
    one and persists it."""
    instr = await _find_instructor_for_auth_user(sb_user["auth_user_id"])
    if not instr:
        raise HTTPException(status_code=404, detail="No instructor profile linked to this account")
    token = instr.get("calendar_feed_token")
    if not token:
        token = _secrets.token_urlsafe(24)
        updated = await _patch_instructor(instr["id"], {"calendar_feed_token": token})
        token = updated.get("calendar_feed_token") or token
    return CalendarTokenResponse(enabled=True, token=token, feed_path=f"/api/calendar/{token}.ics")


@api_router.post("/calendar/regenerate", response_model=CalendarTokenResponse)
async def calendar_regenerate(sb_user: dict = Depends(get_current_supabase_user)):
    """Rotate the feed token. Previously-shared URLs immediately stop working."""
    instr = await _find_instructor_for_auth_user(sb_user["auth_user_id"])
    if not instr:
        raise HTTPException(status_code=404, detail="No instructor profile linked to this account")
    token = _secrets.token_urlsafe(24)
    updated = await _patch_instructor(instr["id"], {"calendar_feed_token": token})
    token = updated.get("calendar_feed_token") or token
    return CalendarTokenResponse(enabled=True, token=token, feed_path=f"/api/calendar/{token}.ics")


@api_router.post("/calendar/disable", response_model=CalendarTokenResponse)
async def calendar_disable(sb_user: dict = Depends(get_current_supabase_user)):
    """Disable the feed entirely. Any subscribed calendars will start getting 404s."""
    instr = await _find_instructor_for_auth_user(sb_user["auth_user_id"])
    if not instr:
        raise HTTPException(status_code=404, detail="No instructor profile linked to this account")
    await _patch_instructor(instr["id"], {"calendar_feed_token": None})
    return CalendarTokenResponse(enabled=False, token=None, feed_path=None)


@api_router.get("/calendar/status", response_model=CalendarTokenResponse)
async def calendar_status(sb_user: dict = Depends(get_current_supabase_user)):
    """Read-only — fetch the current token (if any) for this instructor."""
    instr = await _find_instructor_for_auth_user(sb_user["auth_user_id"])
    if not instr:
        raise HTTPException(status_code=404, detail="No instructor profile linked to this account")
    token = instr.get("calendar_feed_token")
    if not token:
        return CalendarTokenResponse(enabled=False, token=None, feed_path=None)
    return CalendarTokenResponse(enabled=True, token=token, feed_path=f"/api/calendar/{token}.ics")


# ---------------------------------------------------------------------------
# iCalendar text generation helpers
# ---------------------------------------------------------------------------

def _ics_escape(text: str) -> str:
    """Escape special characters per RFC 5545 §3.3.11 for TEXT properties."""
    if text is None:
        return ""
    out = (text
           .replace("\\", "\\\\")
           .replace(";", "\\;")
           .replace(",", "\\,")
           .replace("\r\n", "\\n")
           .replace("\n", "\\n")
           .replace("\r", "\\n"))
    return out


def _ics_fold(line: str) -> str:
    """Fold long lines (>74 octets) per RFC 5545 §3.1 — CRLF + space continuation."""
    if len(line) <= 74:
        return line
    chunks = [line[:74]]
    rest = line[74:]
    while rest:
        chunks.append(" " + rest[:73])
        rest = rest[73:]
    return "\r\n".join(chunks)


def _ics_fmt_dt_utc(iso_ts: str) -> str:
    """Convert a Supabase timestamptz ISO string to iCalendar UTC form."""
    try:
        if iso_ts.endswith("Z"):
            iso_ts = iso_ts[:-1] + "+00:00"
        dt = datetime.fromisoformat(iso_ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return dt.strftime("%Y%m%dT%H%M%SZ")


@api_router.get("/calendar/{token_with_ext}")
async def calendar_feed(token_with_ext: str):
    """Public iCalendar feed. The token is the only authentication — share the
    URL only with services you trust (e.g. your own Google/Apple Calendar)."""
    if not token_with_ext.endswith(".ics"):
        raise HTTPException(status_code=404, detail="Calendar feed not found")
    token = token_with_ext[:-4]
    if not token:
        raise HTTPException(status_code=404, detail="Calendar feed not found")

    # 1) Resolve the instructor by token.
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.get(
            f"{_sb_rest_base}/instructors",
            params={
                "calendar_feed_token": f"eq.{token}",
                "select": "id,full_name,school_id",
                "limit": "1",
            },
            headers=_sb_headers(),
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Supabase read failed: {r.text}")
    rows = r.json()
    if not rows:
        raise HTTPException(status_code=404, detail="Calendar feed not found")
    instr = rows[0]

    # 2) Pull lessons in a -90/+365 day window. Exclude Cancelled per user 1a.
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%S")
    window_end = (now + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%S")
    async with httpx.AsyncClient(timeout=15.0) as client_http:
        lr = await client_http.get(
            f"{_sb_rest_base}/lessons",
            params={
                "instructor_id": f"eq.{instr['id']}",
                "status": "in.(Scheduled,Completed)",
                "start_time": f"gte.{window_start}",
                "and": f"(start_time.lte.{window_end})",
                "select": (
                    "id,start_time,end_time,topic,notes,pickup_address,"
                    "status,duration_hours,students(full_name,address,postcode)"
                ),
                "order": "start_time.asc",
            },
            headers=_sb_headers(),
        )
    if lr.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Supabase read failed: {lr.text}")
    lessons = lr.json() or []

    # 3) Render iCalendar text.
    dtstamp = now.strftime("%Y%m%dT%H%M%SZ")
    instructor_name = instr.get("full_name") or "ADI Pro Instructor"
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ADI Pro//Lesson Diary//EN",
        "METHOD:PUBLISH",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{_ics_escape('ADI Pro — ' + instructor_name)}",
        "X-WR-TIMEZONE:Europe/London",
        f"X-WR-CALDESC:{_ics_escape('Driving lessons synced from ADI Pro')}",
    ]
    for L in lessons:
        student = L.get("students") if isinstance(L.get("students"), dict) else {}
        student = student or {}
        student_name = (student.get("full_name") or "Student").strip()
        topic = (L.get("topic") or "Driving lesson").strip()
        notes = (L.get("notes") or "").strip()
        duration_h = L.get("duration_hours")
        try:
            duration_h_num = float(duration_h) if duration_h is not None else None
        except Exception:
            duration_h_num = None
        summary = f"Driving lesson — {student_name}"
        desc_bits = [topic]
        if duration_h_num:
            dh = int(duration_h_num) if float(duration_h_num).is_integer() else duration_h_num
            desc_bits.append(f"{dh}h")
        if notes:
            desc_bits.append(notes)
        description = " · ".join(desc_bits)
        location = (L.get("pickup_address") or "").strip()
        if not location:
            loc_bits = [student.get("address") or "", student.get("postcode") or ""]
            location = ", ".join([b for b in loc_bits if b])
        uid = f"lesson-{L.get('id')}@adipro.app"
        dtstart = _ics_fmt_dt_utc(L.get("start_time") or "")
        dtend = _ics_fmt_dt_utc(L.get("end_time") or L.get("start_time") or "")
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{dtstamp}",
            f"DTSTART:{dtstart}",
            f"DTEND:{dtend}",
            f"SUMMARY:{_ics_escape(summary)}",
            f"DESCRIPTION:{_ics_escape(description)}",
            f"LOCATION:{_ics_escape(location)}",
            "STATUS:CONFIRMED",
            "TRANSP:OPAQUE",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    body = "\r\n".join(_ics_fold(ln) for ln in lines) + "\r\n"

    return _Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f"inline; filename=\"adi-pro-{token[:8]}.ics\"",
            "Cache-Control": "private, max-age=60",
        },
    )


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

