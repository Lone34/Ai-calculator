from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import MathSessionViewSet, InteractionViewSet, RegisterView, LoginView, UserSessionView, AISolveView

router = DefaultRouter()
router.register(r'sessions', MathSessionViewSet)
router.register(r'interactions', InteractionViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('auth/register/', RegisterView.as_view(), name='auth_register'),
    path('auth/login/', LoginView.as_view(), name='auth_login'),
    path('active-session/', UserSessionView.as_view(), name='user_active_session'),
    path('ai-solve/', AISolveView.as_view(), name='ai_solve'),
]
