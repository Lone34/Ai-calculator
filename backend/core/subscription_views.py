import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SubscriptionPlan, UserSubscription
from .serializers import SubscriptionPlanSerializer, UserSubscriptionSerializer
from .subscriptions import (
    RazorpayRequestError,
    SubscriptionConfigError,
    create_razorpay_order,
    fetch_razorpay_payment,
    get_active_subscription_for_user,
    get_extend_start_for_user,
    list_subscription_history,
    user_has_subscription_access,
    verify_razorpay_payment_signature,
    verify_razorpay_webhook_signature,
)


def _serialize_subscription(subscription):
    if not subscription:
        return None
    return UserSubscriptionSerializer(subscription).data


def _activate_subscription_from_payment(subscription, *, payment_id, signature, payment_payload):
    now = timezone.now()
    start_at = get_extend_start_for_user(subscription.user)
    end_at = start_at + timedelta(days=subscription.plan.duration_days)

    subscription.status = 'active'
    subscription.starts_at = start_at
    subscription.ends_at = end_at
    subscription.activated_at = now
    subscription.razorpay_payment_id = payment_id
    subscription.razorpay_signature = signature or subscription.razorpay_signature
    subscription.metadata = {
        **(subscription.metadata or {}),
        'payment_payload': payment_payload or {},
        'activated_via': 'verify_api' if signature else 'webhook',
    }
    subscription.save(update_fields=[
        'status',
        'starts_at',
        'ends_at',
        'activated_at',
        'razorpay_payment_id',
        'razorpay_signature',
        'metadata',
        'updated_at',
    ])
    return subscription


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        active_subscription = get_active_subscription_for_user(request.user)
        latest_subscription = (
            list_subscription_history(request.user).first()
        )
        return Response({
            'id': str(request.user.id),
            'username': request.user.username,
            'email': request.user.email,
            'date_joined': request.user.date_joined,
            'subscription': _serialize_subscription(active_subscription),
            'latest_subscription': _serialize_subscription(latest_subscription),
            'has_active_subscription': active_subscription is not None,
            'has_subscription_access': user_has_subscription_access(request.user),
        })


class SubscriptionPlanListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        plans = (
            SubscriptionPlan.objects
            .filter(is_active=True, is_public=True, is_trial=False)
            .order_by('sort_order', 'duration_days')
        )
        serializer = SubscriptionPlanSerializer(plans, many=True)
        return Response(serializer.data)


class SubscriptionStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        active_subscription = get_active_subscription_for_user(request.user)
        history = list_subscription_history(request.user)[:20]
        return Response({
            'active_subscription': _serialize_subscription(active_subscription),
            'history': UserSubscriptionSerializer(history, many=True).data,
            'has_active_subscription': active_subscription is not None,
            'has_subscription_access': user_has_subscription_access(request.user),
        })


