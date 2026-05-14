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

stripe.api_key = STRIPE_API_KEY

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="UK Driving Instructor & Student Portal API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Cache the Stripe price id for £9.99/mo Pro subscription
_PRO_PRICE_ID: Optional[str] = None


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
    subscription_status: Literal["free", "pro", "past_due", "canceled"] = "free"
    stripe_customer_id: Optional[str] = None
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class CheckoutSessionRequest(BaseModel):
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class CheckoutSessionResponse(BaseModel):
    url: str


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
        subscription_status=u.get("subscription_status", "free"),
        stripe_customer_id=u.get("stripe_customer_id"),
        created_at=u["created_at"],
    )


# ============= AUTH ROUTES =============
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
        "subscription_status": "free",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "created_at": now,
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, req.email.lower(), req.role)
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


# ============= STRIPE BILLING =============
async def get_or_create_pro_price() -> str:
    """Return cached Stripe Price ID for £9.99/mo Pro plan; create if missing."""
    global _PRO_PRICE_ID
    if _PRO_PRICE_ID:
        return _PRO_PRICE_ID
    # Try to find existing product
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

        # Look for a recurring £9.99/mo price for this product
        prices = stripe.Price.list(product=product_id, active=True, limit=100)
        for pr in prices.data:
            if (
                pr.recurring
                and pr.recurring.get("interval") == "month"
                and pr.unit_amount == 999
                and pr.currency == "gbp"
            ):
                _PRO_PRICE_ID = pr.id
                return pr.id

        price = stripe.Price.create(
            unit_amount=999,
            currency="gbp",
            recurring={"interval": "month"},
            product=product_id,
            metadata={"plan_key": "drivehub_pro_monthly"},
        )
        _PRO_PRICE_ID = price.id
        return price.id
    except Exception as e:
        logger.error(f"Failed to set up Stripe price: {e}")
        raise HTTPException(status_code=500, detail="Billing not configured")


@api_router.post("/billing/create-checkout-session", response_model=CheckoutSessionResponse)
async def create_checkout_session(
    req: CheckoutSessionRequest, current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "instructor":
        raise HTTPException(status_code=403, detail="Only instructors can subscribe")
    if current_user.get("subscription_status") == "pro":
        raise HTTPException(status_code=400, detail="You already have an active Pro subscription")

    price_id = await get_or_create_pro_price()

    # Create or reuse Stripe customer
    customer_id = current_user.get("stripe_customer_id")
    if not customer_id:
        try:
            customer = stripe.Customer.create(
                email=current_user["email"],
                name=current_user["name"],
                metadata={"user_id": current_user["id"]},
            )
            customer_id = customer.id
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$set": {"stripe_customer_id": customer_id}},
            )
        except Exception as e:
            logger.error(f"Stripe customer creation failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to create customer")

    success_url = (req.success_url or f"{APP_DOMAIN}/pricing-screen") + "?status=success&session_id={CHECKOUT_SESSION_ID}"
    cancel_url = req.cancel_url or f"{APP_DOMAIN}/pricing-screen?status=cancelled"

    try:
        session = stripe.checkout.Session.create(
            customer=customer_id,
            mode="subscription",
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=current_user["id"],
            metadata={"user_id": current_user["id"]},
        )
        return CheckoutSessionResponse(url=session.url)
    except Exception as e:
        logger.error(f"Checkout session creation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/billing/subscription-status")
async def subscription_status(current_user: dict = Depends(get_current_user)):
    return {
        "subscription_status": current_user.get("subscription_status", "free"),
        "stripe_customer_id": current_user.get("stripe_customer_id"),
    }


@api_router.post("/billing/verify-session")
async def verify_session(
    payload: dict, current_user: dict = Depends(get_current_user)
):
    """Frontend calls this after returning from checkout to verify and update status."""
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    try:
        session = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
        if session.client_reference_id != current_user["id"]:
            raise HTTPException(status_code=403, detail="Session does not belong to you")
        if session.payment_status == "paid" and session.subscription:
            sub = session.subscription
            await db.users.update_one(
                {"id": current_user["id"]},
                {
                    "$set": {
                        "subscription_status": "pro",
                        "stripe_subscription_id": sub["id"] if isinstance(sub, dict) else sub.id,
                        "subscription_started_at": datetime.now(timezone.utc),
                    }
                },
            )
            return {"subscription_status": "pro", "verified": True}
        return {"subscription_status": current_user.get("subscription_status", "free"), "verified": False}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/billing/create-portal-session", response_model=CheckoutSessionResponse)
async def create_portal_session(current_user: dict = Depends(get_current_user)):
    customer_id = current_user.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer for this user")
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{APP_DOMAIN}/home-screen",
        )
        return CheckoutSessionResponse(url=session.url)
    except Exception as e:
        logger.error(f"Portal session failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/billing/cancel-mock")
async def cancel_mock(current_user: dict = Depends(get_current_user)):
    """Dev helper: instantly revert to free (for testing without real cancellation flow)."""
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"subscription_status": "free", "stripe_subscription_id": None}},
    )
    return {"subscription_status": "free"}


@api_router.post("/billing/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    # If no webhook secret configured (e.g. preview env), accept event JSON directly
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
        user_id = (data_object.get("client_reference_id") or
                   data_object.get("metadata", {}).get("user_id"))
        if user_id:
            await db.users.update_one(
                {"id": user_id},
                {
                    "$set": {
                        "subscription_status": "pro",
                        "stripe_subscription_id": data_object.get("subscription"),
                        "subscription_started_at": datetime.now(timezone.utc),
                    }
                },
            )
    elif event_type == "customer.subscription.deleted":
        customer_id = data_object.get("customer")
        await db.users.update_one(
            {"stripe_customer_id": customer_id},
            {"$set": {"subscription_status": "canceled"}},
        )
    elif event_type == "invoice.payment_failed":
        customer_id = data_object.get("customer")
        await db.users.update_one(
            {"stripe_customer_id": customer_id},
            {"$set": {"subscription_status": "past_due"}},
        )
    return {"status": "received"}


# ============= STARTUP =============
async def seed_demo_users():
    demos = [
        {"email": "instructor@demo.uk", "name": "Alex Thompson", "role": "instructor", "password": "password123"},
        {"email": "student@demo.uk", "name": "Jamie Williams", "role": "student", "password": "password123"},
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
                "subscription_status": "free",
                "stripe_customer_id": None,
                "stripe_subscription_id": None,
                "created_at": datetime.now(timezone.utc),
            })
            logger.info(f"Seeded demo user: {d['email']}")
        else:
            # Ensure subscription fields exist for already-seeded users
            if "subscription_status" not in existing:
                await db.users.update_one(
                    {"id": existing["id"]},
                    {"$set": {"subscription_status": "free", "stripe_customer_id": None, "stripe_subscription_id": None}},
                )


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
