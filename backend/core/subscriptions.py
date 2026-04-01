import base64
import hashlib
import hmac
import json
import uuid
import urllib.error
import urllib.request
from datetime import timedelta
from typing import Optional

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import FreeTrialGrant, SubscriptionPlan, UserSubscription


class SubscriptionConfigError(Exception):
    pass


class RazorpayRequestError(Exception):
    pass


def _require_razorpay_credentials():
    key_id = (getattr(settings, 'RAZORPAY_KEY_ID', '') or '').strip()
    key_secret = (getattr(settings, 'RAZORPAY_KEY_SECRET', '') or '').strip()
    if not key_id or not key_secret:
        raise SubscriptionConfigError('Razorpay credentials are not configured on the server.')
    return key_id, key_secret


def _razorpay_request(method: str, path: str, payload: Optional[dict] = None):
    key_id, key_secret = _require_razorpay_credentials()
    url = f'https://api.razorpay.com/v1/{path.lstrip("/")}'
    data = None
    headers = {'Content-Type': 'application/json'}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
    auth_bytes = f'{key_id}:{key_secret}'.encode('utf-8')
    headers['Authorization'] = f'Basic {base64.b64encode(auth_bytes).decode("utf-8")}'

    request = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as http_error:
        body = http_error.read().decode('utf-8', errors='replace')
        raise RazorpayRequestError(f'Razorpay HTTP {http_error.code}: {body[:300]}') from http_error
    except Exception as error:
        raise RazorpayRequestError(f'Razorpay request failed: {str(error)}') from error


def create_razorpay_order(*, amount_paise: int, currency: str, receipt: str, notes: Optional[dict] = None):
    payload = {
        'amount': int(amount_paise),
        'currency': currency,
        'receipt': receipt,
        'payment_capture': 1,
        'notes': notes or {},
    }
    return _razorpay_request('POST', 'orders', payload)


def fetch_razorpay_payment(payment_id: str):
    return _razorpay_request('GET', f'payments/{payment_id}')


