import uuid
from django.db import models
from django.contrib.auth.models import AbstractUser

class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

class UserPreference(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='preferences')
    is_dark_mode = models.BooleanField(default=True)
    preferred_llm = models.CharField(max_length=50, default='gpt-4o')
    save_chat_history = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class MathSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True, related_name='sessions')
    title = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class Interaction(models.Model):
    ROLE_CHOICES = (('user', 'User'), ('ai', 'AI'), ('system', 'System'))
    INPUT_TYPES = (('text', 'Text'), ('image', 'Image'), ('sketch', 'Sketch'))

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(MathSession, on_delete=models.CASCADE, related_name='interactions')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    
    input_type = models.CharField(max_length=20, choices=INPUT_TYPES, blank=True, null=True)
    raw_query = models.TextField(blank=True, null=True)
    parsed_latex = models.TextField(blank=True, null=True)
    
    task_id = models.CharField(max_length=255, blank=True, null=True)
    status = models.CharField(max_length=50, default='completed')
    
    content_text = models.TextField(blank=True, null=True)
    solution_latex = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
