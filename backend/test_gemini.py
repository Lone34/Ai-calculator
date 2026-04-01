import urllib.request
import json
import os
from pathlib import Path

env_path = Path(__file__).resolve().parent / '.env'
if env_path.exists():
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

api_key = os.environ.get('GEMINI_API_KEY')
if not api_key:
    raise RuntimeError('GEMINI_API_KEY is missing. Add it to backend/.env before running this script.')

model_name = 'gemini-2.5-flash'
url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"

payload = {
    "contents": [{"role": "user", "parts": [{"text": "Let x = \u221a2 - 1. Find the exact value of x^10 + 1/x^10."}]}],
    "generationConfig": {
        "temperature": 0.7,
        "maxOutputTokens": 4096,
    },
    "systemInstruction": {
        "parts": [{"text": "You are an expert math tutor."}]
    }
}

data = json.dumps(payload).encode('utf-8')
req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')

try:
    response = urllib.request.urlopen(req, timeout=60)
    result = json.loads(response.read().decode('utf-8'))
    print(json.dumps(result, indent=2))
except urllib.error.HTTPError as e:
    print("Error:", e.read().decode('utf-8'))
