try:
    from celery import shared_task
except ImportError:
    # Celery not installed - create a no-op decorator so the module loads
    def shared_task(func):
        func.delay = lambda *args, **kwargs: func(*args, **kwargs)
        return func

from .models import Interaction
import sympy as sp
import time

@shared_task
def evaluate_math_expression(interaction_id, expression):
    try:
        interaction = Interaction.objects.get(id=interaction_id)
        interaction.status = 'processing'
        interaction.save()

        # Simulate heavy math evaluation
        expr = sp.sympify(expression)
        result = sp.simplify(expr)
        
        # Save results via AI/System trace
        interaction.status = 'completed'
        interaction.save()
        
        # Create response Interaction
        Interaction.objects.create(
            session=interaction.session,
            role='system',
            solution_latex=sp.latex(result),
            content_text=f"The simplified result is {result}"
        )

    except Exception as e:
        if 'interaction' in locals():
            interaction.status = 'failed'
            interaction.content_text = f"Error: {str(e)}"
            interaction.save()