def verify_razorpay_payment_signature(*, order_id: str, payment_id: str, signature: str) -> bool:
    _, key_secret = _require_razorpay_credentials()
    payload = f'{order_id}|{payment_id}'.encode('utf-8')
    generated = hmac.new(key_secret.encode('utf-8'), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(generated, signature or '')


def verify_razorpay_webhook_signature(*, raw_body: bytes, signature: str) -> bool:
    webhook_secret = (getattr(settings, 'RAZORPAY_WEBHOOK_SECRET', '') or '').strip()
    if not webhook_secret:
        raise SubscriptionConfigError('Razorpay webhook secret is missing.')
    generated = hmac.new(webhook_secret.encode('utf-8'), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(generated, signature or '')


def _is_truthy(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def _get_client_ip(request):
    trust_xff = _is_truthy(getattr(settings, 'SUBSCRIPTION_TRIAL_TRUST_X_FORWARDED_FOR', False), False)
    if trust_xff:
        xff = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if xff:
            first_ip = xff.split(',')[0].strip()
            if first_ip:
                return first_ip
    remote_addr = (request.META.get('REMOTE_ADDR') or '').strip()
    return remote_addr


def _hash_ip(ip_address: str) -> str:
    hash_secret = (
        getattr(settings, 'SUBSCRIPTION_TRIAL_IP_HASH_SECRET', '')
        or getattr(settings, 'SECRET_KEY', '')
        or 'aether-trial-fallback'
    )
    return hmac.new(
        hash_secret.encode('utf-8'),
        ip_address.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()


def _get_trial_days() -> int:
    raw = getattr(settings, 'SUBSCRIPTION_FREE_TRIAL_DAYS', 3)
    try:
        value = int(raw)
    except Exception:
        value = 3
    return max(1, value)


def _get_or_create_trial_plan():
    trial_days = _get_trial_days()
    plan, _created = SubscriptionPlan.objects.get_or_create(
        code='trial-3d',
        defaults={
            'name': f'Free Trial ({trial_days} Days)',
            'billing_cycle': 'CUSTOM',
            'duration_days': trial_days,
            'currency': 'INR',
            'price_paise': 0,
            'discount_percent': 0,
            'discount_paise': 0,
            'is_active': True,
            'is_public': False,
            'is_trial': True,
            'sort_order': 0,
            'description': 'System-managed onboarding trial plan.',
        },
    )
    changed_fields = []
    normalized_values = {
        'name': f'Free Trial ({trial_days} Days)',
        'billing_cycle': 'CUSTOM',
        'duration_days': trial_days,
        'currency': 'INR',
        'price_paise': 0,
        'discount_percent': 0,
        'discount_paise': 0,
        'is_active': True,
        'is_public': False,
        'is_trial': True,
    }
    for field, expected in normalized_values.items():
        current = getattr(plan, field)
        if current != expected:
            setattr(plan, field, expected)
            changed_fields.append(field)
    if changed_fields:
        plan.save(update_fields=[*changed_fields, 'updated_at'])
    return plan


def user_has_subscription_access(user) -> bool:
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    return has_active_subscription(user)


def grant_free_trial_if_eligible(*, user, request):
    trial_enabled = _is_truthy(getattr(settings, 'SUBSCRIPTION_ENABLE_FREE_TRIAL', True), True)
    if not trial_enabled:
        return {'granted': False, 'reason': 'trial_disabled', 'subscription': None}

    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return {'granted': False, 'reason': 'admin_user', 'subscription': None}

    existing_trial = FreeTrialGrant.objects.filter(user=user).first()
    if existing_trial:
        existing_subscription = (
            UserSubscription.objects
            .select_related('plan')
            .filter(user=user, plan__is_trial=True)
            .order_by('-created_at')
            .first()
        )
        return {
            'granted': False,
            'reason': 'trial_already_exists_for_user',
            'subscription': existing_subscription,
        }

    client_ip = _get_client_ip(request)
    if not client_ip:
        return {'granted': False, 'reason': 'ip_missing', 'subscription': None}

    ip_hash = _hash_ip(client_ip)
    if FreeTrialGrant.objects.filter(ip_hash=ip_hash).exists():
        return {'granted': False, 'reason': 'ip_already_used', 'subscription': None}

    trial_plan = _get_or_create_trial_plan()
    now = timezone.now()
    ends_at = now + timedelta(days=trial_plan.duration_days)

    try:
        with transaction.atomic():
            if FreeTrialGrant.objects.select_for_update().filter(ip_hash=ip_hash).exists():
                return {'granted': False, 'reason': 'ip_already_used', 'subscription': None}

            trial_subscription = UserSubscription.objects.create(
                user=user,
                plan=trial_plan,
                status='active',
                starts_at=now,
                ends_at=ends_at,
                activated_at=now,
                base_price_paise=0,
                discount_applied_paise=0,
                amount_paid_paise=0,
                currency=trial_plan.currency,
                razorpay_order_id=f'trial_{uuid.uuid4().hex}',
                metadata={
                    'source': 'free_trial',
                    'client_ip_present': True,
                },
            )
            FreeTrialGrant.objects.create(
                user=user,
                ip_hash=ip_hash,
                trial_starts_at=now,
                trial_ends_at=ends_at,
                metadata={
                    'plan_code': trial_plan.code,
                    'ip_hash_version': 'hmac_sha256_v1',
                },
            )
            return {'granted': True, 'reason': 'granted', 'subscription': trial_subscription}
    except IntegrityError:
        return {'granted': False, 'reason': 'ip_already_used', 'subscription': None}


def mark_expired_subscriptions(*, user=None):
    now = timezone.now()
    queryset = UserSubscription.objects.filter(status='active', ends_at__lte=now)
    if user is not None:
        queryset = queryset.filter(user=user)
    queryset.update(status='expired')


def get_active_subscription_for_user(user):
    mark_expired_subscriptions(user=user)
    now = timezone.now()
    return (
        UserSubscription.objects
        .select_related('plan')
        .filter(
            user=user,
            status='active',
            starts_at__lte=now,
            ends_at__gt=now,
        )
        .order_by('-ends_at')
        .first()
    )


def get_latest_subscription_for_user(user):
    return (
        UserSubscription.objects
        .select_related('plan')
        .filter(user=user)
        .order_by('-created_at')
        .first()
    )


def get_extend_start_for_user(user):
    active = get_active_subscription_for_user(user)
    now = timezone.now()
    if active and active.ends_at and active.ends_at > now:
        return active.ends_at
    return now


def has_active_subscription(user):
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    return get_active_subscription_for_user(user) is not None


def list_subscription_history(user):
    mark_expired_subscriptions(user=user)
    return (
        UserSubscription.objects
        .select_related('plan')
        .filter(user=user)
        .order_by('-created_at')
    )
