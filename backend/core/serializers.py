from rest_framework import serializers
from .models import User, MathSession, Interaction

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
