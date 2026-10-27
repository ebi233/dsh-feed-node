@echo off
chcp 65001 >nul
rem 启动本机取数服务（开机自启用）
cd /d "%~dp0.."
if not exist shots mkdir shots
node src\server.mjs >> node.log 2>> node.err.log
