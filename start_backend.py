"""Start the AlphaDesk backend, capturing any import errors."""
import sys
import os
import traceback

os.chdir(r"D:\exp\alphadesk\backend")
sys.path.insert(0, r"D:\exp\alphadesk\backend")

log_path = r"D:\exp\alphadesk\backend_startup.log"

with open(log_path, "w") as log:
    log.write("=== AlphaDesk Backend Startup ===\n")
    log.flush()

    try:
        log.write("Importing main...\n")
        log.flush()
        import main
        log.write(f"Main imported OK: {main.app.title}\n")
        log.flush()
    except Exception as e:
        log.write(f"IMPORT ERROR:\n{traceback.format_exc()}\n")
        log.flush()
        sys.exit(1)

    try:
        log.write("Starting uvicorn...\n")
        log.flush()
        import uvicorn
        uvicorn.run(main.app, host="0.0.0.0", port=8000, log_level="info")
    except Exception as e:
        log.write(f"UVICORN ERROR:\n{traceback.format_exc()}\n")
        log.flush()
        sys.exit(1)
