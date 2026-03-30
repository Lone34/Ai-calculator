from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView
from rest_framework.authtoken.models import Token
from django.contrib.auth import authenticate
from django.conf import settings
import sympy as sp
import json
import urllib.request
import urllib.error
import logging
import re

from .models import MathSession, Interaction, User
from .serializers import MathSessionSerializer, InteractionSerializer, UserSerializer
from .tasks import evaluate_math_expression

logger = logging.getLogger(__name__)

# Gemini model rotation order (free tier)
GEMINI_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
]

MATH_SYSTEM_PROMPT = """You are an expert math tutor and problem solver called Aether AI. Your job is to help students understand and solve math problems.

Rules:
- Provide clear, step-by-step solutions formatted entirely in standard Markdown.
- NEVER use LaTeX formatting (e.g. avoid $ and $$ blocks, \frac, \sqrt, etc.).
- Build all math using clean Unicode symbols (e.g., × ÷ √ π ∑ ∞ ≤ ≥ ≠ ≈ ² ³ ⁿ ₁ ₂ ₃ ±) or standard Markdown code blocks if necessary.
- For fractions, simply write a/b.
- Bold important step headings and final results by wrapping them in **double asterisks**.
- If given an image, thoroughly analyze the math problem within it and solve it step-by-step.
- Be concise but complete. Don't skip intermediate algebraic steps.
- At the end, state "The final answer is [answer]".
- If it's not a math question, still help politely but remind the user you specialize in mathematics."""


