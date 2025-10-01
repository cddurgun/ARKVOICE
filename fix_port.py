# Read app.py
with open('app.py', 'r') as f:
    content = f.read()

# Fix the port binding for Railway
old_code = 'uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")'
new_code = 'port = int(os.getenv("PORT", 8000))\n    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")'

content = content.replace(old_code, new_code)

# Write back
with open('app.py', 'w') as f:
    f.write(content)

print("✅ Fixed PORT handling for Railway")
