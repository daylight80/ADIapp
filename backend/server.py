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
    if current_user.get("subscription_status") == "pro":
        raise HTTPException(status_code=400, detail="You already have an active Pro subscription")
    price_id = await get_or_create_pro_price()
    customer_id = current_user.get("stripe_customer_id")
    if not customer_id:
        customer = stripe.Customer.create(email=current_user["email"], name=current_user["name"], metadata={"user_id": current_user["id"]})
        customer_id = customer.id
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"stripe_customer_id": customer_id}})
    success_url = (req.success_url or f"{APP_DOMAIN}/pricing-screen") + "?status=success&session_id={CHECKOUT_SESSION_ID}"
    cancel_url = req.cancel_url or f"{APP_DOMAIN}/pricing-screen?status=cancelled"
    session = stripe.checkout.Session.create(
        customer=customer_id, mode="subscription", payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url, cancel_url=cancel_url,
        client_reference_id=current_user["id"], metadata={"user_id": current_user["id"]},
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


@api_router.post("/billing/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
        else:
            import json
            event = json.loads(payload.decode("utf-8"))
    except (ValueError, stripe.error.SignatureVerificationError) as e:
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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
