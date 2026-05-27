from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header, Request
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
import stripe

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
async def travel_time(req: TravelTimeRequest, current_user: dict = Depends(get_current_user)):
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


@app.on_event("shutdown")
async def shutdown_event():
    client.close()


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

    # 1. Look up the lesson to derive school_id + a default message body.
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        r = await client_http.get(
            f"{_sb_rest_base}/lessons",
            params={
                "id": f"eq.{req.lesson_id}",
                "select": "id,school_id,date,start_time,end_time,topic",
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

    # 2. Verify the caller actually owns this lesson's school.
    school = await sb_get_school_by_auth_user(sb_user["id"])
    if not school or school["id"] != lesson["school_id"]:
        raise HTTPException(status_code=403, detail="Not your lesson")

    # 3. Pull the active waiting_list with each student's auth_user_id.
    async with httpx.AsyncClient(timeout=10.0) as client_http:
        wl = await client_http.get(
            f"{_sb_rest_base}/waiting_list",
            params={
                "school_id": f"eq.{lesson['school_id']}",
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

    title = req.title or "Lesson slot just opened!"
    body  = req.body  or (
        f"A {lesson['start_time']}–{lesson['end_time']} slot has just freed up on "
        f"{lesson['date']}. Open ADI Pro to grab it before it's gone."
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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
