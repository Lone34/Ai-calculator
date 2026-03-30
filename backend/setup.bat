@echo off
echo Creating virtual environment...
python -m venv venv
call venv\Scripts\activate.bat
echo Installing dependencies...
pip install django djangorestframework django-cors-headers celery redis sympy psycopg2-binary
echo Making migrations...
python manage.py makemigrations core
python manage.py migrate
echo Backend setup complete! Run 'python manage.py runserver' to start.
