#!/bin/bash
echo "🚀 Starting Campaign Auto-Restart Loop..."

while true; do
    node send_messages.js
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo "🎉 Campaign completed successfully (or manually paused). Exiting loop."
        break
    else
        echo "🚨 Campaign halted due to connection loss (Exit Code: $EXIT_CODE). Restarting in 15 seconds..."
        sleep 15
    fi
done
