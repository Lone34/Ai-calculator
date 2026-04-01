import uuid
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.utils import timezone

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


class SubscriptionPlan(models.Model):
    BILLING_CYCLE_CHOICES = (
        ('D15', '15 Days'),
        ('M1', 'Monthly'),
        ('Y1', 'Yearly'),
        ('CUSTOM', 'Custom'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    code = models.SlugField(max_length=60, unique=True)
    billing_cycle = models.CharField(max_length=10, choices=BILLING_CYCLE_CHOICES, default='M1')
    duration_days = models.PositiveIntegerField(default=30)
    currency = models.CharField(max_length=8, default='INR')
    price_paise = models.PositiveIntegerField()
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    discount_paise = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_public = models.BooleanField(default=True)
    is_trial = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    description = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('sort_order', 'duration_days', 'price_paise')

    def clean(self):
        if self.duration_days <= 0:
            raise ValidationError({'duration_days': 'Duration must be greater than 0 days.'})
        if self.discount_percent < 0 or self.discount_percent > 100:
            raise ValidationError({'discount_percent': 'Discount percent must be between 0 and 100.'})
        if self.discount_paise > self.price_paise:
            raise ValidationError({'discount_paise': 'Flat discount cannot exceed base price.'})
        if self.final_amount_paise() < 0:
            raise ValidationError('Final subscription amount cannot be negative.')
        if not self.is_trial and self.final_amount_paise() <= 0:
            raise ValidationError('Final subscription amount must be greater than 0 for paid plans.')

    def final_amount_paise(self):
        percent_discount = int((self.price_paise * float(self.discount_percent)) / 100)
        final_value = self.price_paise - percent_discount - self.discount_paise
        return max(0, final_value)

    def __str__(self):
        return f'{self.name} ({self.duration_days}d)'


class UserSubscription(models.Model):
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('active', 'Active'),
        ('expired', 'Expired'),
        ('cancelled', 'Cancelled'),
        ('failed', 'Failed'),
        ('refunded', 'Refunded'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='subscriptions')
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name='subscriptions')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')

    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)

    base_price_paise = models.PositiveIntegerField(default=0)
    discount_applied_paise = models.PositiveIntegerField(default=0)
    amount_paid_paise = models.PositiveIntegerField(default=0)
    currency = models.CharField(max_length=8, default='INR')

    razorpay_order_id = models.CharField(max_length=80, unique=True)
    razorpay_payment_id = models.CharField(max_length=80, blank=True, default='')
    razorpay_signature = models.CharField(max_length=256, blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('-created_at',)
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['user', 'ends_at']),
            models.Index(fields=['razorpay_order_id']),
            models.Index(fields=['razorpay_payment_id']),
        ]

    def is_active_now(self):
        now = timezone.now()
        return (
            self.status == 'active'
            and self.starts_at is not None
            and self.ends_at is not None
            and self.starts_at <= now < self.ends_at
        )

    def __str__(self):
        return f'{self.user.username} - {self.plan.name} - {self.status}'


class FreeTrialGrant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='free_trial_grant')
    ip_hash = models.CharField(max_length=128, unique=True)
    granted_at = models.DateTimeField(auto_now_add=True)
    trial_starts_at = models.DateTimeField()
    trial_ends_at = models.DateTimeField()
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ('-granted_at',)
        indexes = [
            models.Index(fields=['ip_hash']),
            models.Index(fields=['trial_ends_at']),
        ]

    def __str__(self):
        return f'{self.user.username} trial until {self.trial_ends_at}'
