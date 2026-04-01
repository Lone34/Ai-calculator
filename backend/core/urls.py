from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import MathSessionViewSet, InteractionViewSet, RegisterView, LoginView, UserSessionView, AISolveView
from .subscription_views import (
    ProfileView,
    SubscriptionCreateOrderView,
    SubscriptionPlanListView,
    SubscriptionStatusView,
    SubscriptionVerifyPaymentView,
    SubscriptionWebhookView,
)

router = DefaultRouter()
router.register(r'sessions', MathSessionViewSet)
router.register(r'interactions', InteractionViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('auth/register/', RegisterView.as_view(), name='auth_register'),
    path('auth/login/', LoginView.as_view(), name='auth_login'),
    path('active-session/', UserSessionView.as_view(), name='user_active_session'),
    path('ai-solve/', AISolveView.as_view(), name='ai_solve'),
    path('profile/me/', ProfileView.as_view(), name='profile_me'),
    path('subscriptions/plans/', SubscriptionPlanListView.as_view(), name='subscription_plans'),
    path('subscriptions/me/', SubscriptionStatusView.as_view(), name='subscription_status'),
    path('subscriptions/create-order/', SubscriptionCreateOrderView.as_view(), name='subscription_create_order'),
    path('subscriptions/verify-payment/', SubscriptionVerifyPaymentView.as_view(), name='subscription_verify_payment'),
    path('subscriptions/webhook/', SubscriptionWebhookView.as_view(), name='subscription_webhook'),
]
