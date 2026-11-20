@echo off
cd /d "%~dp0"
echo Instalando dependencias raiz...
call npm install
echo.
echo Instalando dependencias do server...
cd server
call npm install
cd ..
echo.
echo Instalando dependencias do web...
cd web
call npm install
cd ..
echo.
echo Pronto! Execute "npm run dev" para iniciar.
pause
