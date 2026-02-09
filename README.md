to run flagd daemon:
IN FLAGD DIRECTORY> ..\..\..\flagd.exe start -f file:./flags.json -p 8013
(replace "..\..\..\flagd.exe" with flagd executable path in your system)

to run the backend:
IN BACKEND DIRECTORY> uvicorn app:app --reload --port 8000

to run the frontend:
IN FRONTEND DIRECTORY> npm start
