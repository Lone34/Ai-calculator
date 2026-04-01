from decimal import Decimal, ROUND_HALF_UP

from django import forms
from django.contrib import admin
from django.utils import timezone

from .models import (
    FreeTrialGrant,
    Interaction,
    MathSession,
    SubscriptionPlan,
    User,
    UserPreference,
    UserSubscription,
)


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ('username', 'email', 'is_staff', 'is_active', 'date_joined')
    search_fields = ('username', 'email')
    list_filter = ('is_staff', 'is_active')


@admin.register(UserPreference)
class UserPreferenceAdmin(admin.ModelAdmin):
    list_display = ('user', 'is_dark_mode', 'preferred_llm', 'save_chat_history', 'updated_at')
    search_fields = ('user__username',)
    list_filter = ('is_dark_mode', 'save_chat_history')


@admin.register(MathSession)
class MathSessionAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'title', 'created_at', 'updated_at')
    search_fields = ('user__username', 'title')
    list_filter = ('created_at', 'updated_at')


@admin.register(Interaction)
class InteractionAdmin(admin.ModelAdmin):
    list_display = ('id', 'session', 'role', 'input_type', 'status', 'created_at')
    search_fields = ('session__id', 'raw_query', 'content_text')
    list_filter = ('role', 'input_type', 'status', 'created_at')


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    class SubscriptionPlanAdminForm(forms.ModelForm):
        price_inr = forms.DecimalField(
            max_digits=12,
            decimal_places=2,
            min_value=Decimal('0'),
            help_text='Enter amount in INR (e.g. 150 for ₹150).',
            required=True,
        )
        discount_inr = forms.DecimalField(
            max_digits=12,
            decimal_places=2,
            min_value=Decimal('0'),
            help_text='Flat discount in INR (e.g. 20 for ₹20).',
            required=False,
            initial=Decimal('0'),
        )

        class Meta:
            model = SubscriptionPlan
            exclude = ('price_paise', 'discount_paise')

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            paise_price = getattr(self.instance, 'price_paise', 0) or 0
            paise_discount = getattr(self.instance, 'discount_paise', 0) or 0
            self.fields['price_inr'].initial = Decimal(paise_price) / Decimal('100')
            self.fields['discount_inr'].initial = Decimal(paise_discount) / Decimal('100')

        def clean(self):
            cleaned = super().clean()
            price_inr = cleaned.get('price_inr')
            discount_inr = cleaned.get('discount_inr') or Decimal('0')
            if price_inr is not None:
                self.instance.price_paise = int(
                    (Decimal(price_inr) * Decimal('100')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
                )
            if discount_inr is not None:
                self.instance.discount_paise = int(
                    (Decimal(discount_inr) * Decimal('100')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
                )
            return cleaned

    form = SubscriptionPlanAdminForm
    list_display = (
        'name',
        'code',
        'billing_cycle',
        'duration_days',
        'price_inr_display',
        'discount_percent',
        'discount_inr_display',
        'is_active',
        'is_public',
        'is_trial',
        'sort_order',
    )
    list_filter = ('billing_cycle', 'is_active', 'is_public', 'is_trial')
    search_fields = ('name', 'code')
    ordering = ('sort_order', 'duration_days')

    actions = ['convert_selected_amounts_from_inr_to_paise']

    @admin.display(description='Price (INR)')
    def price_inr_display(self, obj):
        return f'₹{(obj.price_paise or 0) / 100:.2f}'

    @admin.display(description='Discount (INR)')
    def discount_inr_display(self, obj):
        return f'₹{(obj.discount_paise or 0) / 100:.2f}'

    @admin.action(description='Convert selected amounts from INR entries to paise (x100)')
    def convert_selected_amounts_from_inr_to_paise(self, request, queryset):
        converted = 0
        for plan in queryset:
            plan.price_paise = int((plan.price_paise or 0) * 100)
            plan.discount_paise = int((plan.discount_paise or 0) * 100)
            plan.save(update_fields=['price_paise', 'discount_paise', 'updated_at'])
            converted += 1
        self.message_user(request, f'Converted {converted} plan(s) to paise values.')


@admin.register(UserSubscription)
class UserSubscriptionAdmin(admin.ModelAdmin):
    list_display = (
        'user',
        'plan',
        'status',
        'starts_at',
        'ends_at',
        'amount_paid_paise',
        'razorpay_order_id',
        'created_at',
    )
    list_filter = ('status', 'plan__billing_cycle', 'created_at')
    search_fields = (
        'user__username',
        'razorpay_order_id',
        'razorpay_payment_id',
        'plan__name',
    )
    readonly_fields = ('created_at', 'updated_at', 'activated_at')

    actions = ['mark_as_expired']

    @admin.action(description='Mark selected subscriptions as expired')
    def mark_as_expired(self, request, queryset):
        now = timezone.now()
        queryset.update(status='expired', ends_at=now, updated_at=now)


@admin.register(FreeTrialGrant)
class FreeTrialGrantAdmin(admin.ModelAdmin):
    list_display = ('user', 'granted_at', 'trial_starts_at', 'trial_ends_at')
    search_fields = ('user__username', 'ip_hash')
    list_filter = ('granted_at', 'trial_ends_at')