class RegisterView(APIView):
    permission_classes = [AllowAny]
    def post(self, request):
        serializer = UserSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            token, _ = Token.objects.get_or_create(user=user)
            return Response({'token': token.key, 'user_id': user.id}, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class LoginView(APIView):
    permission_classes = [AllowAny]
    def post(self, request):
        username = request.data.get('username')
        password = request.data.get('password')
        user = authenticate(username=username, password=password)
        if user:
            token, _ = Token.objects.get_or_create(user=user)
            return Response({'token': token.key, 'user_id': user.id})
        return Response({'error': 'Invalid Credentials'}, status=status.HTTP_400_BAD_REQUEST)

class UserSessionView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        session, _ = MathSession.objects.get_or_create(user=request.user, title="Default Session")
        return Response(MathSessionSerializer(session).data)

class MathSessionViewSet(viewsets.ModelViewSet):
    queryset = MathSession.objects.all()
    serializer_class = MathSessionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if hasattr(self.request, 'user') and self.request.user.is_authenticated:
            qs = self.queryset.filter(user=self.request.user)
            session_type = self.request.query_params.get('type')
            if session_type == 'ai':
                return qs.filter(title__startswith='AI Solve:')
            elif session_type == 'calc':
                return qs.exclude(title__startswith='AI Solve:')
            return qs
        return self.queryset.none()
        
    @action(detail=True, methods=['post'])
    def add_interaction(self, request, pk=None):
        session = self.get_object()
        raw_query = request.data.get('raw_query')
        input_type = request.data.get('input_type', 'text')
        interaction = Interaction.objects.create(
            session=session, role='user', input_type=input_type, raw_query=raw_query, status='pending'
        )
        if raw_query:
            evaluate_math_expression.delay(interaction.id, raw_query)
        return Response(InteractionSerializer(interaction).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def evaluate_instant(self, request, pk=None):
        session = self.get_object()
        raw_query = request.data.get('raw_query')
        if not raw_query:
            return Response({'error': 'no query'}, status=400)
        try:
            Interaction.objects.create(session=session, role='user', input_type='text', raw_query=raw_query, status='completed')
            processed = re.sub(r'([\d.]+)\s*%', r'(\1/100)', raw_query)
            expr = sp.sympify(processed)
            expr = expr.replace(sp.sin, lambda arg: sp.sin(arg * sp.pi / 180))
            expr = expr.replace(sp.cos, lambda arg: sp.cos(arg * sp.pi / 180))
            expr = expr.replace(sp.tan, lambda arg: sp.tan(arg * sp.pi / 180))
            expr = expr.replace(sp.asin, lambda arg: sp.asin(arg) * 180 / sp.pi)
            expr = expr.replace(sp.acos, lambda arg: sp.acos(arg) * 180 / sp.pi)
            expr = expr.replace(sp.atan, lambda arg: sp.atan(arg) * 180 / sp.pi)
            try:
                result = expr.evalf()
                if result.is_infinite or result == sp.zoo or result == sp.nan:
                    result_float = "Undefined"
                else:
                    num = float(result)
                    if num == int(num) and abs(num) < 1e15:
                        result_float = str(int(num))
                    else:
                        result_float = f"{num:.10g}"
            except Exception:
                result_float = str(expr)
            interaction_sys = Interaction.objects.create(
                session=session, role='system', content_text=result_float, solution_latex=sp.latex(expr)
            )
            return Response({
                'result': result_float, 'exact': str(expr), 'latex': interaction_sys.solution_latex
            })
        except Exception as e:
            import traceback
            print(f"EVAL_INSTANT ERROR: {e}")
            traceback.print_exc()
            return Response({'error': str(e)}, status=400)

    @action(detail=True, methods=['delete'])
    def clear_history(self, request, pk=None):
        session = self.get_object()
        session.interactions.all().delete()
        return Response({'status': 'history cleared'}, status=status.HTTP_200_OK)

class InteractionViewSet(viewsets.ModelViewSet):
    queryset = Interaction.objects.all()
    serializer_class = InteractionSerializer
    permission_classes = [IsAuthenticated]


# ── Gemini API Helper ──

def _call_gemini(model_name, contents, api_key):
    """Call Gemini API with given model. Returns response text or raises."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
    payload = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 8192,
        },
        "systemInstruction": {
            "parts": [{"text": MATH_SYSTEM_PROMPT}]
        }
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    response = urllib.request.urlopen(req, timeout=60)
    result = json.loads(response.read().decode('utf-8'))
    
    candidates = result.get('candidates', [])
    if not candidates:
        raise ValueError("No response generated")
    parts = candidates[0].get('content', {}).get('parts', [])
    text = ''.join(p.get('text', '') for p in parts)
    if not text:
        raise ValueError("Empty response from model")
    return text


class AISolveView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        message = request.data.get('message', '').strip()
        image_base64 = request.data.get('image', None)
        image_mime = request.data.get('image_mime', 'image/jpeg')
        history = request.data.get('history', [])
        session_id = request.data.get('session_id', None)
        
        if not message and not image_base64:
            return Response({'error': 'No message or image provided'}, status=400)
        
        api_key = settings.GEMINI_API_KEY
        if not api_key:
            return Response({'error': 'Gemini API key not configured'}, status=500)
        
        # Get or Create Session
        if session_id:
            try:
                session = MathSession.objects.get(id=session_id, user=request.user)
            except MathSession.DoesNotExist:
                return Response({'error': 'Session not found'}, status=404)
        else:
            title_text = message[:30] + '...' if len(message) > 30 else message
            if not title_text:
                title_text = "Image Problem"
            session = MathSession.objects.create(
                user=request.user, 
                title=f"AI Solve: {title_text}"
            )
            
        # Record user interaction (without storing base64 image deeply, just text for simplicity)
        Interaction.objects.create(
            session=session, 
            role='user', 
            input_type='image' if image_base64 else 'text',
            raw_query=message,
            status='completed'
        )
        
        # Build conversation contents
        contents = []
        for turn in history[-10:]:
            role = 'user' if turn.get('role') == 'user' else 'model'
            contents.append({
                "role": role,
                "parts": [{"text": turn.get('text', '')}]
            })
        
        # Build current user message
        user_parts = []
        if message:
            user_parts.append({"text": message})
        if image_base64:
            clean_base64 = image_base64
            if ',' in clean_base64:
                clean_base64 = clean_base64.split(',', 1)[1]
            user_parts.append({
                "inlineData": {
                    "mimeType": image_mime,
                    "data": clean_base64
                }
            })
            if not message:
                user_parts.insert(0, {"text": "Solve the math problem shown in this image. Show step-by-step solution."})
        
        contents.append({"role": "user", "parts": user_parts})
        
        # Try models with rotation
        last_error = None
        for model in GEMINI_MODELS:
            try:
                logger.info(f"Trying Gemini model: {model}")
                response_text = _call_gemini(model, contents, api_key)
                
                # Save AI response
                Interaction.objects.create(
                    session=session, 
                    role='ai', 
                    content_text=response_text,
                    status='completed'
                )
                
                return Response({
                    'response': response_text,
                    'model': model,
                    'session_id': session.id
                })
            except urllib.error.HTTPError as e:
                error_body = e.read().decode('utf-8', errors='replace')
                logger.warning(f"Model {model} failed (HTTP {e.code}): {error_body[:200]}")
                if e.code in (429, 503) or 'RESOURCE_EXHAUSTED' in error_body:
                    last_error = f"Model {model} rate limited / quota exhausted"
                    continue
                else:
                    last_error = f"API error ({e.code}): {error_body[:200]}"
                    continue
            except Exception as e:
                logger.error(f"Model {model} error: {str(e)}")
                last_error = str(e)
                continue
        
        return Response({'error': f'All models exhausted. Last error: {last_error}'}, status=503)
    
    def delete(self, request):
        """Clear AI solve chat history (used for deleting a specific chat session now)."""
        session_id = request.query_params.get('session_id')
        if session_id:
            try:
                session = MathSession.objects.get(id=session_id, user=request.user)
                session.delete()
                return Response({'status': 'session deleted'}, status=status.HTTP_200_OK)
            except MathSession.DoesNotExist:
                return Response({'error': 'Not found'}, status=404)
        else:
            return Response({'error': 'session_id required'}, status=400)
