@echo off
D:\pinokio\bin\miniconda\envs\alphadesk\python.exe -m pip install fastapi uvicorn pydantic pydantic-settings python-dotenv orjson httpx websockets redis sqlalchemy asyncpg alembic anthropic > D:\exp\alphadesk\install_log.txt 2>&1
echo DONE: %ERRORLEVEL% >> D:\exp\alphadesk\install_log.txt
