from rest_framework import serializers
from .models import User, MathSession, Interaction, SubscriptionPlan, UserSubscription

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'password')
        extra_kwargs = {'password': {'write_only': True}}
        
    def create(self, validated_data):
        return User.objects.create_user(**validated_data)

class InteractionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Interaction
        fields = '__all__'

class MathSessionSerializer(serializers.ModelSerializer):
    interactions = InteractionSerializer(many=True, read_only=True)
    class Meta:
        model = MathSession
        fields = '__all__'


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    final_amount_paise = serializers.SerializerMethodField()

    class Meta:
        model = SubscriptionPlan
        fields = (
            'id',
            'name',
            'code',
            'billing_cycle',
            'duration_days',
            'currency',
            'price_paise',
            'discount_percent',
            'discount_paise',
            'final_amount_paise',
            'description',
            'is_active',
            'sort_order',
        )

    def get_final_amount_paise(self, obj):
        return obj.final_amount_paise()


class UserSubscriptionSerializer(serializers.ModelSerializer):
    plan = SubscriptionPlanSerializer(read_only=True)
    is_active_now = serializers.SerializerMethodField()

    class Meta:
        model = UserSubscription
        fields = (
            'id',
            'status',
            'starts_at',
            'ends_at',
            'activated_at',
            'base_price_paise',
            'discount_applied_paise',
            'amount_paid_paise',
            'currency',
            'razorpay_order_id',
            'razorpay_payment_id',
            'created_at',
            'updated_at',
            'is_active_now',
            'plan',
        )

    def get_is_active_now(self, obj):
        return obj.is_active_now()