class SubscriptionCreateOrderView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        plan_id = request.data.get('plan_id')
        if not plan_id:
            return Response({'error': 'plan_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            plan = SubscriptionPlan.objects.get(id=plan_id, is_active=True, is_public=True, is_trial=False)
        except SubscriptionPlan.DoesNotExist:
            return Response({'error': 'Selected plan does not exist or is inactive.'}, status=status.HTTP_404_NOT_FOUND)

        amount_paise = plan.final_amount_paise()
        if amount_paise <= 0:
            return Response({'error': 'Plan amount is invalid.'}, status=status.HTTP_400_BAD_REQUEST)

        receipt = f'aether-{request.user.id}-{uuid.uuid4().hex[:10]}'
        notes = {
            'user_id': str(request.user.id),
            'plan_code': plan.code,
            'plan_id': str(plan.id),
        }

        try:
            order_data = create_razorpay_order(
                amount_paise=amount_paise,
                currency=plan.currency,
                receipt=receipt,
                notes=notes,
            )
        except SubscriptionConfigError as config_error:
            return Response({'error': str(config_error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except RazorpayRequestError as request_error:
            return Response({'error': str(request_error)}, status=status.HTTP_502_BAD_GATEWAY)

        order_id = order_data.get('id')
        if not order_id:
            return Response({'error': 'Razorpay order creation failed.'}, status=status.HTTP_502_BAD_GATEWAY)

        subscription = UserSubscription.objects.create(
            user=request.user,
            plan=plan,
            status='pending',
            base_price_paise=plan.price_paise,
            discount_applied_paise=plan.price_paise - amount_paise,
            amount_paid_paise=amount_paise,
            currency=plan.currency,
            razorpay_order_id=order_id,
            metadata={'receipt': receipt, 'razorpay_order': order_data},
        )

        return Response({
            'subscription_id': str(subscription.id),
            'order_id': order_id,
            'amount_paise': amount_paise,
            'currency': plan.currency,
            'razorpay_key_id': getattr(settings, 'RAZORPAY_KEY_ID', ''),
            'plan': SubscriptionPlanSerializer(plan).data,
            'prefill': {
                'name': request.user.username,
                'email': request.user.email,
            },
        }, status=status.HTTP_201_CREATED)


class SubscriptionVerifyPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        order_id = (request.data.get('order_id') or '').strip()
        payment_id = (request.data.get('payment_id') or '').strip()
        signature = (request.data.get('signature') or '').strip()

        if not order_id or not payment_id or not signature:
            return Response(
                {'error': 'order_id, payment_id and signature are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            signature_ok = verify_razorpay_payment_signature(
                order_id=order_id,
                payment_id=payment_id,
                signature=signature,
            )
        except SubscriptionConfigError as config_error:
            return Response({'error': str(config_error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if not signature_ok:
            return Response({'error': 'Invalid payment signature.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            payment_payload = fetch_razorpay_payment(payment_id)
        except SubscriptionConfigError as config_error:
            return Response({'error': str(config_error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except RazorpayRequestError as request_error:
            return Response({'error': str(request_error)}, status=status.HTTP_502_BAD_GATEWAY)

        if (payment_payload.get('order_id') or '').strip() != order_id:
            return Response({'error': 'Payment order mismatch.'}, status=status.HTTP_400_BAD_REQUEST)
        if payment_payload.get('status') not in {'captured', 'authorized'}:
            return Response({'error': 'Payment is not captured/authorized.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            subscription = (
                UserSubscription.objects
                .select_for_update()
                .select_related('plan', 'user')
                .filter(user=request.user, razorpay_order_id=order_id)
                .first()
            )

            if not subscription:
                return Response({'error': 'Subscription order not found.'}, status=status.HTTP_404_NOT_FOUND)

            if subscription.status == 'active' and subscription.razorpay_payment_id == payment_id:
                return Response({
                    'message': 'Payment already verified.',
                    'subscription': UserSubscriptionSerializer(subscription).data,
                })

            if subscription.razorpay_payment_id and subscription.razorpay_payment_id != payment_id:
                return Response({'error': 'Order already mapped to another payment.'}, status=status.HTTP_409_CONFLICT)

            paid_amount = int(payment_payload.get('amount') or 0)
            if paid_amount != subscription.amount_paid_paise:
                return Response({'error': 'Paid amount does not match order amount.'}, status=status.HTTP_400_BAD_REQUEST)

            _activate_subscription_from_payment(
                subscription,
                payment_id=payment_id,
                signature=signature,
                payment_payload=payment_payload,
            )

        return Response({
            'message': 'Subscription activated successfully.',
            'subscription': UserSubscriptionSerializer(subscription).data,
        })


class SubscriptionWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        signature = request.headers.get('X-Razorpay-Signature', '')
        raw_body = request.body
        try:
            verified = verify_razorpay_webhook_signature(raw_body=raw_body, signature=signature)
        except SubscriptionConfigError:
            return Response({'error': 'Webhook secret missing.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if not verified:
            return Response({'error': 'Invalid webhook signature.'}, status=status.HTTP_400_BAD_REQUEST)

        event = request.data.get('event')
        if event not in {'payment.captured', 'payment.authorized'}:
            return Response({'status': 'ignored'}, status=status.HTTP_200_OK)

        payment_entity = (
            request.data.get('payload', {})
            .get('payment', {})
            .get('entity', {})
        )
        order_id = (payment_entity.get('order_id') or '').strip()
        payment_id = (payment_entity.get('id') or '').strip()
        payment_amount = int(payment_entity.get('amount') or 0)
        if not order_id or not payment_id:
            return Response({'error': 'order_id/payment_id missing in webhook payload.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            subscription = (
                UserSubscription.objects
                .select_for_update()
                .select_related('plan', 'user')
                .filter(razorpay_order_id=order_id)
                .first()
            )

            if not subscription:
                return Response({'status': 'unknown_order'}, status=status.HTTP_200_OK)

            if subscription.status == 'active' and subscription.razorpay_payment_id == payment_id:
                return Response({'status': 'already_active'}, status=status.HTTP_200_OK)

            if payment_amount != subscription.amount_paid_paise:
                subscription.status = 'failed'
                subscription.metadata = {
                    **(subscription.metadata or {}),
                    'webhook_error': 'amount_mismatch',
                    'payment_payload': payment_entity,
                }
                subscription.save(update_fields=['status', 'metadata', 'updated_at'])
                return Response({'status': 'amount_mismatch'}, status=status.HTTP_200_OK)

            _activate_subscription_from_payment(
                subscription,
                payment_id=payment_id,
                signature='',
                payment_payload=payment_entity,
            )

        return Response({'status': 'activated'}, status=status.HTTP_200_OK)
